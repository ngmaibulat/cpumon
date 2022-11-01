import os from 'os';
import EventEmitter from 'events';
import chalk from 'chalk';

import {CpuInfo, StrFunction} from './types.js';
import {getCpuLoad} from './utils.js';

export class CpuMonitor extends EventEmitter
{
    ms: number;
    current: Array<any>;
    
    constructor(ms: number)
    {
        super();
        this.ms = ms;
        this.current = [];

        setInterval(() => this.emit('tick'), this.ms);
        this.on('tick', this.measureCpu);
    }

    async onTick()
    {
        const {current, load} = await getCpuLoad([], 1000);

        const str = load.reduce((prev, current) => {
            return `${prev} ${current.loadPercentage}`;
        }, "cpu: ");

        const fmt = {
            minimumIntegerDigits: 2,
            useGrouping: false
        };

        // const arrdata = load.map( item => item.loadPercentage.toLocaleString('en-US',fmt) );
        const arrdata = load.map( item => item.loadPercentage );

        // console.log(str.toString());
        console.clear();
        console.table({load: arrdata});
    }

    async measureCpu()
    {
        const {current, load} = await getCpuLoad(this.current, this.ms);
        this.current = current;

        this.emit('cpudata', {current, load});
    }
}
