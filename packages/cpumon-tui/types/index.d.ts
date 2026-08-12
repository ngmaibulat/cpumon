/**
 * The public surface of cpumon-tui, hand-written rather than generated.
 *
 * Everything inside src/ is an application's internals, not a contract, and a
 * generated declaration tree would also make @types/react a resolution
 * requirement for anyone who merely depends on this package. Type safety
 * inside the package comes from `npm run typecheck`, which is where it belongs.
 *
 * src/ imports its option types straight from this file rather than declaring
 * its own copies. That is deliberate: two hand-written definitions of the same
 * shape drift, and the drift shows up as a published package whose types
 * describe an older version of its own flags.
 */

export type GraphStyle = 'auto' | 'block' | 'braille' | 'ascii';

export type ThemeName = 'auto' | 'default' | 'ansi16' | 'mono';

export type TuiOptions = {
    /** sampling interval in milliseconds; default 1000 */
    intervalMs?: number;
    /** filesystem the disk panel reports on; defaults to the current root */
    mount?: string;
    /** how many process rows to keep; the dashboard overrides this from the
     *  height it actually has, so it is only a starting point */
    top?: number;
    /** force colour on or off; defaults to what the terminal reports */
    color?: boolean;
    theme?: ThemeName;
    graph?: GraphStyle;
    /** enable the process kill modal; off unless the user opts in */
    allowKill?: boolean;
};

/** Resolves with the process exit code once the user quits. */
export declare function runTui(options?: TuiOptions): Promise<number>;
