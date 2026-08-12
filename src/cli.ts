/**
 * Argument parsing and help text for the `cpumon` binary.
 *
 * Deliberately free of chalk and of side effects: nothing here writes to a
 * stream or exits, so the parser can be unit tested (test/cli.test.js) without
 * spawning a process. src/cpumon.ts owns all the I/O.
 *
 * OPTIONS below is the single source of truth - it feeds both parseArgs() and
 * buildHelp(), so a flag can never exist in one and be missing from the other.
 */

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { defaultMount } from './collectors/disk.js';


/**
 * What to show. One subject per run.
 *
 * 'bars' is the default and has no flag of its own; every other member is
 * selected by the OPTIONS entry that names it.
 */
export type CliMode =
    | 'bars' | 'overall' | 'fetch'
    | 'mem' | 'load' | 'disk' | 'net' | 'proc' | 'containers';

/**
 * How to show it. Orthogonal to the subject, which is why --json is not a mode:
 * "machine readable" and "which metric" are different questions, and making
 * them compete for one slot means `--mem --json` can never be expressed.
 */
export type CliFormat = 'text' | 'json';


export type CliOptions = {
    /** sampling interval in milliseconds */
    intervalMs: number;
    /** stop after this many samples; null means run until interrupted */
    count: number | null;
    mode: CliMode;
    format: CliFormat;
    /** filesystem the disk figures report on */
    mount: string;
    /** how many rows the table modes show */
    top: number;
    color: boolean;
    help: boolean;
    version: boolean;
};


export type ModeName = Exclude<CliMode, 'bars'>;


export type ModeTraits = {
    /** needs two samples, so the runner waits an interval before printing */
    needsWindow: boolean;
    /** count defaults to 1 */
    oneShot: boolean;
    /** clear the screen between frames, on a TTY in text format */
    clears: boolean;
};


/**
 * Per-mode behaviour, in one exhaustive table rather than scattered across
 * `mode === 'fetch'` and `mode === 'bars'` conditionals. Because it is a
 * Record over the closed CliMode union, adding a mode fails to compile until
 * its behaviour has been declared here.
 */
export const MODE_TRAITS: Record<CliMode, ModeTraits> = {
    bars:    { needsWindow: true, oneShot: false, clears: true },
    overall: { needsWindow: true, oneShot: false, clears: false },
    fetch:   { needsWindow: true, oneShot: true, clears: false },
    // nothing to diff, so these print at once rather than making the user wait
    // an interval for the equivalent of `free` or `df`
    mem:     { needsWindow: false, oneShot: true, clears: false },
    load:    { needsWindow: false, oneShot: true, clears: false },
    disk:    { needsWindow: false, oneShot: true, clears: false },
    // counters, so a rate needs a window; top-shaped, so they refresh
    net:     { needsWindow: true, oneShot: false, clears: true },
    proc:    { needsWindow: true, oneShot: false, clears: true },
    // waits one window so the cgroup CPU figures are real, then exits
    containers: { needsWindow: true, oneShot: true, clears: false },
};


/** A usage problem, as opposed to a runtime failure - carries the exit code. */
export class CliError extends Error
{
    readonly exitCode: number;

    constructor(message: string, exitCode = 2)
    {
        super(message);
        this.name = 'CliError';
        this.exitCode = exitCode;
    }
}


type OptionSpec = {
    long: string;
    short?: string;
    /** placeholder shown in help; its presence is what makes the flag take a value */
    arg?: string;
    description: string;
    default?: string;
    /**
     * The subject this boolean flag selects. Every spec carrying one is
     * mutually exclusive with every other, and the conflict check is derived
     * from this field - so a new mode cannot be added to the parser and
     * forgotten in the exclusion list, as it could when that list was a
     * hardcoded array.
     */
    mode?: ModeName;
};


export const OPTIONS: OptionSpec[] = [
    { long: 'interval', short: 'i', arg: 'ms', description: 'sampling interval in milliseconds', default: '1000' },
    { long: 'count', short: 'n', arg: 'n', description: 'exit after n samples', default: 'run until Ctrl-C' },
    { long: 'json', description: 'emit JSON instead of formatted text' },
    { long: 'overall', short: 'o', mode: 'overall', description: 'print a single machine-wide load line' },
    { long: 'fetch', mode: 'fetch', description: 'print a one-shot system summary panel and exit' },
    { long: 'mem', mode: 'mem', description: 'print memory and swap usage and exit' },
    { long: 'load', mode: 'load', description: 'print the 1/5/15 minute load average and exit' },
    { long: 'disk', mode: 'disk', description: 'print filesystem usage and exit' },
    { long: 'net', mode: 'net', description: 'show per-interface network throughput' },
    { long: 'proc', mode: 'proc', description: 'show the busiest processes' },
    { long: 'containers', mode: 'containers', description: 'show cgroup limits and container usage' },
    { long: 'mount', arg: 'path', description: 'filesystem to report disk usage for', default: 'the current filesystem root' },
    { long: 'top', arg: 'n', description: 'how many rows the table views show', default: '10' },
    // parseArgs has no --no-x negation, so the option is literally named
    // "no-color" - without declaring it, strict mode rejects the flag outright
    { long: 'no-color', description: 'disable coloured output' },
    { long: 'version', short: 'v', description: 'print version and exit' },
    { long: 'help', short: 'h', description: 'show this help and exit' },
];


/** Every spec that selects a subject. The exclusion set, derived not repeated. */
const MODE_SPECS = OPTIONS.filter(
    (opt): opt is OptionSpec & { mode: ModeName } => opt.mode !== undefined,
);


function toParseArgsConfig()
{
    const config: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};

    for (const opt of OPTIONS) {
        config[opt.long] = opt.arg === undefined
            ? { type: 'boolean' }
            : { type: 'string' };

        if (opt.short !== undefined) {
            config[opt.long].short = opt.short;
        }
    }

    return config;
}


/**
 * Accept only what Number() would accept *and* what makes sense as a count of
 * milliseconds or samples. Number('') is 0 and Number('1e3') is 1000, so the
 * check is on the parsed value, not on the string.
 */
function positiveInteger(raw: string, flag: string): number
{
    const value = Number(raw);

    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
        throw new CliError(`${flag} expects a positive whole number, got "${raw}"`);
    }

    return value;
}


export function parseCliArgs(argv: string[]): CliOptions
{
    let values;

    try {
        ({ values } = parseArgs({
            args: argv,
            options: toParseArgsConfig(),
            strict: true,
            allowPositionals: false,
        }));
    }
    catch (err) {
        // parseArgs throws plain TypeErrors with a readable message for unknown
        // options, missing values and stray positionals - all usage errors
        throw new CliError((err as Error).message);
    }

    const selected = MODE_SPECS.filter(spec => values[spec.long] === true);

    if (selected.length > 1) {
        throw new CliError(`--${selected[0].long} and --${selected[1].long} cannot be combined`);
    }

    const mode: CliMode = selected[0]?.mode ?? 'bars';

    const intervalMs = values.interval === undefined
        ? 1000
        : positiveInteger(values.interval as string, '--interval');

    // a one-shot subject takes a single sample and is done
    const count = values.count === undefined
        ? (MODE_TRAITS[mode].oneShot ? 1 : null)
        : positiveInteger(values.count as string, '--count');

    return {
        intervalMs,
        count,
        mode,
        format: values.json === true ? 'json' : 'text',
        // an unreadable path is a runtime fact reported as an unavailable
        // probe, not a usage error, so it is not validated here
        mount: (values.mount as string | undefined) ?? defaultMount(),
        top: values.top === undefined
            ? 10
            : positiveInteger(values.top as string, '--top'),
        color: values['no-color'] !== true,
        help: values.help === true,
        version: values.version === true,
    };
}


function formatFlag(opt: OptionSpec): string
{
    const short = opt.short === undefined ? '    ' : `-${opt.short}, `;
    const arg = opt.arg === undefined ? '' : ` <${opt.arg}>`;

    return `  ${short}--${opt.long}${arg}`;
}


export function buildHelp(): string
{
    const flags = OPTIONS.map(formatFlag);
    const width = Math.max(...flags.map(flag => flag.length));

    const lines = OPTIONS.map((opt, i) => {
        const tail = opt.default === undefined ? '' : `  (default: ${opt.default})`;
        return `${flags[i].padEnd(width)}  ${opt.description}${tail}`;
    });

    return [
        'cpumon - monitor CPU load and system resources',
        '',
        'Usage:  cpumon [options]',
        '',
        'Options:',
        ...lines,
        '',
        'View flags select what to show and cannot be combined with each other:',
        `  ${MODE_SPECS.map(spec => `--${spec.long}`).join(' ')}`,
        '',
        '--json selects how it is shown, and combines with any view.',
        '',
        'Examples:',
        '  cpumon -i 500                 refresh twice a second',
        '  cpumon --json -n 5            five samples as JSON, then exit',
        '  cpumon --overall              one line for the whole machine',
        '  cpumon --fetch                a one-shot system summary',
        '  cpumon --fetch --json         the same summary, machine readable',
        '',
    ].join('\n');
}


/**
 * Read the version off the package manifest rather than duplicating it in the
 * source. This resolves from bin/cpumon.js at runtime, and npm always ships
 * package.json, so it works from the published tarball as well as the repo.
 */
export function getVersion(): string
{
    const require = createRequire(import.meta.url);

    return require('../package.json').version as string;
}
