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


export function getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[]
{
    const res: CpuInfo[] = [];

    if (prev.length != current.length) {
        throw new Error("Arrays of same lengths should be supplied to function call: getCpuDiff()");
    }

    for (let i=0; i<prev.length; i++ ) {
        const p = prev[i];
        const c = current[i];

        const newitem: CpuInfo = {
            model: p.model,
            idle: c.idle - p.idle,
            total: c.total - p.total,
            load: c.load - p.load,
        };

        // a sampling interval shorter than one clock tick gives an empty
        // window - report 0 rather than dividing by zero into NaN
        newitem.loadRatio = newitem.total > 0 ? newitem.load / newitem.total : 0;
        newitem.loadPercentage = Math.min(100, Math.max(0, Math.floor(newitem.loadRatio * 100)));

        res.push(newitem);
    }

    return res;
}


export class CpuMonitor extends EventEmitter
{
    ms: number;
    intervalId: NodeJS.Timeout;
    current: Array<CpuInfo>;

    constructor(ms: number)
    {
        super();
        this.ms = ms;
        this.current = this.getCpuInfo();
        this.intervalId = setInterval(() => this.measureCpu(), this.ms);
    }

    stopMonitor()
    {
        clearInterval(this.intervalId);
        this.removeAllListeners();
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
