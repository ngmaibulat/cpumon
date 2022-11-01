import os from 'os';
import EventEmitter from 'events';
import chalk from 'chalk';

import { CpuMonitor } from './CpuMonitor.js';
import { getProgressBar } from './utils.js';

const mon = new CpuMonitor(1000);

mon.on('cpudata', ({current, load}) => {
    // console.log(current);

    const diags = load.map(current => {
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


const symbol = '|';
const test1 = getProgressBar(0,  symbol, chalk.green);
const test2 = getProgressBar(20, symbol, chalk.green);
const test3 = getProgressBar(56, symbol, chalk.green);
const test4 = getProgressBar(99, symbol, chalk.green);

// console.log(test1);
// console.log(test2);
// console.log(test3);
// console.log(test4);



/**
 * todo:
 * periodic update with nice ui - like htop
 * json colored output
 * cli/scriptable interface
 * event emitter based class
 * rest api
 */
