#!/usr/bin/env node

import chalk from 'chalk';

import { CpuInfo, CpuMonitor } from './CpuMonitor.js';
import { getProgressBar } from './utils.js';

const mon = new CpuMonitor(1000);


// EventEmitter rethrows an 'error' event that has no listener, so without
// this a bad sample would kill the CLI instead of skipping a frame
mon.on('error', (err: Error) => {
    console.error(chalk.red(`cpumon: ${err.message}`));
});


mon.on('cpudata', (load: CpuInfo[]) => {

    const symbol = '|';

    const diags = load.map(cpu => getProgressBar(cpu.loadPercentage ?? 0, symbol));

    console.clear();

    const fmt = {
        minimumIntegerDigits: 2,
        useGrouping: false
    };

    for (let i=1; i<=diags.length; i++) {
        console.log(i.toLocaleString('en-US',fmt), diags[i-1]);
    }
})


/**
 * todo:
 * json colored output
 * cli params: table vs json output, count times vs watch mode
 * rest api
 */
