/**
 * Time-series rasterisation with the 1/8th block characters.
 *
 * This is the default graph style, chosen over braille deliberately. Braille
 * packs 2x4 dots per cell and looks better, but a terminal font missing the
 * U+28xx range substitutes a glyph of a different advance width - and since
 * string-width still reports 1, nothing can detect it. One mis-measured cell
 * shifts every column after it, so the whole bordered frame tears rather than
 * just the graph. The eighth-blocks are in every font that has box-drawing
 * characters, which is every font a terminal uses or its borders would already
 * be broken.
 *
 * Resolution is not the constraint anyone imagines: a six-row panel gives 48
 * addressable levels, far beyond what can be read off a terminal.
 */

/** index is the number of filled eighths, so BLOCKS[0] is empty and BLOCKS[8] full */
export const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/** the same idea horizontally, for the fractional cell at the end of a gauge */
export const HALF_BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const;

const EIGHTHS = 8;


export type Raster = {
    /** one string per row, top first - the order they are printed in */
    rows: string[];
    /** how many columns carry data; the rest are the left pad */
    filled: number;
};


/**
 * Quantise one value to a number of eighths within a column of `rows` cells.
 *
 * Rounds rather than floors, so a 99% column reads full instead of an eighth
 * short. The explicit zero branch is what keeps a genuinely idle machine
 * blank - without it every zero column renders a phantom ▁ and the graph
 * claims a constant low load that is not there.
 */
export function quantise(value: number, max: number, rows: number): number
{
    const levels = rows * EIGHTHS;

    if (!(value > 0) || !(max > 0)) {
        return 0;
    }

    const level = Math.round((value / max) * levels);

    return Math.max(1, Math.min(levels, level));
}


/**
 * Rasterise a series into `rows` lines of `cols` characters.
 *
 * Newest sample on the right. When there is less history than width the graph
 * is left-padded with blanks rather than zeros: an empty left edge says "not
 * measured yet", a flat line at the bottom would claim the machine was idle.
 * When there is more history than width the oldest samples fall off the left,
 * which is the same thing every scrolling graph does.
 *
 * `values` is read from index 0 to `count`, so a Float64Array straight out of
 * Ring.latest() can be passed without slicing.
 */
export function rasterise(
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
        const level = quantise(values[skip + i], max, rows);
        const x = pad + i;

        for (let r = 0; r < rows; r++) {
            // row 0 is the top, so its base sits (rows - 1) cells up
            const below = (rows - 1 - r) * EIGHTHS;
            const eighths = Math.max(0, Math.min(EIGHTHS, level - below));

            grid[r][x] = BLOCKS[eighths];
        }
    }

    return { rows: grid.map(row => row.join('')), filled: visible };
}


/**
 * The same, mirrored: the series grows downward from the top edge.
 *
 * For the transmit half of a network graph, drawn below a centre axis. The
 * tempting alternative is a top-anchored block set, but Unicode has no such
 * thing - only ▔ (one eighth) and ▀ (four) exist, with nothing in between. So
 * the rows are simply emitted in reverse, which uses only glyphs that exist and
 * reads correctly as a reflection.
 */
export function rasteriseInverted(
    values: ArrayLike<number>,
    count: number,
    cols: number,
    rows: number,
    max: number,
): Raster
{
    const raster = rasterise(values, count, cols, rows, max);

    return { rows: [...raster.rows].reverse(), filled: raster.filled };
}


/**
 * A horizontal meter, `width` cells wide, filled to `ratio` of its length.
 *
 * The last filled cell is a fractional block, so 62.5% of a ten-cell bar lands
 * mid-character rather than rounding to six cells or seven. That matters more
 * than it sounds: at typical panel widths a whole-cell bar quantises to 10%
 * steps, and a gauge that only moves in tenths reads as broken.
 */
export function meter(ratio: number, width: number): string
{
    if (width < 1) {
        return '';
    }

    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const eighths = Math.round(clamped * width * EIGHTHS);

    const full = Math.floor(eighths / EIGHTHS);
    const remainder = eighths % EIGHTHS;

    // a full bar has no room for a partial cell after it
    const head = '█'.repeat(Math.min(full, width));
    const tail = full < width ? HALF_BLOCKS[remainder] : '';

    return (head + tail).padEnd(width, ' ');
}


/** ascending glyph for a single value, used for the per-core sparkline strip */
export function spark(value: number, max: number): string
{
    return BLOCKS[quantise(value, max, 1)];
}
