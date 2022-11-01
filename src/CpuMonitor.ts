import os from 'os';
import EventEmitter from 'events';


export type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
}


export class CpuMonitor extends EventEmitter
{
    ms: number;
    current: Array<CpuInfo>;
    
    constructor(ms: number)
    {
        super();
        this.ms = ms;
        this.current = this.getCpuInfo();

        setInterval(() => this.measureCpu(), this.ms);
    }

    getCpuInfo(): CpuInfo[]
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


    getCpuDiff(prev: CpuInfo[], current: CpuInfo[])
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


    measureCpu()
    {
        const next: CpuInfo[] = this.getCpuInfo();
        const load = this.getCpuDiff(this.current, next);
        this.current = next;
        this.emit('cpudata', load);
    }
}
