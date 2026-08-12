/**
 * Time-series rasterisation with braille patterns.
 *
 * Opt-in only, via --graph=braille or the key that cycles styles. See
 * term/capabilities.ts for why this is never chosen automatically: the risk is
 * a font substitution of a different advance width, which is undetectable at
 * runtime and tears the whole frame rather than just the graph.
 *
 * When it works it is the best-looking option by some margin, and for a reason
 * worth stating: each cell holds two dot-columns, so a graph the same width
 * shows twice as much history. That is a real difference in what you can see,
 * not just how it looks.
 */

import type { Raster } from './blocks.js';

/**
 * Braille dot numbering is NOT row-major, and assuming it is produces a graph
 * that looks entirely plausible and is wrong. The eight dots of U+28xx are laid
 * out in two columns of four, but numbered so that dots 7 and 8 - the bottom
 * row - were appended after the original six:
 *
 *     dot 1 (0x01)   dot 4 (0x08)
 *     dot 2 (0x02)   dot 5 (0x10)
 *     dot 3 (0x04)   dot 6 (0x20)
 *     dot 7 (0x40)   dot 8 (0x80)
 *
 * So the mask for a dot at (subrow 0..3 from the top, subcol 0..1) is:
 */
const DOT = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
] as const;

const BASE = 0x2800;

/** dots per character cell */
const SUB_COLS = 2;
const SUB_ROWS = 4;


/** the codepoint for a set of dots, exposed so the mask table can be tested */
export function brailleChar(mask: number): string
{
    return String.fromCharCode(BASE + (mask & 0xff));
}


export function dotMask(subRow: number, subCol: number): number
{
    return DOT[subRow][subCol];
}


/**
 * Rasterise a series into `rows` lines of `cols` characters, at twice the
 * horizontal and four times the vertical resolution of the block renderer.
 *
 * Because two samples share a cell, `cols` characters hold `cols * 2` samples -
 * so this is passed twice as many points as the block version for the same
 * panel, and shows twice the history rather than the same history smoothed.
 */
export function rasteriseBraille(
    values: ArrayLike<number>,
    count: number,
    cols: number,
    rows: number,
    max: number,
): Raster
{
    if (cols < 1 || rows < 1) {
        return { rows: [], filled: 0 };
    }

    const dotCols = cols * SUB_COLS;
    const dotRows = rows * SUB_ROWS;

    const masks: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    const visible = Math.min(count, dotCols);
    const skip = Math.max(0, count - dotCols);
    const pad = dotCols - visible;

    for (let i = 0; i < visible; i++) {
        const value = values[skip + i];

        // same quantisation rule as the block renderer: round so a near-full
        // column reads full, but keep a true zero empty rather than drawing a
        // baseline the machine did not earn
        const height = !(value > 0) || !(max > 0)
            ? 0
            : Math.max(1, Math.min(dotRows, Math.round((value / max) * dotRows)));

        const x = pad + i;
        const cellX = Math.floor(x / SUB_COLS);
        const subCol = x % SUB_COLS;

        // fill from the bottom up
        for (let d = 0; d < height; d++) {
            const dotY = dotRows - 1 - d;
            const cellY = Math.floor(dotY / SUB_ROWS);
            const subRow = dotY % SUB_ROWS;

            masks[cellY][cellX] |= DOT[subRow][subCol];
        }
    }

    return {
        rows: masks.map(row => row.map(brailleChar).join('')),
        // in cells, so callers can reason about the left pad the same way for
        // every style
        filled: Math.ceil(visible / SUB_COLS),
    };
}


/** how many samples a braille graph of this width can show */
export function brailleCapacity(cols: number): number
{
    return cols * SUB_COLS;
}
