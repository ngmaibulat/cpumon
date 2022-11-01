#!/usr/bin/env node

import os from 'os';
import EventEmitter from 'events';
import chalk from 'chalk';

import { CpuInfo, StrFunction, LoadInfo} from './types.js';
import { CpuMonitor } from './CpuMonitor.js';
import { getProgressBar } from './utils.js';

const mon = new CpuMonitor(1000);

mon.on('cpudata', ({current, load}: LoadInfo) => {
    console.log(current);

    const diags = load.map(current => {
        
        if (typeof current.loadPercentage != 'number') {
            throw new Error("loadPercentage must be a number!");
        }

        const symbol = '|';

        return getProgressBar(current.loadPercentage,  symbol, chalk.green);
    });

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
