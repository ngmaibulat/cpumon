/**
 * What this terminal can actually do, decided once at startup.
 *
 * Two different questions get answered here and they must not be conflated.
 * "Can I run at all?" is about raw mode, a TTY on both ends, and a terminal
 * that understands cursor movement - if the answer is no, the dashboard has to
 * refuse rather than write escape sequences into someone's pipe. "How should I
 * draw?" is about colour depth and glyph coverage, and every answer to it is
 * still a working dashboard.
 *
 * NO_COLOR belongs to the second question, not the first. A user who has asked
 * for no colour has not asked for no dashboard.
 */

import type { GraphStyle } from '../../types/index.js';


export type Refusal = {
    /** shown to the user; a full sentence, no trailing newline */
    message: string;
    /** the closest thing they can run instead */
    suggestion: string;
};


export type Capabilities = {
    /** null when the dashboard can run */
    refusal: Refusal | null;
    /** chalk's scale: 0 none, 1 sixteen colours, 2 two-fifty-six, 3 truecolor */
    colorLevel: 0 | 1 | 2 | 3;
    /** the terminal will render box-drawing and block characters */
    unicode: boolean;
    /** what `graph: 'auto'` resolves to here */
    graph: Exclude<GraphStyle, 'auto'>;
};


export type Env = NodeJS.ProcessEnv;


export type Streams = {
    stdin: { isTTY?: boolean };
    stdout: { isTTY?: boolean };
};


/**
 * Whether the environment supports a full-screen interactive app.
 *
 * The stdin check is the one that is easy to miss. `etop < /dev/null` has
 * a perfectly good TTY on stdout, and Ink will happily start and then throw
 * "Raw mode is not supported" from inside a render - by which point the
 * alternate screen is already up and the error lands where nobody can read it.
 */
export function checkRefusal(streams: Streams, env: Env): Refusal | null
{
    if (streams.stdout.isTTY !== true) {
        return {
            message: 'the dashboard needs a terminal, and stdout is not one',
            suggestion: 'use `cpumon --json` for output you can pipe',
        };
    }

    if (streams.stdin.isTTY !== true) {
        return {
            message: 'the dashboard needs a terminal on stdin to read keys',
            suggestion: 'run it without redirecting stdin, or use `cpumon --bars`',
        };
    }

    if (env['CI'] !== undefined) {
        return {
            message: 'refusing to start an interactive dashboard under CI',
            suggestion: 'use `cpumon --json -n 1` for a machine-readable sample',
        };
    }

    const term = env['TERM'];

    if (term === undefined || term === 'dumb') {
        return {
            message: term === undefined
                ? 'TERM is unset, so the terminal\'s capabilities are unknown'
                : 'TERM is "dumb", which cannot move the cursor',
            suggestion: 'use `cpumon --bars`, which only ever prints lines',
        };
    }

    return null;
}


/**
 * Whether block and box-drawing characters will render.
 *
 * This is a locale question rather than a terminal one: a UTF-8 locale is what
 * makes the multi-byte sequence arrive intact. TERM=linux is called out
 * separately because the kernel console has a 512-glyph font that does not
 * include the block set whatever the locale says.
 */
export function supportsUnicode(env: Env): boolean
{
    if (env['TERM'] === 'linux') {
        return false;
    }

    // Windows Terminal and the modern VS Code / iTerm hosts are UTF-8 without
    // ever setting LANG; legacy conhost is not, and sets neither
    if (process.platform === 'win32') {
        return env['WT_SESSION'] !== undefined || env['TERM_PROGRAM'] !== undefined;
    }

    const locale = env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? '';

    return /UTF-?8/i.test(locale);
}


/**
 * Resolve the requested graph style against what the terminal can draw.
 *
 * Braille is never chosen automatically. It is the best-looking option and the
 * plan is to keep offering it, but the failure mode is a font one: a terminal
 * whose font lacks U+28xx substitutes a glyph of a different advance width, and
 * because string-width still reports 1 there is no way to detect it. One
 * mis-measured character shifts every column after it, so the whole bordered
 * frame tears rather than just the graph. That belongs behind a key the user
 * presses, not behind a guess this function makes.
 */
export function resolveGraphStyle(requested: GraphStyle, unicode: boolean): Exclude<GraphStyle, 'auto'>
{
    if (!unicode) {
        return 'ascii';
    }

    return requested === 'auto' ? 'block' : requested;
}


export function detectCapabilities(
    options: { color?: boolean; graph?: GraphStyle } = {},
    streams: Streams = process,
    env: Env = process.env,
): Capabilities
{
    const unicode = supportsUnicode(env);

    return {
        refusal: checkRefusal(streams, env),
        colorLevel: detectColorLevel(options.color, env),
        unicode,
        graph: resolveGraphStyle(options.graph ?? 'auto', unicode),
    };
}


/**
 * Colour depth, on chalk's 0-3 scale.
 *
 * Deliberately not delegating to chalk's own detection: chalk sniffs argv for
 * --color/--no-color, and those are our flags to interpret, not its. The
 * environment variables below are the parts of its contract that users actually
 * rely on.
 */
export function detectColorLevel(explicit: boolean | undefined, env: Env): 0 | 1 | 2 | 3
{
    if (explicit === false || env['NO_COLOR'] !== undefined) {
        return 0;
    }

    const forced = env['FORCE_COLOR'];

    if (forced !== undefined) {
        // the bare `FORCE_COLOR=` form means "on at full depth". Number('') is
        // 0, so this has to be checked before the numeric path or the flag
        // would turn colour off - the exact opposite of what it says.
        if (forced === '' || forced === 'true') {
            return 3;
        }

        const level = Number(forced);

        if (!Number.isFinite(level)) {
            return 3;
        }

        return Math.max(0, Math.min(3, Math.trunc(level))) as 0 | 1 | 2 | 3;
    }

    const term = env['TERM'] ?? '';

    if (env['COLORTERM'] === 'truecolor' || env['COLORTERM'] === '24bit') {
        return 3;
    }

    if (/-256(color)?$/i.test(term)) {
        return 2;
    }

    if (term === 'dumb') {
        return explicit === true ? 1 : 0;
    }

    // anything that identified itself at all handles the sixteen ANSI colours
    return term === '' ? (explicit === true ? 1 : 0) : 1;
}
