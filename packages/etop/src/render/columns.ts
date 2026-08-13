/**
 * Fitting table columns to a width that is never quite enough.
 *
 * Two rules, both learned from the version this replaces.
 *
 * Widths are computed from plain text and colour is applied afterwards.
 * cpumon's render.ts::table() measures cells with `.length`, which counts the
 * escape sequences in a pre-coloured cell as visible characters - so colouring
 * one cell silently misaligns the column. Here a cell is a string with no
 * styling in it, and the component wraps the padded result.
 *
 * Columns are dropped rather than squeezed. There is a width below which
 * PID/USER/%CPU/MEM/THR/S/COMMAND cannot all appear, and the choice is between
 * seven unreadable columns and three readable ones. Every column declares what
 * it is worth, and the cheap ones leave first.
 */

export type Column = {
    key: string;
    header: string;
    align: 'left' | 'right';
    /** the narrowest this column is worth showing at */
    min: number;
    /**
     * Absorbs whatever width is left over. Exactly one column should have it -
     * with none, a wide terminal leaves a ragged gap on the right; with two,
     * the split between them is arbitrary.
     */
    flex?: boolean;
    /**
     * Lower goes first when space runs out. The identifying column and the
     * headline number should be highest; anything a user could recompute or
     * live without should be low.
     */
    priority: number;
};


export type Fitted = {
    /** the columns that survived, in their original order */
    columns: Column[];
    /** width per surviving column, in the same order */
    widths: number[];
    /** columns dropped for want of space, so the panel can say so */
    dropped: Column[];
};


/** the single space between columns; two reads as a gap at these widths */
export const GAP = 1;


/**
 * Choose which columns fit and how wide each one is.
 *
 * The widths always sum to exactly `available` (including gaps) when anything
 * fits at all, so the caller can pad every cell and know the row is exactly as
 * wide as the panel - which is what keeps a table from being the thing that
 * overflows and shifts every line below it.
 */
export function fit(columns: Column[], available: number, rows: string[][] = []): Fitted
{
    if (available < 1 || columns.length === 0) {
        return { columns: [], widths: [], dropped: [...columns] };
    }

    // the natural width of each column: its header, or its widest cell
    const natural = columns.map((column, i) => Math.max(
        column.min,
        column.header.length,
        ...rows.map(row => (row[i] ?? '').length),
    ));

    const keep = [...columns.keys()];

    // drop the cheapest column until the minimums fit
    while (keep.length > 1 && required(columns, keep) > available) {
        let worst = keep[0];

        for (const index of keep) {
            if (columns[index].priority < columns[worst].priority) {
                worst = index;
            }
        }

        keep.splice(keep.indexOf(worst), 1);
    }

    const gaps = (keep.length - 1) * GAP;
    const budget = available - gaps;

    if (budget < 1) {
        return { columns: [], widths: [], dropped: [...columns] };
    }

    const surviving = keep.map(index => columns[index]);
    const widths = keep.map(index => columns[index].min);

    const minimum = widths.reduce((sum, width) => sum + width, 0);

    // the drop loop stops at one column, so a terminal narrower than even that
    // column's minimum lands here. Clamping it is better than returning
    // nothing: a truncated %CPU is still the number someone opened the panel
    // for, and the width invariant has to hold either way or the short row
    // shifts every line drawn after it.
    if (minimum > budget) {
        return { columns: surviving, widths: [budget], dropped: columns.filter(c => !surviving.includes(c)) };
    }

    /**
     * Hand out what the minimums did not use, a cell at a time in rotation.
     *
     * Round-robin rather than filling each column to its natural width in turn.
     * The greedy version starves whichever columns come last: with two cells
     * spare, the first column took both and a memory figure four columns later
     * stayed one short and rendered as "…9.6 MiB" - a truncated byte value,
     * which does not read as an approximation but as a different number.
     */
    let spare = budget - minimum;

    while (spare > 0) {
        let given = 0;

        for (let i = 0; i < keep.length && spare > 0; i++) {
            if (surviving[i].flex === true || widths[i] >= natural[keep[i]]) {
                continue;
            }

            widths[i]++;
            spare--;
            given++;
        }

        // every column has all it wanted; the rest belongs to the flexible one
        if (given === 0) {
            break;
        }
    }

    const flexAt = surviving.findIndex(column => column.flex === true);

    if (flexAt !== -1) {
        widths[flexAt] += spare;
    }
    else if (spare > 0) {
        // no flexible column declared: give the slack to the last one rather
        // than leave the row short of the panel width
        widths[widths.length - 1] += spare;
    }

    return {
        columns: surviving,
        widths,
        dropped: columns.filter(column => !surviving.includes(column)),
    };
}


function required(columns: Column[], keep: number[]): number
{
    const gaps = (keep.length - 1) * GAP;

    return keep.reduce((sum, index) => sum + columns[index].min, gaps);
}


/**
 * Pad a cell to its column width, truncating with an ellipsis if it overflows.
 *
 * The ellipsis is a parameter because a terminal that cannot render U+2026
 * shows a replacement box, and a replacement box in a table is a shifted
 * column.
 */
export function cell(text: string, width: number, align: 'left' | 'right', ellipsis = '…'): string
{
    if (width < 1) {
        return '';
    }

    if (text.length > width) {
        // truncate the end of a left-aligned cell (a command keeps its name)
        // and the start of a right-aligned one (a number keeps its magnitude)
        return width === 1
            ? ellipsis.slice(0, 1)
            : align === 'left'
                ? `${text.slice(0, width - ellipsis.length)}${ellipsis}`
                : `${ellipsis}${text.slice(text.length - width + ellipsis.length)}`;
    }

    return align === 'left' ? text.padEnd(width) : text.padStart(width);
}


/** join fitted cells into one row of exactly the width `fit` was given */
export function row(cells: string[], fitted: Fitted, ellipsis = '…'): string
{
    return fitted.columns
        .map((column, i) => cell(cells[i] ?? '', fitted.widths[i], column.align, ellipsis))
        .join(' '.repeat(GAP));
}
