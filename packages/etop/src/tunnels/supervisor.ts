/**
 * Running the tunnels, and putting them back when they fall over.
 *
 * This is the file the "native sources, never a subprocess" rule was amended
 * for, so it is worth being precise about what it does and does not do. It
 * spawns `ssh` because there is no native way to hold an SSH connection open -
 * the protocol, the user's ~/.ssh/config, their agent, their known_hosts and
 * their key formats are not things to reimplement, and OpenSSH is the only
 * correct implementation of them. What it does *not* do is derive any fact
 * about the machine from that subprocess: nothing parses ssh's stdout, and
 * whether a tunnel is actually carrying traffic is answered from /proc by the
 * connections collector, not from here.
 *
 * Shaped like SlowPoller, and bound by the same five rules:
 *
 * 1. `getSnapshot()` returns the cached object. Building a fresh one per call
 *    makes useSyncExternalStore re-render forever and pins the CPU at 100%
 *    without ever drawing a second frame.
 * 2. Constructed before `render()` and disposed through `installLifecycle`.
 * 3. No overlapping work: one child per tunnel, one timer per tunnel, and a
 *    retry timer is always cleared before another is set.
 * 4. Nothing here throws. `command()` returns a result the way `sendSignal`
 *    does, because a failure to start a tunnel deserves one line in the footer,
 *    not a torn-down render tree.
 * 5. …with one deliberate exception. SlowPoller's `setActive` gates work by
 *    which screen is visible; this does not, and must not. A tunnel has to keep
 *    running while you are looking at the CPU graph.
 *
 * The spawner is injected exactly as `state/signals.ts` injects its killer, so
 * no test in the suite ever starts a real ssh.
 */

import { spawn } from 'node:child_process';

import { nextDelay, STABLE_MS } from './backoff.js';
import { buildSshArgs, classifyExit, describeCommand } from './ssh.js';
import type { BackoffOptions } from './backoff.js';
import type { Tunnel, TunnelConfig } from './config.js';
import type { ConfigProbe } from './load.js';


export type TunnelPhase =
    /** configured, never started */
    | 'idle'
    /** spawned; not yet trusted */
    | 'starting'
    /** alive past the grace period */
    | 'up'
    /** exited for something worth waiting out; a timer is pending */
    | 'backoff'
    /** SIGTERM sent, awaiting the exit */
    | 'stopping'
    /** the user asked for it down; distinct from idle, which is "never asked" */
    | 'stopped'
    /** retrying cannot fix it */
    | 'failed';


export type TunnelStatus = {
    tunnel: Tunnel;
    phase: TunnelPhase;
    pid: number | null;
    /** the last thing that happened, for the row and the footer */
    message: string;
    /** how many retries since the last stable connection */
    attempt: number;
    /** epoch ms the pending retry is due, when phase is 'backoff' */
    retryAt: number | null;
    /** epoch ms the current child reached 'up' */
    upSince: number | null;
    /** the last few stderr lines, for the detail row */
    output: string[];
};


export type TunnelsState = {
    statuses: TunnelStatus[];
    /**
     * The last config load, so the panel can say why the list is empty.
     *
     * Carried here rather than read by the panel because "there is no config"
     * and "the config is broken" look identical from a list of zero tunnels,
     * and only one of them is something the user should be told to fix. The
     * type is a Probe rather than fs errors: nothing in this file opens a file,
     * which is what keeps the supervisor testable without a fixture tree.
     */
    config: ConfigProbe | null;
    /** monotonic; a memo key, the same role StoreState.ticks plays */
    ticks: number;
};


export type CommandResult = {
    ok: boolean;
    message: string;
};


/**
 * The shape of a child this supervisor can manage.
 *
 * Node's ChildProcess satisfies it, and so does a plain object in a test -
 * which is the point. Written as overloads rather than a union of event names
 * so each listener gets its real arguments and nothing needs casting.
 */
export type Child = {
    pid?: number | undefined;
    stderr: { on: (event: 'data', listener: (chunk: unknown) => void) => unknown } | null;
    on: {
        (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
        (event: 'error', listener: (err: Error) => void): unknown;
    };
    kill: (signal?: NodeJS.Signals) => boolean;
};


export type Spawner = (command: string, args: string[]) => Child;


export type SupervisorOptions = {
    /** the loaded config; absent means there is nothing to run yet */
    config?: TunnelConfig;
    /** test seam: nothing in the suite spawns a real ssh */
    spawner?: Spawner;
    backoff?: BackoffOptions;
    /**
     * How long a child must survive before it counts as connected.
     *
     * `ssh -N` prints nothing on success, so there is no line to wait for. This
     * works only because ExitOnForwardFailure makes a bad forward exit at once
     * rather than sitting there connected and useless - see ssh.ts.
     */
    graceMs?: number;
    /** how long SIGTERM gets before SIGKILL */
    termGraceMs?: number;
    /** test seam, so a test never waits a real second */
    now?: () => number;
};


export const DEFAULT_GRACE_MS = 2000;
export const DEFAULT_TERM_GRACE_MS = 5000;

/** how many stderr lines to keep per tunnel */
const OUTPUT_LINES = 8;


const defaultSpawner: Spawner = (command, args) => spawn(command, args, {
    // stdin ignored is a second belt against any prompt that gets past
    // BatchMode. stdout and stderr are pipes and never inherited: a child
    // writing to the alternate screen corrupts it in a way no later frame
    // washes out.
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
}) as unknown as Child;


type Entry = {
    status: TunnelStatus;
    child: Child | null;
    /** the retry timer, or the SIGKILL escalation timer */
    timer: NodeJS.Timeout | null;
    /** the grace timer that promotes starting to up */
    graceTimer: NodeJS.Timeout | null;
    /** the user asked for this down; the exit handler must not retry it */
    intentStopped: boolean;
    /**
     * Start again as soon as the current child is gone.
     *
     * A restart cannot be a stop followed by a start: SIGTERM is asynchronous,
     * so the old child is still there when the start runs, and #start refuses
     * to spawn a second one over it. Without this flag the tunnel stops and
     * never comes back - which is what happens on every config edit.
     */
    restartAfterExit: boolean;
};


export class TunnelSupervisor
{
    /** how many children have been spawned; the retry tests read this */
    spawns = 0;

    #entries = new Map<string, Entry>();
    #state: TunnelsState = { statuses: [], config: null, ticks: 0 };
    #listeners = new Set<() => void>();
    #spawner: Spawner;
    #backoff: BackoffOptions;
    #graceMs: number;
    #termGraceMs: number;
    #now: () => number;
    #configProbe: ConfigProbe | null = null;
    #disposed = false;

    constructor(options: SupervisorOptions = {})
    {
        this.#spawner = options.spawner ?? defaultSpawner;
        this.#backoff = options.backoff ?? {};
        this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
        this.#termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
        this.#now = options.now ?? Date.now;

        if (options.config !== undefined) {
            this.adopt(options.config);
        }
    }

    /** see rule 1: the cached object, never a fresh one */
    getSnapshot = (): TunnelsState => this.#state;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);

        return () => {
            this.#listeners.delete(listener);
        };
    };

    /**
     * Take on a freshly loaded config, however it turned out.
     *
     * A load that failed changes nothing about what is running. Losing every
     * tunnel you had because you left a trailing comma in the file is the worst
     * available failure mode, and it is the one this guard exists to prevent -
     * the panel shows the parse error and the connections stay up.
     */
    setConfig(probe: ConfigProbe): CommandResult
    {
        if (this.#disposed) {
            return { ok: false, message: 'etop is shutting down' };
        }

        this.#configProbe = probe;

        if (!probe.available) {
            this.#publish();

            return {
                ok: false,
                message: probe.reason === 'not-found'
                    ? 'no tunnel config yet'
                    : `the tunnel config is not usable: ${firstLine(probe.detail)}`,
            };
        }

        this.adopt(probe.config);

        return { ok: true, message: `loaded ${probe.config.tunnels.length} tunnels` };
    }

    /**
     * Take on a config, keeping whatever is already running.
     *
     * The diff is by name and then by command: a tunnel whose argv is unchanged
     * keeps its child and its uptime, so saving the file after fixing a typo in
     * an unrelated entry does not drop every connection you had.
     */
    adopt(config: TunnelConfig): void
    {
        if (this.#disposed) {
            return;
        }

        const wanted = new Map(config.tunnels.map(tunnel => [tunnel.name, tunnel]));

        for (const [name, entry] of this.#entries) {
            if (!wanted.has(name)) {
                this.#stop(entry, 'removed from the config');
                this.#entries.delete(name);
            }
        }

        for (const [name, tunnel] of wanted) {
            const entry = this.#entries.get(name);

            if (entry === undefined) {
                this.#entries.set(name, newEntry(tunnel));

                continue;
            }

            if (describeCommand(entry.status.tunnel) === describeCommand(tunnel)) {
                // unchanged: keep the child, keep the uptime, just refresh the
                // declaration in case a non-argv field like autostart moved
                entry.status.tunnel = tunnel;

                continue;
            }

            const wasRunning = isLive(entry.status.phase);

            this.#stop(entry, 'restarting: its config changed', wasRunning);
            entry.status.tunnel = tunnel;
            entry.status.attempt = 0;

            // nothing was running, so there is no exit to wait for
            if (wasRunning && entry.child === null) {
                entry.restartAfterExit = false;
                this.#start(entry);
            }
        }

        this.#publish();
    }

    /** start every tunnel that asked to be started */
    startAutostart(): void
    {
        for (const entry of this.#entries.values()) {
            if (entry.status.tunnel.autostart && !isLive(entry.status.phase)) {
                this.#start(entry);
            }
        }

        this.#publish();
    }

    /**
     * Do something to one tunnel.
     *
     * Never throws, and returns the same shape `sendSignal` does, because every
     * outcome here belongs in the footer rather than in a stack trace.
     */
    command(verb: 'start' | 'stop' | 'toggle' | 'restart', name: string): CommandResult
    {
        if (this.#disposed) {
            return { ok: false, message: 'etop is shutting down' };
        }

        const entry = this.#entries.get(name);

        if (entry === undefined) {
            return { ok: false, message: name === '' ? 'no tunnel selected' : `no tunnel named ${name}` };
        }

        const live = isLive(entry.status.phase);
        const action = verb === 'toggle' ? (live ? 'stop' : 'start') : verb;

        if (action === 'stop') {
            if (!live) {
                return { ok: false, message: `${name} is not running` };
            }

            this.#stop(entry, 'stopped');
            this.#publish();

            return { ok: true, message: `stopping ${name}` };
        }

        if (action === 'restart') {
            // clears the backoff and any `failed`, which is the whole point of
            // the key: "I have fixed it, try again now"
            this.#stop(entry, 'reconnecting', true);
            entry.status.attempt = 0;

            // with no child to wait for, the restart is immediate
            if (entry.child === null) {
                entry.restartAfterExit = false;
                this.#start(entry);
            }

            this.#publish();

            return { ok: true, message: `reconnecting ${name}` };
        }

        if (live) {
            return { ok: false, message: `${name} is already running` };
        }

        entry.status.attempt = 0;
        this.#start(entry);
        this.#publish();

        return { ok: true, message: `starting ${name}` };
    }

    /**
     * Stop everything.
     *
     * This is what makes "the tunnels die with etop" true rather than merely
     * usual. The children are in etop's process group, so a Ctrl-C at the
     * terminal already signals them - but `kill <etop-pid>` from elsewhere does
     * not, and would leave them orphaned holding their ports.
     */
    dispose(): void
    {
        this.#disposed = true;

        for (const entry of this.#entries.values()) {
            this.#clearTimers(entry);

            if (entry.child !== null) {
                entry.intentStopped = true;
                entry.restartAfterExit = false;
                safeKill(entry.child, 'SIGTERM');
                entry.child = null;
            }
        }

        this.#listeners.clear();
    }

    #start(entry: Entry): void
    {
        if (this.#disposed || entry.child !== null) {
            return;
        }

        this.#clearTimers(entry);
        entry.intentStopped = false;
        entry.restartAfterExit = false;

        const { tunnel } = entry.status;
        let child: Child;

        try {
            child = this.#spawner('ssh', buildSshArgs(tunnel));
        }
        catch (err) {
            // ENOENT for a machine with no ssh installed. Fatal: no amount of
            // retrying installs it.
            this.#settle(entry, 'failed', `could not run ssh: ${(err as Error).message}`);

            return;
        }

        this.spawns++;
        entry.child = child;
        entry.status.pid = child.pid ?? null;
        entry.status.phase = 'starting';
        entry.status.message = 'connecting';
        entry.status.upSince = null;
        entry.status.output = [];

        child.stderr?.on('data', chunk => {
            this.#absorb(entry, String(chunk));
        });

        child.on('error', (err: Error) => {
            // 'error' can arrive instead of 'exit' when the spawn itself failed
            if (entry.child !== child) {
                return;
            }

            entry.child = null;
            this.#settle(entry, 'failed', `could not run ssh: ${err.message}`);
            this.#publish();
        });

        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
            if (entry.child !== child) {
                // a child we already replaced; its exit says nothing about now
                return;
            }

            entry.child = null;
            this.#onExit(entry, code, signal);
            this.#publish();
        });

        // `ssh -N` says nothing on success, so surviving the grace period is
        // the signal. Safe only because ExitOnForwardFailure makes a bad
        // forward exit immediately rather than sitting there connected.
        entry.graceTimer = setTimeout(() => {
            entry.graceTimer = null;

            if (entry.child === child && entry.status.phase === 'starting') {
                entry.status.phase = 'up';
                entry.status.upSince = this.#now();
                entry.status.message = 'connected';
                this.#publish();
            }
        }, this.#graceMs);

        entry.graceTimer.unref?.();
    }

    #onExit(entry: Entry, code: number | null, signal: NodeJS.Signals | null): void
    {
        this.#clearTimers(entry);
        entry.status.pid = null;

        if (entry.intentStopped) {
            if (entry.restartAfterExit) {
                entry.restartAfterExit = false;
                this.#start(entry);

                return;
            }

            this.#settle(entry, 'stopped', 'stopped');

            return;
        }

        const heldFor = entry.status.upSince === null ? 0 : this.#now() - entry.status.upSince;

        // a connection that lasted counts as a success, whatever it exited
        // with. Without this, a tunnel that dies after three seconds looks like
        // a first failure every time and retries at one-second intervals for
        // ever.
        if (heldFor >= STABLE_MS) {
            entry.status.attempt = 0;
        }

        const verdict = classifyExit(code, signal, entry.status.output.join('\n'));

        if (verdict.fatal) {
            this.#settle(entry, 'failed', verdict.message);

            return;
        }

        const delay = nextDelay(entry.status.attempt, this.#backoff);

        entry.status.attempt++;
        entry.status.phase = 'backoff';
        entry.status.upSince = null;
        entry.status.retryAt = this.#now() + delay;
        entry.status.message = `${verdict.message}; retrying in ${humanDelay(delay)}`;

        entry.timer = setTimeout(() => {
            entry.timer = null;
            this.#start(entry);
            this.#publish();
        }, delay);

        // never be the reason the process stays alive
        entry.timer.unref?.();
    }

    #stop(entry: Entry, message: string, thenStart = false): void
    {
        this.#clearTimers(entry);
        entry.intentStopped = true;
        entry.restartAfterExit = thenStart;
        entry.status.retryAt = null;
        entry.status.upSince = null;

        const child = entry.child;

        if (child === null) {
            this.#settle(entry, 'stopped', message);

            return;
        }

        entry.status.phase = 'stopping';
        entry.status.message = message;
        safeKill(child, 'SIGTERM');

        // a child that ignores SIGTERM would otherwise hold its ports for ever
        entry.timer = setTimeout(() => {
            entry.timer = null;

            if (entry.child === child) {
                safeKill(child, 'SIGKILL');
            }
        }, this.#termGraceMs);

        entry.timer.unref?.();
    }

    #settle(entry: Entry, phase: TunnelPhase, message: string): void
    {
        entry.status.phase = phase;
        entry.status.message = message;
        entry.status.pid = null;
        entry.status.retryAt = null;
        entry.status.upSince = null;
    }

    #absorb(entry: Entry, text: string): void
    {
        for (const line of text.split('\n')) {
            const trimmed = line.trim();

            if (trimmed !== '') {
                entry.status.output.push(trimmed);
            }
        }

        // a ring rather than a transcript: a tunnel that fails every second all
        // night must not grow an array until the process dies of it. Trimmed in
        // place rather than reassigned - replacing the array would strand the
        // published snapshot holding the old one, which is how this first came
        // to report nine lines from an eight-line buffer.
        const excess = entry.status.output.length - OUTPUT_LINES;

        if (excess > 0) {
            entry.status.output.splice(0, excess);
        }

        // ssh says nothing at all until something is wrong, so this is rare and
        // is exactly when the user wants the screen to update
        this.#publish();
    }

    #clearTimers(entry: Entry): void
    {
        if (entry.timer !== null) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }

        if (entry.graceTimer !== null) {
            clearTimeout(entry.graceTimer);
            entry.graceTimer = null;
        }
    }

    #publish(): void
    {
        if (this.#disposed) {
            return;
        }

        // a new array of the same status objects: the identity of the state
        // changes so useSyncExternalStore notices, and rule 1 is about
        // getSnapshot not fabricating one per *call*, which it does not
        this.#state = {
            config: this.#configProbe,
            statuses: [...this.#entries.values()].map(entry => ({
                ...entry.status,
                // copied, not shared: the ring is trimmed in place, and a
                // published frame that mutates later defeats every memo below it
                output: [...entry.status.output],
            })),
            ticks: this.#state.ticks + 1,
        };

        for (const listener of this.#listeners) {
            listener();
        }
    }
}


function newEntry(tunnel: Tunnel): Entry
{
    return {
        status: {
            tunnel,
            phase: 'idle',
            pid: null,
            message: 'not started',
            attempt: 0,
            retryAt: null,
            upSince: null,
            output: [],
        },
        child: null,
        timer: null,
        graceTimer: null,
        intentStopped: false,
        restartAfterExit: false,
    };
}


function firstLine(text: string | undefined): string
{
    return (text ?? '').split('\n')[0] ?? '';
}


/**
 * A delay, as a person would say it.
 *
 * Rounding to whole seconds turned the first retry - a sub-second draw from the
 * jitter range - into "retrying in 0s", which reads as a bug rather than as the
 * backoff working.
 */
function humanDelay(ms: number): string
{
    return ms < 1000 ? `${Math.max(1, Math.round(ms / 100) * 100)}ms` : `${Math.round(ms / 1000)}s`;
}


/** running, or on its way to running */
function isLive(phase: TunnelPhase): boolean
{
    return phase === 'starting' || phase === 'up' || phase === 'backoff' || phase === 'stopping';
}


/**
 * Signalling a child that may already be gone.
 *
 * ESRCH between the exit and the kill is ordinary rather than exceptional -
 * the same race sendSignal explains - and it must not take down the app.
 */
function safeKill(child: Child, signal: NodeJS.Signals): void
{
    try {
        child.kill(signal);
    }
    catch {
        // already gone
    }
}
