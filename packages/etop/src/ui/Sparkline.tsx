/**
 * One glyph per value, on a single line.
 *
 * Used for the per-core strip on a machine with too many cores to give each
 * one a graph. It shows less than a graph does - one instant, no history - but
 * it is the only form that scales: 128 cores is 128 characters, and anything
 * with vertical extent would need a screen per socket.
 *
 * Split into runs of the same colour rather than one <Text> per core, so a
 * 128-core machine costs a handful of nodes instead of 128.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { spark } from '../render/blocks.js';
import { rampStep } from '../theme/ramp.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ramp } from '../theme/index.js';


export type SparklineProps = {
    /** each value on its own 0..max scale */
    values: number[];
    max: number;
    ramp: Ramp;
    width: number;
};


/** four levels, matching the ascii graph, for terminals without the block set */
const ASCII_LEVELS = ['.', ':', '|', '#'];


export const Sparkline = memo(function Sparkline({ values, max, ramp, width }: SparklineProps)
{
    const { unicode } = useStyle();

    const shown = values.slice(0, Math.max(0, width));

    // adjacent cores are usually at similar loads, so runs are long in practice
    // and this collapses to very few nodes
    const runs: { text: string; color: string | undefined }[] = [];

    for (const value of shown) {
        const ratio = max > 0 ? value / max : 0;
        const color = rampStep(ramp, ratio);

        const glyph = unicode
            ? spark(value, max)
            : ASCII_LEVELS[Math.min(ASCII_LEVELS.length - 1, Math.floor(ratio * ASCII_LEVELS.length))];

        const last = runs.at(-1);

        if (last !== undefined && last.color === color) {
            last.text += glyph;
        }
        else {
            runs.push({ text: glyph, color });
        }
    }

    return (
        <Box width={width} overflow="hidden">
            {runs.map((run, i) => (
                <Text key={i} color={run.color} wrap="truncate-end">{run.text}</Text>
            ))}
        </Box>
    );
});
