import os from 'os';
import EventEmitter from 'events';

import {CpuInfo} from './types.js';
import {sleep} from './utils.js';

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

    getCpuInfo(): Array<CpuInfo>
    {
        const cpus = os.cpus();

        return cpus.map(item => {
            const newitem = {
                model: item.model,
                idle: item.times.idle,
                load: item.times.user + item.times.sys,
                total: item.times.idle + item.times.user + item.times.sys,
            }
            // return item;
            return newitem;
        });
    }



    async getCpuLoad(prev: Array<CpuInfo>, ms: number)
    {
        if (!prev.length) {
            prev = this.getCpuInfo();
        }

        await sleep(ms);

        const current = this.getCpuInfo();
        const load = this.getCpuDiff(prev, current);

        return {current, load};
    }


    getCpuDiff(prev: Array<CpuInfo>, current: Array<CpuInfo>)
    {
        let res = [];

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
            newitem.loadRatio = newitem.load / newitem.total;
            newitem.loadPercentage = Math.floor(newitem.loadRatio * 100);

            res.push(newitem);
        }

        return res;
    }



    async onTick()
    {
        const {current, load} = await this.getCpuLoad([], 1000);

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
        const {current, load} = await this.getCpuLoad(this.current, this.ms);
        this.current = current;

        this.emit('cpudata', {current, load});
    }
}
