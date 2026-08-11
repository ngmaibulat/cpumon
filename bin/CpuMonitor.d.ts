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
export declare function getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[];
export declare class CpuMonitor extends EventEmitter {
    ms: number;
    intervalId: NodeJS.Timeout;
    current: Array<CpuInfo>;
    constructor(ms: number);
    stopMonitor(): void;
    getCpuInfo(): CpuInfo[];
    getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[];
    measureCpu(): void;
}
