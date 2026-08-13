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
import type { CpuInfo } from './CpuMonitor.js';
import type { Probe } from './types.js';
import type { DiskInfo } from './collectors/disk.js';
import type { LoadAverage } from './collectors/loadavg.js';
import type { MemoryInfo } from './collectors/memory.js';
import type { NetworkRates } from './collectors/network.js';
import type { ProcessLoad, ProcessSortKey } from './collectors/process.js';
import type { ContainerInfo } from './collectors/container.js';
import type { CollectorOptions } from './collectors/proc.js';
export type CollectorName = 'cpu' | 'memory' | 'load' | 'disk' | 'network' | 'process' | 'container';
type ContainerList = {
    containers: ContainerInfo[];
    scope: 'host' | 'namespaced';
};
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
    disk?: Probe<{
        disk: DiskInfo;
    }>;
    network?: Probe<NetworkRates>;
    processes?: Probe<{
        processes: ProcessLoad[];
    }>;
    containers?: Probe<ContainerList>;
};
/**
 * A snapshot of everything that does not need a window.
 *
 * This is what the no-window CLI views use: memory, load and disk are all
 * point-in-time readings, so making the user wait a sampling interval for them
 * would be pure latency. Counter-derived fields are absent here by definition.
 */
export declare function sampleSystem(options?: Partial<SystemMonitorOptions>): SystemSnapshot;
export declare class SystemMonitor extends EventEmitter {
    readonly ms: number;
    /** null while stopped */
    intervalId: NodeJS.Timeout | null;
    private readonly collect;
    private readonly options;
    private readonly shouldUnref;
    private baseline;
    constructor(options: number | SystemMonitorOptions);
    /**
     * Begin sampling. Safe to call on a running monitor, and safe after
     * stopMonitor() - the baseline is re-read so the first sample after a
     * restart measures the new window rather than the gap, exactly as
     * CpuMonitor.start() does.
     */
    start(): void;
    /** Stop sampling. Listeners the caller registered are left attached. */
    stopMonitor(): void;
    /** Alias for stopMonitor(), matching the usual Node resource vocabulary. */
    close(): void;
    get running(): boolean;
    measure(): void;
}
export {};
