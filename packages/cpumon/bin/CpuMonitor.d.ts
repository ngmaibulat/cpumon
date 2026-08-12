import EventEmitter from 'events';
export type CpuTimes = {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
};
export type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
};
/**
 * Convert one raw `os.cpus()` entry into a CpuInfo sample.
 * Every field of `times` counts towards the total, so `nice` and `irq`
 * are accounted for and a future Node release adding a field is picked up
 * automatically. Load is everything that is not idle.
 */
export declare function toCpuInfo(model: string, times: CpuTimes): CpuInfo;
export declare function getCpuInfo(): CpuInfo[];
/**
 * Fill in `loadRatio` and `loadPercentage` from the tick counts.
 *
 * Kept as one shared function so per-core and aggregate figures round
 * identically - deriving the aggregate separately lets the two drift, and a
 * total that disagrees with its own cores is the kind of bug nobody reports.
 */
export declare function withLoadRatio(info: CpuInfo): CpuInfo;
/**
 * Collapse per-core samples into a single machine-wide figure by summing the
 * raw tick counts, not by averaging the percentages - averaging weights a core
 * that was idle for most of the window the same as one that was saturated.
 */
export declare function aggregateCpu(cores: CpuInfo[]): CpuInfo;
export declare function getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[];
export type CpuMonitorOptions = {
    /** sampling interval in milliseconds */
    intervalMs: number;
    /**
     * Do not let the sampling timer hold the process open. Off by default so a
     * bare `new CpuMonitor(1000)` keeps behaving as it always has; embedders
     * that only observe an app they do not own want this on.
     */
    unref?: boolean;
};
export declare class CpuMonitor extends EventEmitter {
    ms: number;
    /** null while stopped */
    intervalId: NodeJS.Timeout | null;
    current: Array<CpuInfo>;
    private readonly shouldUnref;
    constructor(options: number | CpuMonitorOptions);
    /**
     * Begin sampling. Safe to call on an already-running monitor, and safe to
     * call again after stopMonitor() - the baseline is re-read so the first
     * sample after a restart measures the new window, not the gap.
     */
    start(): void;
    /**
     * Stop sampling.
     *
     * Changed in 0.2.0: this no longer calls removeAllListeners(). Detaching
     * handlers the caller registered was surprising, made the monitor
     * single-use, and silently dropped their 'error' listener.
     */
    stopMonitor(): void;
    /** Alias for stopMonitor(), matching the usual Node resource vocabulary. */
    close(): void;
    get running(): boolean;
    getCpuInfo(): CpuInfo[];
    getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[];
    measureCpu(): void;
}
