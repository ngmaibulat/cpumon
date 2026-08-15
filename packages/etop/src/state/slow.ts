/**
 * The second, slower poller: everything that is a socket rather than a file.
 *
 * `SystemMonitor` is synchronous and stays that way. The reasoning is in
 * `libsysmon/collectors/proc.ts` and it is still right: /proc and /sys are
 * memory-backed, so a sample is a read(2) with no block device behind it, and
 * making that path async would force every renderer to become async for no
 * measurable gain.
 *
 * Docker, systemd and iwd are not that. Each is a round-trip to a daemon that
 * may be busy, and blocking the render loop on one would make the whole
 * dashboard stutter whenever docker was. So they live here instead, on a
 * separate and much lazier clock.
 *
 * That split puts scheduling policy in the application rather than in the
 * library, which is where it belongs: `libsysmon` exports collectors, and only
 * the app knows which screen is showing and therefore what is worth asking for.
 *
 * ## The five rules
 *
 * 1. `getSnapshot()` returns the cached object. Building a fresh one per call
 *    makes useSyncExternalStore re-render forever and the app spins at 100% CPU
 *    without ever drawing a second frame. See the same note on
 *    SnapshotStore.getSnapshot - it is the most common way to hang an ink app
 *    and it looks exactly like a slow renderer.
 * 2. Constructed before `render()`, disposed through `installLifecycle`, for
 *    the same reasons SnapshotStore is.
 * 3. No overlapping ticks. A `setTimeout` chain that reschedules once a poll
 *    has settled, never `setInterval` - a poll that outlives its interval must
 *    not have a second one started underneath it. This is the exact failure the
 *    synchronous design was avoiding, and going async is where it arrives.
 * 4. A rejected poll publishes an Unavailable. It never throws: an unhandled
 *    rejection takes the process down with the alternate screen still up.
 * 5. `setActive` is what keeps this free. A session that never opens the stacks
 *    screen never opens the docker socket.
 *
 * Every timer is unref'd, so nothing here holds the event loop open behind ink.
 */

import { getDockerContainers, getSystemdUnits, getWifi, unavailable } from 'libsysmon';
import type {
    DockerContainer, DockerOptions, Probe,
    SystemdOptions, SystemdUnit, WifiOptions, WifiState,
} from 'libsysmon';


export type SlowState = {
    docker?: Probe<{ containers: DockerContainer[] }>;
    units?: Probe<{ units: SystemdUnit[] }>;
    wifi?: Probe<WifiState>;
    /** monotonic; a memo key, the same role StoreState.ticks plays */
    ticks: number;
};


export type SlowSource = 'docker' | 'units' | 'wifi';


export type SlowOptions = {
    /** default 3000: container and unit lists change on the scale of seconds */
    intervalMs?: number;
    docker?: DockerOptions;
    units?: SystemdOptions;
    wifi?: WifiOptions;
    /** test seam: replace what a source actually calls */
    fetchers?: Partial<Fetchers>;
};


type Fetchers = {
    [K in SlowSource]: (options: SlowOptions) => Promise<NonNullable<SlowState[K]>>;
};


const DEFAULT_FETCHERS: Fetchers = {
    docker: options => getDockerContainers(options.docker),
    units: options => getSystemdUnits(options.units),
    wifi: options => getWifi(options.wifi),
};


export const DEFAULT_SLOW_INTERVAL = 3000;


export class SlowPoller
{
    /** how many polls have been started; the no-overlap test reads this */
    polls = 0;

    #state: SlowState = { ticks: 0 };
    #listeners = new Set<() => void>();
    #active = new Set<SlowSource>();
    #options: SlowOptions;
    #fetchers: Fetchers;
    #intervalMs: number;
    #timer: NodeJS.Timeout | null = null;
    #polling = false;
    #disposed = false;

    constructor(options: SlowOptions = {})
    {
        this.#options = options;
        this.#fetchers = { ...DEFAULT_FETCHERS, ...options.fetchers };
        this.#intervalMs = options.intervalMs ?? DEFAULT_SLOW_INTERVAL;
    }

    /** see rule 1: the cached object, never a fresh one */
    getSnapshot = (): SlowState => this.#state;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    };

    get active(): readonly SlowSource[]
    {
        return [...this.#active];
    }

    /**
     * Declare what the visible screen needs.
     *
     * Called from an effect on every screen change, so it has to be cheap and
     * idempotent - an unchanged set does nothing at all, and in particular does
     * not restart the clock or re-fetch.
     *
     * A source being asked for that has no data yet is polled at once rather
     * than at the next interval. Otherwise opening the stacks screen shows
     * "waiting" for three seconds while a request that takes fifteen
     * milliseconds sits queued behind a timer.
     */
    setActive(sources: SlowSource[]): void
    {
        if (this.#disposed) {
            return;
        }

        const next = new Set(sources);
        const wanted = [...next].filter(source => this.#state[source] === undefined);

        this.#active = next;

        if (next.size === 0) {
            this.#clearTimer();

            return;
        }

        if (wanted.length > 0 && !this.#polling) {
            this.#clearTimer();
            void this.#tick();

            return;
        }

        if (this.#timer === null && !this.#polling) {
            this.#schedule();
        }
    }

    dispose(): void
    {
        this.#disposed = true;
        this.#clearTimer();
        this.#listeners.clear();
        this.#active.clear();
    }

    #clearTimer(): void
    {
        if (this.#timer !== null) {
            clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    #schedule(): void
    {
        if (this.#disposed || this.#active.size === 0) {
            return;
        }

        this.#timer = setTimeout(() => {
            void this.#tick();
        }, this.#intervalMs);

        // never be the reason the process stays alive: if ink tears down, this
        // timer must not hold the event loop open behind it
        this.#timer.unref?.();
    }

    /**
     * One poll, then reschedule.
     *
     * The reschedule happens after the poll has settled rather than on a fixed
     * cadence, which is rule 3: a docker daemon taking five seconds to answer a
     * three-second poller must not accumulate requests.
     */
    async #tick(): Promise<void>
    {
        this.#clearTimer();

        if (this.#disposed || this.#polling) {
            return;
        }

        this.#polling = true;

        try {
            await this.#poll();
        }
        finally {
            this.#polling = false;
            this.#schedule();
        }
    }

    async #poll(): Promise<void>
    {
        const sources = [...this.#active];

        if (sources.length === 0) {
            return;
        }

        this.polls++;

        // concurrently, and settled rather than raced: one source failing must
        // not cancel the others, and one slow source must not delay them
        const results = await Promise.allSettled(
            sources.map(source => this.#fetchers[source](this.#options)),
        );

        // the poll outlived a dispose, or the screen moved on. Publishing now
        // would wake listeners that no longer exist
        if (this.#disposed) {
            return;
        }

        const next: Partial<SlowState> = {};

        sources.forEach((source, i) => {
            const result = results[i];

            // rule 4. Both collectors resolve an Unavailable rather than
            // rejecting, so this is the belt to their braces - and the contract
            // every source added later is held to.
            const probe = result.status === 'fulfilled'
                ? result.value
                : unavailable('parse-error', errorText(result.reason));

            // TypeScript cannot correlate sources[i] with results[i], so a
            // direct `next[source] =` widens to the intersection of every
            // source's probe type and stops type-checking. The pairing is
            // guaranteed by allSettled preserving order, and #fetchers[source]
            // is typed to return exactly SlowState[source].
            Object.assign(next, { [source]: probe });
        });

        this.#publish({ ...next, ticks: this.#state.ticks + 1 });
    }

    #publish(next: Partial<SlowState>): void
    {
        this.#state = { ...this.#state, ...next };

        for (const listener of this.#listeners) {
            listener();
        }
    }
}


function errorText(reason: unknown): string
{
    return reason instanceof Error ? reason.message : String(reason);
}
