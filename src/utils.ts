import os from 'os';
import chalk from 'chalk';
import {CpuInfo, StrFunction} from './types.js';


export function getProgressBar(progress: number, symbol: string, fn: StrFunction): string
{
    if (progress < 0 || progress > 100) {
        throw new Error("getProgressBar(): progress should be in range of from 0 to 100");
    }

    let res = '[';
    for (let i=0; i<progress; i++) {
        res += fn(symbol);
    }
    for (let i=progress; i<100; i++) {
        res += ' ';
    }
    const percent = chalk.yellowBright(`${progress}%`);
    res += `${percent}]`;

    return res;
}


export function getCpuInfo(): Array<CpuInfo>
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


export function sleep(ms: number)
{
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}


export async function getCpuLoad(prev: Array<CpuInfo>, ms: number)
{
    if (!prev.length) {
        prev = getCpuInfo();
    }

    await sleep(ms);

    const current = getCpuInfo();
    const load = getCpuDiff(prev, current);

    return {current, load};
}


export function getCpuDiff(prev: Array<CpuInfo>, current: Array<CpuInfo>)
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
