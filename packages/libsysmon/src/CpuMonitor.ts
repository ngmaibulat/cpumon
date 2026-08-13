import os from 'os';
import EventEmitter from 'events';


export type CpuTimes = {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
}


export type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
}


/**
 * Convert one raw `os.cpus()` entry into a CpuInfo sample.
 * Every field of `times` counts towards the total, so `nice` and `irq`
 * are accounted for and a future Node release adding a field is picked up
 * automatically. Load is everything that is not idle.
 */
export function toCpuInfo(model: string, times: CpuTimes): CpuInfo
{
    const total = Object.values(times).reduce((sum, ticks) => sum + ticks, 0);

    return {
        model,
        idle: times.idle,
        load: total - times.idle,
        total,
    };
}


export function getCpuInfo(): CpuInfo[]
{
    return os.cpus().map(item => toCpuInfo(item.model, item.times));
}


/**
 * Fill in `loadRatio` and `loadPercentage` from the tick counts.
 *
 * Kept as one shared function so per-core and aggregate figures round
 * identically - deriving the aggregate separately lets the two drift, and a
 * total that disagrees with its own cores is the kind of bug nobody reports.
 */
export function withLoadRatio(info: CpuInfo): CpuInfo
{
    // a sampling interval shorter than one clock tick gives an empty
    // window - report 0 rather than dividing by zero into NaN
    const loadRatio = info.total > 0 ? info.load / info.total : 0;

    return {
        ...info,
        loadRatio,
        loadPercentage: Math.min(100, Math.max(0, Math.floor(loadRatio * 100))),
    };
}


/**
 * Collapse per-core samples into a single machine-wide figure by summing the
 * raw tick counts, not by averaging the percentages - averaging weights a core
 * that was idle for most of the window the same as one that was saturated.
 */
export function aggregateCpu(cores: CpuInfo[]): CpuInfo
{
    if (cores.length === 0) {
        throw new Error("aggregateCpu() needs at least one core sample");
    }

    let idle = 0;
    let load = 0;
    let total = 0;

    for (const core of cores) {
        idle += core.idle;
        load += core.load;
        total += core.total;
    }

    return withLoadRatio({ model: cores[0].model, idle, load, total });
}


export function getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[]
{
    const res: CpuInfo[] = [];

    if (prev.length != current.length) {
        throw new Error("Arrays of same lengths should be supplied to function call: getCpuDiff()");
    }

    for (let i=0; i<prev.length; i++ ) {
        const p = prev[i];
        const c = current[i];

        res.push(withLoadRatio({
            model: p.model,
            idle: c.idle - p.idle,
            total: c.total - p.total,
            load: c.load - p.load,
        }));
    }

    return res;
}


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


export class CpuMonitor extends EventEmitter
{
    ms: number;
    /** null while stopped */
    intervalId: NodeJS.Timeout | null;
    current: Array<CpuInfo>;
    private readonly shouldUnref: boolean;

    constructor(options: number | CpuMonitorOptions)
    {
        super();

        const opts: CpuMonitorOptions = typeof options === 'number'
            ? { intervalMs: options }
            : options;

        this.ms = opts.intervalMs;
        this.shouldUnref = opts.unref ?? false;
        this.current = this.getCpuInfo();
        this.intervalId = null;

        this.start();
    }

    /**
     * Begin sampling. Safe to call on an already-running monitor, and safe to
     * call again after stopMonitor() - the baseline is re-read so the first
     * sample after a restart measures the new window, not the gap.
     */
    start()
    {
        if (this.intervalId !== null) {
            return;
        }

        this.current = this.getCpuInfo();
        this.intervalId = setInterval(() => this.measureCpu(), this.ms);

        if (this.shouldUnref) {
            this.intervalId.unref();
        }
    }

    /**
     * Stop sampling.
     *
     * Changed in 0.2.0: this no longer calls removeAllListeners(). Detaching
     * handlers the caller registered was surprising, made the monitor
     * single-use, and silently dropped their 'error' listener.
     */
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

    getCpuInfo(): CpuInfo[]
    {
        return getCpuInfo();
    }


    getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[]
    {
        return getCpuDiff(prev, current);
    }


    measureCpu()
    {
        // this runs from setInterval, so anything thrown here would be an
        // uncaught exception that takes down the host process
        try {
            const next: CpuInfo[] = getCpuInfo();

            if (next.length !== this.current.length) {
                // cores came or went (hotplug, cgroup change) - resync and
                // skip this tick, the next one has a comparable baseline
                this.current = next;
                return;
            }

            const load = getCpuDiff(this.current, next);
            this.current = next;
            this.emit('cpudata', load);
        }
        catch (err) {
            this.emit('error', err);
        }
    }
}
