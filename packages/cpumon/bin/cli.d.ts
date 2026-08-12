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
/**
 * What to show. One subject per run.
 *
 * 'bars' is the default and has no flag of its own; every other member is
 * selected by the OPTIONS entry that names it.
 */
export type CliMode = 'bars' | 'overall' | 'fetch' | 'mem' | 'load' | 'disk' | 'net' | 'proc' | 'containers';
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
export declare const MODE_TRAITS: Record<CliMode, ModeTraits>;
/** A usage problem, as opposed to a runtime failure - carries the exit code. */
export declare class CliError extends Error {
    readonly exitCode: number;
    constructor(message: string, exitCode?: number);
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
export declare const OPTIONS: OptionSpec[];
export declare function parseCliArgs(argv: string[]): CliOptions;
export declare function buildHelp(): string;
/**
 * Read the version off the package manifest rather than duplicating it in the
 * source. This resolves from bin/cpumon.js at runtime, and npm always ships
 * package.json, so it works from the published tarball as well as the repo.
 */
export declare function getVersion(): string;
export {};
