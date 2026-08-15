/**
 * Dropping the SGR escape sequences from chalk output.
 *
 * The alternative is setting chalk.level to 0, which is a process-wide switch
 * on a singleton that is hoisted to the root of the workspace and shared with
 * ink - so under a single `bun test` across both packages it also turns off the
 * colour the dashboard has tests about. Stripping at the assertion boundary is
 * local to the test that wants it.
 */

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');


export function strip(value)
{
    return typeof value === 'string' ? value.replace(ANSI, '') : value;
}


/** the same function, wrapped around whatever produced the string */
export function plainly(fn)
{
    return (...args) => strip(fn(...args));
}
