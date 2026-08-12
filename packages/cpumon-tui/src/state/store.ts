/**
 * The bridge from SystemMonitor to React.
 *
 * Three properties of SystemMonitor rule out the obvious useEffect + useState
 * version, and they are worth spelling out because each one fails quietly:
 *
 * 1. It starts sampling in its constructor. Constructed inside an effect, a
 *    double-mount leaks the first instance's setInterval forever - nothing ever
 *    holds a reference to call stopMonitor() on.
 * 2. It has to exist before ink renders, so the first frame can already say
 *    "waiting for a full window" instead of flashing an empty layout. Anything
 *    constructed in an effect leaves a gap where a 'sample' is dropped.
 * 3. EventEmitter rethrows an 'error' event that has no listener. Attaching in
 *    an effect leaves a window where one bad sample takes the process down mid
 *    frame, with the alternate screen still up.
 *
 * So the store is a plain object constructed by runTui() before render(), and
 * components read it through useSyncExternalStore.
 *
 * History lives here rather than in React state. It is append-only and read
 * during render, and pushing 512-point arrays through setState every second
 * would allocate for nothing.
 */

import { SystemMonitor } from 'cpumon/system';
import type { CollectorName, SystemSnapshot } from 'cpumon/system';
import type { ProcessSortKey } from 'cpumon';

import { Ring } from '../render/ring.js';


export type StoreState = {
    /** null until the first full window lands; this is what drives <Loading> */
    snapshot: SystemSnapshot | null;
    /** the last sampling error, cleared by the next good sample */
    error: Error | null;
    /** monotonic; every publish carries a fresh value so memo keys change */
    ticks: number;
    intervalMs: number;
    /** the view is frozen; sampling continues underneath */
    paused: boolean;
};


export type StoreOptions = {
    intervalMs: number;
    collect: CollectorName[];
    mount?: string;
    top: number;
    sort: ProcessSortKey;
    sortReverse: boolean;
    /** test seam: swap in a fake monitor */
    createMonitor?: (options: MonitorOptions) => MonitorLike;
    /** test seam: /proc root for the collectors */
    procRoot?: string;
    sysfsRoot?: string;
};


export type MonitorOptions = {
    intervalMs: number;
    collect: CollectorName[];
    mount?: string;
    top: number;
    sort: ProcessSortKey;
    sortReverse: boolean;
    unref: boolean;
    procRoot?: string;
    sysfsRoot?: string;
};


export type MonitorLike = {
    on(event: 'sample', listener: (snapshot: SystemSnapshot) => void): unknown;
    on(event: 'error', listener: (err: Error) => void): unknown;
    stopMonitor(): void;
    removeAllListeners(): unknown;
};


/**
 * Roughly eight minutes of history at the default one-second interval, which
 * is more than any terminal is wide. See Ring for why this is not sized to the
 * panel.
 */
const HISTORY = 512;

/** per-core graphs are eight to twelve columns; they do not need the full depth */
const CORE_HISTORY = 128;

/** a machine with more cores than this gets a sparkline strip, not a graph each */
const MAX_CORES = 256;


export class SnapshotStore
{
    readonly rings = {
        cpu: new Ring(HISTORY),
        memory: new Ring(HISTORY),
        swap: new Ring(HISTORY),
        rx: new Ring(HISTORY),
        tx: new Ring(HISTORY),
        load: new Ring(HISTORY),
    };

    /** one per core, reallocated when the core count changes */
    cores: Ring[] = [];

    /** how many monitors have been spawned; the restart-debouncing test reads this */
    spawns = 0;

    #state: StoreState;
    #listeners = new Set<() => void>();
    #monitor: MonitorLike | null = null;
    #options: StoreOptions;

    constructor(options: StoreOptions)
    {
        this.#options = { ...options };
        this.#state = {
            snapshot: null,
            error: null,
            ticks: 0,
            intervalMs: options.intervalMs,
            paused: false,
        };

        this.#spawn();
    }

    /**
     * useSyncExternalStore compares this by reference and re-renders whenever it
     * changes. It MUST return the cached object rather than building one, or
     * every render schedules another and the app spins at 100% CPU without ever
     * drawing a second frame. This is the single most common way to hang an ink
     * app, and it looks exactly like a slow renderer.
     */
    getSnapshot = (): StoreState => this.#state;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    };

    get options(): Readonly<StoreOptions>
    {
        return this.#options;
    }

    setPaused(paused: boolean): void
    {
        if (paused !== this.#state.paused) {
            this.#publish({ paused });
        }
    }

    /**
     * Change the sampling rate.
     *
     * SystemMonitor.ms is readonly and captured by its setInterval, so this
     * means a new monitor. Losing the baseline is correct rather than a cost:
     * the first window at the new rate must be measured at the new length, not
     * straddle the boundary and report a figure that belongs to neither.
     */
    setIntervalMs(intervalMs: number): void
    {
        if (intervalMs === this.#state.intervalMs) {
            return;
        }

        this.#options.intervalMs = intervalMs;
        // back to the loading state for exactly one tick, because that is the
        // truth: there is no window yet at this rate
        this.#publish({ intervalMs, snapshot: null });
        this.#respawn();
    }

    /**
     * How many process rows to collect.
     *
     * Feeding this from the visible row count is what keeps resident memory
     * from being read for rows nobody can see. It restarts the monitor, so
     * callers are expected to ask for more than they need and change it rarely
     * - ProcessPanel adds headroom and debounces resizes.
     */
    setTop(top: number): void
    {
        if (top === this.#options.top) {
            return;
        }

        this.#options.top = top;
        this.#respawn();
    }

    setSort(sort: ProcessSortKey, sortReverse: boolean): void
    {
        if (sort === this.#options.sort && sortReverse === this.#options.sortReverse) {
            return;
        }

        this.#options.sort = sort;
        this.#options.sortReverse = sortReverse;
        // the sort happens before the top-N cut, so which processes are even
        // collected depends on it - this cannot be done in the component
        this.#respawn();
    }

    /** clear every history series, keeping the live snapshot */
    reset(): void
    {
        for (const ring of Object.values(this.rings)) {
            ring.clear();
        }

        for (const ring of this.cores) {
            ring.clear();
        }

        this.#publish({ ticks: this.#state.ticks + 1 });
    }

    dispose(): void
    {
        this.#stop();
        this.#listeners.clear();
    }

    #stop(): void
    {
        this.#monitor?.stopMonitor();
        // listeners are ours, and a stopped monitor that is about to be dropped
        // must not keep the store alive through them
        this.#monitor?.removeAllListeners();
        this.#monitor = null;
    }

    #respawn(): void
    {
        this.#stop();
        this.#spawn();
    }

    #spawn(): void
    {
        const options: MonitorOptions = {
            intervalMs: this.#options.intervalMs,
            collect: this.#options.collect,
            mount: this.#options.mount,
            top: this.#options.top,
            sort: this.#options.sort,
            sortReverse: this.#options.sortReverse,
            // never be the reason the process stays alive: if ink tears down,
            // this timer must not hold the event loop open behind it
            unref: true,
            procRoot: this.#options.procRoot,
            sysfsRoot: this.#options.sysfsRoot,
        };

        const create = this.#options.createMonitor ?? defaultMonitor;
        const monitor = create(options);

        this.spawns++;

        monitor.on('sample', (snapshot: SystemSnapshot) => {
            // a paused view still lets the baseline advance, so resuming shows
            // the present rather than replaying the moment it was frozen
            if (this.#state.paused) {
                return;
            }

            this.#record(snapshot);
            this.#publish({ snapshot, error: null, ticks: this.#state.ticks + 1 });
        });

        // without this listener EventEmitter rethrows, and the process dies
        // with the alternate screen still on the user's terminal
        monitor.on('error', (err: Error) => {
            this.#publish({ error: err, ticks: this.#state.ticks + 1 });
        });

        this.#monitor = monitor;
    }

    #publish(next: Partial<StoreState>): void
    {
        this.#state = { ...this.#state, ...next };

        for (const listener of this.#listeners) {
            listener();
        }
    }

    #record(snapshot: SystemSnapshot): void
    {
        if (snapshot.cpuOverall !== undefined) {
            this.rings.cpu.push(snapshot.cpuOverall.loadPercentage ?? 0);
        }

        this.#recordCores(snapshot.cpu ?? []);

        if (snapshot.memory !== undefined) {
            this.rings.memory.push(snapshot.memory.usedPercentage);
            this.rings.swap.push(snapshot.memory.swapTotal > 0
                ? (snapshot.memory.swapUsed / snapshot.memory.swapTotal) * 100
                : 0);
        }

        if (snapshot.load?.available === true) {
            this.rings.load.push(snapshot.load.one);
        }

        if (snapshot.network?.available === true) {
            let rx = 0;
            let tx = 0;

            for (const nic of snapshot.network.interfaces) {
                // loopback is almost always the loudest interface and almost
                // never the interesting one; summing it in flattens everything
                // else against the top of the graph
                if (nic.name === 'lo') {
                    continue;
                }

                rx += nic.rxBytesPerSec;
                tx += nic.txBytesPerSec;
            }

            this.rings.rx.push(rx);
            this.rings.tx.push(tx);
        }
    }

    #recordCores(cores: { loadPercentage?: number }[]): void
    {
        if (cores.length !== this.cores.length) {
            // a hotplug or cgroup change resyncs SystemMonitor's baseline and
            // skips a tick. per-core history cannot be carried across that -
            // core 3 before and core 3 after are not the same core - but the
            // aggregate series is still continuous, so only these are dropped
            const count = Math.min(cores.length, MAX_CORES);

            this.cores = Array.from({ length: count }, () => new Ring(CORE_HISTORY));
        }

        for (let i = 0; i < this.cores.length; i++) {
            this.cores[i].push(cores[i]?.loadPercentage ?? 0);
        }
    }
}


function defaultMonitor(options: MonitorOptions): MonitorLike
{
    return new SystemMonitor(options) as unknown as MonitorLike;
}
