import chalk from 'chalk';


export function getProgressBar(progress: number, symbol: string): string
{
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
        throw new Error("getProgressBar(): progress should be in range of from 0 to 100");
    }

    // colorize the whole run at once - colorizing each symbol repeats the
    // ANSI escape sequence up to 100 times per core per tick
    const filled = chalk.green(symbol.repeat(progress));
    const blank = ' '.repeat(100 - progress);
    const percent = chalk.yellowBright(`${progress}%`);

    return `[${filled}${blank}${percent}]`;
}
