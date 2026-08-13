/**
 * Sampling for metrics that need a window.
 *
 * Network bytes and per-process jiffies are cumulative counters: a single
 * reading says nothing, and a rate needs two readings plus the time between
 * them. CpuMonitor already solves that for CPU ticks, but its 'cpudata' event
 * carries a CpuInfo[] and nothing else, so it has no room for other metrics.
 *
 * Rather than widen CpuMonitor - which would change a documented contract for
 * every existing consumer - the baseline bookkeeping lives here, and every
 * collector stays a pure function. CpuMonitor is untouched and remains the
 * cheap CPU-only path behind the `libsysmon/cpu` entry point.
 *
 * The event is 'sample', deliberately not 'cpudata': a different payload under
 * a familiar name would be a trap for anyone swapping one class for the other.
 */

import EventEmitter from 'events';

import { aggregateCpu, getCpuDiff, getCpuInfo } from './CpuMonitor.js';
import type { CpuInfo } from './CpuMonitor.js';
import type { Probe } from './types.js';
import { getDiskUsage } from './collectors/disk.js';
import type { DiskInfo } from './collectors/disk.js';
import { getLoadAverage } from './collectors/loadavg.js';
import type { LoadAverage } from './collectors/loadavg.js';
import { getMemoryInfo } from './collectors/memory.js';
import type { MemoryInfo } from './collectors/memory.js';
import { diffNetwork, getNetworkCounters } from './collectors/network.js';
import type { NetworkCounters, NetworkRates } from './collectors/network.js';
import { diffProcesses, getProcessCounters, selectProcesses } from './collectors/process.js';
import type { ProcessLoad, ProcessSnapshot, ProcessSortKey } from './collectors/process.js';
import { diffContainerCpu, listContainers } from './collectors/container.js';
import type { ContainerInfo } from './collectors/container.js';
import type { CollectorOptions } from './collectors/proc.js';


export type CollectorName =
    | 'cpu' | 'memory' | 'load' | 'disk'
    | 'network' | 'process' | 'container';


type ContainerList = { containers: ContainerInfo[]; scope: 'host' | 'namespaced' };


export type SystemMonitorOptions = CollectorOptions & {
    /** sampling interval in milliseconds */
    intervalMs: number;
    /** which collectors to run; defaults to cpu, memory and load */
    collect?: CollectorName[];
    /** filesystem for the disk collector */
    mount?: string;
    /** how many processes to keep and fetch resident memory for; default 10 */
    top?: number;
    /** which column the top-N cut is taken on; default 'cpu' */
    sort?: ProcessSortKey;
    /** flip the sort direction before the cut, so `top` keeps the other end */
    sortReverse?: boolean;
    /** do not let the sampling timer hold the process open */
    unref?: boolean;
};


export type SystemSnapshot = {
    timestamp: number;
    /** real length of the window this snapshot measured, in milliseconds */
    elapsedMs: number;
    cpu?: CpuInfo[];
    cpuOverall?: CpuInfo;
    memory?: MemoryInfo;
    load?: Probe<LoadAverage>;
    disk?: Probe<{ disk: DiskInfo }>;
    network?: Probe<NetworkRates>;
    processes?: Probe<{ processes: ProcessLoad[] }>;
    containers?: Probe<ContainerList>;
};


const DEFAULT_COLLECTORS: CollectorName[] = ['cpu', 'memory', 'load'];


type Baseline = {
    cpu: CpuInfo[];
    network: Probe<NetworkCounters> | null;
    processes: Probe<ProcessSnapshot> | null;
    containers: Probe<ContainerList> | null;
    at: number;
};


function readBaseline(collect: Set<CollectorName>, options?: CollectorOptions): Baseline
{
    return {
        cpu: collect.has('cpu') ? getCpuInfo() : [],
        network: collect.has('network') ? getNetworkCounters(options) : null,
        processes: collect.has('process') ? getProcessCounters(options) : null,
        containers: collect.has('container') ? listContainers(options) : null,
        at: Date.now(),
    };
}


/**
 * Diff two counter readings, but only when both of them succeeded.
 *
 * A failed read at either end has nothing to diff. The live failure is
 * preferred over the stale one, so the reason reported is the reason the
 * current read gave.
 */
function pairwise<T, R>(
    before: Probe<T> | null,
    after: Probe<T> | null,
    diff: (before: T, after: T) => Probe<R>,
): Probe<R>
{
    if (before === null || after === null) {
        return { available: false, reason: 'not-applicable' };
    }

    if (!after.available) {
        return after;
    }

    if (!before.available) {
        return before;
    }

    return diff(before, after);
}


/**
 * Attach a CPU percentage to each container that was present at both ends of
 * the window. A container started mid-window has no baseline and keeps its
 * undefined cpuPercentage until the next one.
 */
function withContainerCpu(before: ContainerInfo[], after: ContainerInfo[], elapsedMs: number): ContainerInfo[]
{
    const baseline = new Map(before.map(item => [item.path, item]));

    return after.map(item => {
        const previous = baseline.get(item.path);

        if (previous === undefined) {
            return item;
        }

        return { ...item, ...diffContainerCpu(previous.cpu, item.cpu, elapsedMs) };
    });
}


/**
 * A snapshot of everything that does not need a window.
 *
 * This is what the no-window CLI views use: memory, load and disk are all
 * point-in-time readings, so making the user wait a sampling interval for them
 * would be pure latency. Counter-derived fields are absent here by definition.
 */
export function sampleSystem(options: Partial<SystemMonitorOptions> = {}): SystemSnapshot
{
    const collect = new Set(options.collect ?? DEFAULT_COLLECTORS);
    const snapshot: SystemSnapshot = { timestamp: Date.now(), elapsedMs: 0 };

    if (collect.has('memory')) {
        snapshot.memory = getMemoryInfo(options);
    }

    if (collect.has('load')) {
        snapshot.load = getLoadAverage();
    }

    if (collect.has('disk')) {
        snapshot.disk = getDiskUsage(options.mount);
    }

    return snapshot;
}


export class SystemMonitor extends EventEmitter
{
    readonly ms: number;
    /** null while stopped */
    intervalId: NodeJS.Timeout | null;

    private readonly collect: Set<CollectorName>;
    private readonly options: SystemMonitorOptions;
    private readonly shouldUnref: boolean;
    private baseline: Baseline;

    constructor(options: number | SystemMonitorOptions)
    {
        super();

        const opts: SystemMonitorOptions = typeof options === 'number'
            ? { intervalMs: options }
            : options;

        this.ms = opts.intervalMs;
        this.options = opts;
        this.collect = new Set(opts.collect ?? DEFAULT_COLLECTORS);
        this.shouldUnref = opts.unref ?? false;
        this.baseline = readBaseline(this.collect, opts);
        this.intervalId = null;

        this.start();
    }

    /**
     * Begin sampling. Safe to call on a running monitor, and safe after
     * stopMonitor() - the baseline is re-read so the first sample after a
     * restart measures the new window rather than the gap, exactly as
     * CpuMonitor.start() does.
     */
    start()
    {
        if (this.intervalId !== null) {
            return;
        }

        this.baseline = readBaseline(this.collect, this.options);
        this.intervalId = setInterval(() => this.measure(), this.ms);

        if (this.shouldUnref) {
            this.intervalId.unref();
        }
    }

    /** Stop sampling. Listeners the caller registered are left attached. */
    stopMonitor()
    {
        if (this.intervalId === null) {
            return;
        }

        clearInterval(this.intervalId);
        this.intervalId = null;
    }

    /** Alias for stopMonitor(), matching the usual Node resource vocabulary. */
    close()
    {
        this.stopMonitor();
    }

    get running(): boolean
    {
        return this.intervalId !== null;
    }

    measure()
    {
        // this runs from setInterval, so anything thrown here would be an
        // uncaught exception that takes down the host process
        try {
            const now = Date.now();
            // the real elapsed time, not this.ms: setInterval drifts, and every
            // derived rate would inherit the error
            const elapsedMs = now - this.baseline.at;

            const snapshot = sampleSystem({ ...this.options, collect: [...this.collect] });

            snapshot.timestamp = now;
            snapshot.elapsedMs = elapsedMs;

            const next = readBaseline(this.collect, this.options);

            if (this.collect.has('cpu')) {
                if (next.cpu.length !== this.baseline.cpu.length) {
                    // cores came or went (hotplug, cgroup change) - resync and
                    // skip this tick, the next one has a comparable baseline
                    this.baseline = next;
                    return;
                }

                snapshot.cpu = getCpuDiff(this.baseline.cpu, next.cpu);
                snapshot.cpuOverall = aggregateCpu(snapshot.cpu);
            }

            if (this.collect.has('network')) {
                snapshot.network = pairwise(
                    this.baseline.network,
                    next.network,
                    (before, after) => ({ available: true, ...diffNetwork(before, after, elapsedMs) }),
                );
            }

            if (this.collect.has('process')) {
                snapshot.processes = pairwise(
                    this.baseline.processes,
                    next.processes,
                    (before, after) => ({
                        available: true,
                        processes: selectProcesses(diffProcesses(before, after), this.options),
                    }),
                );
            }

            if (this.collect.has('container')) {
                snapshot.containers = pairwise(
                    this.baseline.containers,
                    next.containers,
                    (before, after) => ({
                        available: true,
                        scope: after.scope,
                        containers: withContainerCpu(before.containers, after.containers, elapsedMs),
                    }),
                );
            }

            this.baseline = next;
            this.emit('sample', snapshot);
        }
        catch (err) {
            this.emit('error', err);
        }
    }

}
