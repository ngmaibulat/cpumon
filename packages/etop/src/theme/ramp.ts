/**
 * Turning a load figure into a colour.
 *
 * The stops are deliberately not evenly spaced. For a system monitor the
 * interesting range is 70 to 100 per cent: below half, the only question is
 * "idle or not", and no user has ever needed to distinguish 10 from 40 at a
 * glance. An even ramp spends half its resolution on that distinction and
 * compresses the range where the answer changes what you do next.
 */

import type { Ramp } from './index.js';

/** where each stop takes over, as a fraction of full scale */
const STOPS = [0.5, 0.75, 0.9] as const;


/** the ramp colour for a 0..1 ratio, as one of the four declared stops */
export function rampStep(ramp: Ramp, ratio: number): string | undefined
{
    const clamped = clamp01(ratio);

    if (clamped < STOPS[0]) {
        return ramp[0];
    }

    if (clamped < STOPS[1]) {
        return ramp[1];
    }

    if (clamped < STOPS[2]) {
        return ramp[2];
    }

    return ramp[3];
}


/**
 * A continuous colour between the stops, for the rows of a graph.
 *
 * Only meaningful at truecolor - the ansi16 and mono ramps repeat or omit
 * their entries, and blending two identical colours or two undefined ones
 * gives back what rampStep would have. So this falls through to rampStep for
 * anything that is not a hex triple, rather than trying to interpolate a name.
 *
 * The interpolation is in plain sRGB. OKLab would be more correct, and across
 * four stops and eight rows nobody can tell - it would be the only piece of
 * colour science in a codebase that otherwise has none.
 */
export function rampLerp(ramp: Ramp, ratio: number): string | undefined
{
    const clamped = clamp01(ratio);

    // the stops are not evenly spaced, so find which pair this falls between
    // and how far along that pair it is
    const bounds = [0, ...STOPS, 1];

    let index = 0;

    while (index < bounds.length - 2 && clamped >= bounds[index + 1]) {
        index++;
    }

    const from = parseHex(ramp[index]);
    const to = parseHex(ramp[index + 1]);

    if (from === null || to === null) {
        return rampStep(ramp, clamped);
    }

    const span = bounds[index + 1] - bounds[index];
    const t = span === 0 ? 0 : (clamped - bounds[index]) / span;

    return toHex([
        Math.round(from[0] + (to[0] - from[0]) * t),
        Math.round(from[1] + (to[1] - from[1]) * t),
        Math.round(from[2] + (to[2] - from[2]) * t),
    ]);
}


/**
 * The colour for row `r` of a graph `rows` tall, top row first.
 *
 * Keyed to the row's own height on the axis rather than to the data, so a
 * spike's tip is red and its base is green - the same column changes colour as
 * it rises. Colouring by column instead would make a tall bar one flat colour,
 * which loses the "how close to the top is this" reading that makes the graph
 * scannable at all.
 */
export function rowColor(ramp: Ramp, row: number, rows: number, continuous: boolean): string | undefined
{
    if (rows < 1) {
        return ramp[0];
    }

    // row 0 is the top, so it represents the highest values
    const ratio = (rows - row) / rows;

    return continuous ? rampLerp(ramp, ratio) : rampStep(ramp, ratio);
}


function clamp01(value: number): number
{
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.min(1, value));
}


function parseHex(color: string | undefined): [number, number, number] | null
{
    if (color === undefined || !/^#[0-9a-f]{6}$/i.test(color)) {
        return null;
    }

    return [
        Number.parseInt(color.slice(1, 3), 16),
        Number.parseInt(color.slice(3, 5), 16),
        Number.parseInt(color.slice(5, 7), 16),
    ];
}


function toHex([r, g, b]: [number, number, number]): string
{
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
