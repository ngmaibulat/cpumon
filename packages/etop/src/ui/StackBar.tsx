/**
 * A single row split proportionally between several segments.
 *
 * Used for the memory composition bar - used / buffers / cached / free - which
 * is the one view that shows what "68% used" is actually made of, and the
 * reason a machine reporting high memory use is usually fine.
 *
 * Rounding is done by walking the cumulative total rather than rounding each
 * segment independently. Independent rounding lets the segments sum to one more
 * or one fewer cell than the bar is wide, and a bar that is sometimes a cell
 * too long is exactly the kind of thing that shifts a whole line.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { useStyle } from '../hooks/useTheme.js';


export type Segment = {
    label: string;
    value: number;
    color: string | undefined;
    /** the fill character; a theme with no colour distinguishes them this way */
    glyph?: string;
};


export type StackBarProps = {
    segments: Segment[];
    width: number;
    /** used when a theme has no colours to tell the segments apart with */
    useGlyphs?: boolean;
};


/**
 * Shades rather than one solid fill, so the segments stay separable when there
 * is no colour to separate them with.
 */
const SHADES = ['█', '▓', '▒', '░'];

/** the same idea for a terminal that cannot render the block set at all */
const ASCII_SHADES = ['#', '=', '-', '.'];


/** how many cells each segment gets, summing to exactly `width` */
export function allocate(values: number[], width: number): number[]
{
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);

    if (width < 1 || total <= 0) {
        return values.map(() => 0);
    }

    const widths: number[] = [];
    let consumed = 0;
    let cumulative = 0;

    for (let i = 0; i < values.length; i++) {
        cumulative += Math.max(0, values[i]);

        // round the running edge, not the segment: the error cannot accumulate
        // because each edge is computed from the original total
        const edge = i === values.length - 1
            ? width
            : Math.round((cumulative / total) * width);

        widths.push(Math.max(0, edge - consumed));
        consumed = edge;
    }

    return widths;
}


export const StackBar = memo(function StackBar({ segments, width, useGlyphs = false }: StackBarProps)
{
    const { unicode } = useStyle();

    if (width < 1) {
        return null;
    }

    const widths = allocate(segments.map(segment => segment.value), width);

    const shades = unicode ? SHADES : ASCII_SHADES;
    // a terminal with no block characters has nothing solid to fill with, so
    // the shaded set is the only option there, colour or not
    const distinct = useGlyphs || !unicode;

    return (
        <Box width={width} overflow="hidden">
            {segments.map((segment, i) => {
                if (widths[i] === 0) {
                    return null;
                }

                const glyph = segment.glyph
                    ?? (distinct ? shades[i % shades.length] : '█');

                return (
                    <Text key={i} color={segment.color} wrap="truncate-end">
                        {glyph.repeat(widths[i])}
                    </Text>
                );
            })}
        </Box>
    );
});
