/**
 * A time-series graph.
 *
 * One <Text> per row, each carrying a whole pre-built line. Never one per cell.
 *
 * That is the single most important performance decision in the dashboard, and
 * it is about Yoga rather than React: every ink render runs a full layout pass
 * over the element tree, so the cost tracks node count. A 60x8 graph is 8 nodes
 * this way and 480 the obvious way, and the obvious way makes a resize visibly
 * slow on a machine that is already busy - which is exactly when someone is
 * looking at it.
 *
 * It also happens to be what the colour design wants. Rows are coloured by
 * height on the axis rather than by value, so a whole row is one colour, and a
 * row is one string.
 */

import { Box, Text } from 'ink';
import { memo, useMemo } from 'react';

import { rasteriseAscii } from '../render/ascii.js';
import { rasterise, rasteriseInverted } from '../render/blocks.js';
import { brailleCapacity, rasteriseBraille } from '../render/braille.js';
import { rowColor } from '../theme/ramp.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ramp } from '../theme/index.js';
import type { Ring } from '../render/ring.js';


export type GraphProps = {
    series: Ring;
    width: number;
    height: number;
    /** the top of the axis; 100 for a percentage, an AutoScale value otherwise */
    max: number;
    ramp: Ramp;
    /** grow downward from the top edge, for the lower half of a mirrored pair */
    inverted?: boolean;
    /** changes whenever new data lands; the memo key */
    tick: number;
};


/**
 * How many samples a graph of this width can show.
 *
 * Braille packs two per cell, which is the entire reason to offer it: the same
 * panel shows twice the history rather than the same history drawn prettier.
 */
export function graphCapacity(style: string, width: number): number
{
    return style === 'braille' ? brailleCapacity(width) : width;
}


export const Graph = memo(function Graph({ series, width, height, max, ramp, inverted = false, tick }: GraphProps)
{
    const { graph, continuousColor } = useStyle();

    const rows = useMemo(() => {
        if (width < 1 || height < 1) {
            return [];
        }

        const want = graphCapacity(graph, width);
        const buffer = new Float64Array(want);
        const count = series.latest(want, buffer);

        const raster = graph === 'ascii'
            ? rasteriseAscii(buffer, count, width, height, max)
            : graph === 'braille'
                ? rasteriseBraille(buffer, count, width, height, max)
                : inverted
                    ? rasteriseInverted(buffer, count, width, height, max)
                    : rasterise(buffer, count, width, height, max);

        // braille and ascii have no inverted variant of their own; reversing
        // the finished rows is the same reflection the block renderer does
        return inverted && graph !== 'block' ? [...raster.rows].reverse() : raster.rows;
        // `tick` is the real dependency: the ring mutates in place, so its
        // identity never changes and React cannot see new data any other way
    }, [series, width, height, max, graph, inverted, tick]);

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            {rows.map((line, i) => (
                <Text
                    key={i}
                    color={rowColor(ramp, inverted ? rows.length - 1 - i : i, rows.length, continuousColor)}
                    wrap="truncate-end"
                >
                    {line}
                </Text>
            ))}
        </Box>
    );
});
