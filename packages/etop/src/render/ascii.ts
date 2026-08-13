/**
 * The graph style for terminals that cannot render block characters.
 *
 * Not a fallback in the apologetic sense - on a kernel console or a non-UTF-8
 * locale this is the only correct output, and a graph made of `#` and `.` is
 * perfectly readable. What it must not do is emit anything outside ASCII,
 * because the failure mode there is mojibake that breaks column alignment for
 * the whole frame.
 */

import { quantise } from './blocks.js';
import type { Raster } from './blocks.js';

/** four levels within a cell rather than eight: ASCII has nothing finer */
const LEVELS = [' ', '.', ':', '|', '#'] as const;

const STEPS = LEVELS.length - 1;


export function rasteriseAscii(
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

    const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(' '));

    const visible = Math.min(count, cols);
    const skip = Math.max(0, count - cols);
    const pad = cols - visible;

    for (let i = 0; i < visible; i++) {
        // quantise in eighths, then map down - so the two styles agree on which
        // column is taller even where they disagree on how to draw it
        const eighths = quantise(values[skip + i], max, rows);
        const level = Math.ceil((eighths / 8) * STEPS);
        const x = pad + i;

        for (let r = 0; r < rows; r++) {
            const below = (rows - 1 - r) * STEPS;
            const step = Math.max(0, Math.min(STEPS, level - below));

            grid[r][x] = LEVELS[step];
        }
    }

    return { rows: grid.map(row => row.join('')), filled: visible };
}


/** the ASCII meter: `[####----]` without the leading bracket, which Gauge adds */
export function meterAscii(ratio: number, width: number): string
{
    if (width < 1) {
        return '';
    }

    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const filled = Math.round(clamped * width);

    return '#'.repeat(filled).padEnd(width, '-');
}
