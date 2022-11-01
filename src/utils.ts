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




export function sleep(ms: number)
{
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms);
    })
}
