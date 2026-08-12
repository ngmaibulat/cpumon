/**
 * System load average.
 *
 * The raw 1/5/15 minute figures are only meaningful next to the core count - a
 * load of 8 is idle on a 32-core box and a crisis on a 2-core one - so every
 * figure is also reported divided by the number of cores, where 1.0 means
 * "exactly committed" regardless of machine size.
 */

import os from 'os';

import { unavailable } from '../types.js';
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


export function toLoadAverage(avg: readonly [number, number, number], cores: number): LoadAverage
{
    const perCore = (value: number) => (cores > 0 ? value / cores : 0);
    const [one, five, fifteen] = avg;

    return {
        one,
        five,
        fifteen,
        cores,
        onePerCore: perCore(one),
        fivePerCore: perCore(five),
        fifteenPerCore: perCore(fifteen),
    };
}


export function getLoadAverage(): Probe<LoadAverage>
{
    // os.loadavg() does not fail on Windows, it returns [0, 0, 0] - which would
    // render as a permanently idle machine. Reporting that there is nothing to
    // report is the honest answer
    if (process.platform === 'win32') {
        return unavailable('not-applicable', 'Windows has no load average');
    }

    const [one, five, fifteen] = os.loadavg();

    // os.cpus().length rather than os.availableParallelism(), which would add a
    // second Node version floor for no benefit here
    return { available: true, ...toLoadAverage([one, five, fifteen], os.cpus().length) };
}
