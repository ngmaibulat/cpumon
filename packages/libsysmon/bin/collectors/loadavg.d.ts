/**
 * System load average.
 *
 * The raw 1/5/15 minute figures are only meaningful next to the core count - a
 * load of 8 is idle on a 32-core box and a crisis on a 2-core one - so every
 * figure is also reported divided by the number of cores, where 1.0 means
 * "exactly committed" regardless of machine size.
 */
import type { Probe } from '../types.js';
export type LoadAverage = {
    one: number;
    five: number;
    fifteen: number;
    cores: number;
    /** load divided by core count; 1.0 is fully committed */
    onePerCore: number;
    fivePerCore: number;
    fifteenPerCore: number;
};
export declare function toLoadAverage(avg: readonly [number, number, number], cores: number): LoadAverage;
export declare function getLoadAverage(): Probe<LoadAverage>;
