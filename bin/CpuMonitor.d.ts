/// <reference types="node" resolution-mode="require"/>
/// <reference types="node" resolution-mode="require"/>
import EventEmitter from 'events';
export declare type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
};
export declare class CpuMonitor extends EventEmitter {
    ms: number;
    intervalId: NodeJS.Timer;
    current: Array<CpuInfo>;
    constructor(ms: number);
    stopMonitor(): void;
    getCpuInfo(): CpuInfo[];
    getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[];
    measureCpu(): void;
}
