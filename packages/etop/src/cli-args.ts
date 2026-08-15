/**
 * Argument parsing and help text for the `etop` binary.
 *
 * Split from cli.tsx for the same reason libsysmon splits cli.ts from cpumon.ts:
 * nothing here writes to a stream or exits, so a test can call it directly
 * instead of spawning a process. cli.tsx owns all the I/O and is the only file
 * with a top-level side effect.
 *
 * OPTIONS is the single source of truth - it feeds both parseArgs() and
 * buildHelp(), so a flag cannot exist in one and be missing from the other.
 */

import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import type { GraphStyle, ThemeName, TuiOptions } from '../types/index.js';


export type CliOptions = TuiOptions & {
    help: boolean;
    version: boolean;
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
};


export const OPTIONS: OptionSpec[] = [
    { long: 'interval', short: 'i', arg: 'ms', description: 'sampling interval in milliseconds', default: '1000' },
    { long: 'mount', arg: 'path', description: 'filesystem the disk panel reports on', default: 'the current filesystem root' },
    { long: 'theme', arg: 'name', description: 'auto, default, ansi16 or mono', default: 'auto' },
    { long: 'graph', arg: 'style', description: 'auto, block, braille or ascii', default: 'auto' },
    { long: 'allow-kill', description: 'enable sending signals to processes from the table' },
    // parseArgs has no --no-x negation, so the option is literally named
    // "no-color" - without declaring it, strict mode rejects the flag outright
    { long: 'no-color', description: 'draw without colour' },
    { long: 'version', short: 'v', description: 'print version and exit' },
    { long: 'help', short: 'h', description: 'show this help and exit' },
];


const THEMES: ThemeName[] = ['auto', 'default', 'ansi16', 'mono'];
const GRAPHS: GraphStyle[] = ['auto', 'block', 'braille', 'ascii'];

/** below 100ms the sampling cost starts to show up in the sample */
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 60_000;


function toParseArgsConfig()
{
    const config: Record<string, { type: 'string' | 'boolean'; short?: string }> = {};

    for (const opt of OPTIONS) {
        config[opt.long] = opt.arg === undefined ? { type: 'boolean' } : { type: 'string' };

        if (opt.short !== undefined) {
            config[opt.long].short = opt.short;
        }
    }

    return config;
}


/**
 * Accept only what makes sense as a count of milliseconds. The check is on the
 * parsed value rather than the string, because Number('') is 0 and
 * Number('1e3') is 1000.
 */
function interval(raw: string): number
{
    const value = Number(raw);

    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new CliError(`--interval expects a whole number of milliseconds, got "${raw}"`);
    }

    if (value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) {
        throw new CliError(`--interval must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS} ms, got ${value}`);
    }

    return value;
}


function oneOf<T extends string>(raw: string, allowed: T[], flag: string): T
{
    if (!(allowed as string[]).includes(raw)) {
        throw new CliError(`${flag} expects one of ${allowed.join(', ')}, got "${raw}"`);
    }

    return raw as T;
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

    return {
        intervalMs: values.interval === undefined ? 1000 : interval(values.interval as string),
        // an unreadable path is a runtime fact reported as an unavailable
        // probe, not a usage error, so it is not validated here
        mount: values.mount as string | undefined,
        theme: values.theme === undefined ? 'auto' : oneOf(values.theme as string, THEMES, '--theme'),
        graph: values.graph === undefined ? 'auto' : oneOf(values.graph as string, GRAPHS, '--graph'),
        allowKill: values['allow-kill'] === true,
        color: values['no-color'] !== true,
        help: values.help === true,
        version: values.version === true,
    };
}


/**
 * What the argv asked for: the dashboard, or a tunnel subcommand.
 *
 * The router sits *above* parseCliArgs rather than inside it, and that is the
 * whole design. parseCliArgs keeps `allowPositionals: false`, so the dashboard's
 * contract is unchanged and a stray word still gets the error it always did -
 * while the tunnel parser gets its own flag set that cannot leak into the TUI's
 * help, and vice versa. Turning positionals on globally would have meant
 * telling "subcommand" and "typo" apart after the fact, which is exactly the
 * ambiguity worth not having.
 */
export type Cli =
    | { kind: 'tui'; options: CliOptions }
    | { kind: 'tunnel'; command: TunnelCommand };


export type TunnelCommand =
    | { verb: 'help' }
    | { verb: 'list'; configPath?: string; json: boolean }
    | { verb: 'status'; configPath?: string; json: boolean }
    | { verb: 'edit'; configPath?: string }
    | { verb: 'up'; names: string[]; all: boolean; configPath?: string };


const TUNNEL_VERBS = ['list', 'status', 'up', 'edit', 'help'] as const;

const TUNNEL_OPTIONS: OptionSpec[] = [
    { long: 'config', arg: 'path', description: 'read this config instead of the default' },
    { long: 'all', description: 'up: start every tunnel marked autostart' },
    { long: 'json', description: 'list, status: machine-readable output' },
    { long: 'help', short: 'h', description: 'show this help and exit' },
];


export function parseCli(argv: string[]): Cli
{
    const first = argv[0];

    if (first === 'tunnel') {
        return { kind: 'tunnel', command: parseTunnelArgs(argv.slice(1)) };
    }

    return { kind: 'tui', options: parseCliArgs(argv) };
}


export function parseTunnelArgs(argv: string[]): TunnelCommand
{
    let values;
    let positionals;

    try {
        ({ values, positionals } = parseArgs({
            args: argv,
            options: {
                config: { type: 'string' },
                all: { type: 'boolean' },
                json: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
            },
            strict: true,
            allowPositionals: true,
        }));
    }
    catch (err) {
        throw new CliError((err as Error).message);
    }

    const configPath = values.config as string | undefined;
    const json = values.json === true;

    if (values.help === true || positionals.length === 0) {
        return { verb: 'help' };
    }

    const [word, ...rest] = positionals;

    if (!(TUNNEL_VERBS as readonly string[]).includes(word!)) {
        throw new CliError(`unknown command "${word}"; expected ${TUNNEL_VERBS.join(', ')}`);
    }

    // narrowed by the check above; the cast is what lets the returns below be
    // checked against TunnelCommand rather than widened to string
    const verb = word as (typeof TUNNEL_VERBS)[number];

    if (verb === 'help') {
        return { verb: 'help' };
    }

    if (verb === 'up') {
        const all = values.all === true;

        if (!all && rest.length === 0) {
            throw new CliError('etop tunnel up needs a tunnel name, or --all');
        }

        return configPath === undefined
            ? { verb: 'up', names: rest, all }
            : { verb: 'up', names: rest, all, configPath };
    }

    if (rest.length > 0) {
        throw new CliError(`etop tunnel ${verb} takes no arguments, got "${rest[0]}"`);
    }

    if (verb === 'edit') {
        return configPath === undefined ? { verb: 'edit' } : { verb: 'edit', configPath };
    }

    return configPath === undefined
        ? { verb, json }
        : { verb, json, configPath };
}


export function buildTunnelHelp(): string
{
    const flags = TUNNEL_OPTIONS.map(formatFlag);
    const width = Math.max(...flags.map(flag => flag.length));

    return [
        'etop tunnel - run and inspect the SSH tunnels in your config',
        '',
        'Usage:  etop tunnel <command> [options]',
        '',
        'Commands:',
        '  list                   the tunnels the config declares',
        '  status                 which of their local ports are listening, and who holds them',
        '  up <name...> | --all   run them in the foreground, reconnecting; Ctrl-C to stop',
        '  edit                   open the config in $VISUAL or $EDITOR',
        '',
        'Options:',
        ...TUNNEL_OPTIONS.map((opt, i) => `${flags[i].padEnd(width)}  ${opt.description}`),
        '',
        'There is deliberately no `down`. A tunnel is stopped by the thing that',
        'started it: Ctrl-C here, or x on the tunnels screen. Finding somebody',
        "else's ssh by the shape of its arguments and killing it is a guess.",
        '',
    ].join('\n');
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

    return [
        'etop - a full-screen dashboard for CPU, memory, disk, network and processes',
        '',
        'Usage:  etop [options]',
        '',
        'Options:',
        ...OPTIONS.map((opt, i) => {
            const tail = opt.default === undefined ? '' : `  (default: ${opt.default})`;
            return `${flags[i].padEnd(width)}  ${opt.description}${tail}`;
        }),
        '',
        'Press ? inside the dashboard for the key bindings.',
        '',
        'For output you can pipe or script against, use cpumon itself:',
        '  cpumon --json          a stream of samples as NDJSON',
        '  cpumon --fetch         a one-shot system summary',
        '',
    ].join('\n');
}


/**
 * Read the version off the package manifest rather than duplicating it in the
 * source. This resolves from dist/ at runtime, and npm always ships
 * package.json, so it works from the published tarball as well as the repo.
 */
export function getVersion(): string
{
    const require = createRequire(import.meta.url);

    return (require('../package.json') as { version: string }).version;
}
