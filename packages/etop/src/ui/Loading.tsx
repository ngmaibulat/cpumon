/**
 * What a panel shows before its first full sampling window.
 *
 * This state is not cosmetic and skipping it is the bug the dashboard would
 * otherwise ship. Network rates and per-process CPU are counter-derived: the
 * first tick has nothing to diff against, so the collector correctly reports
 * nothing. Render that as an unavailable probe and a perfectly healthy Linux
 * box looks, for one second of every launch, exactly like a Mac where those
 * collectors genuinely do not exist.
 *
 * The distinction is `ticks === 0`, not the shape of the probe.
 */

import { Box, Text, useAnimation } from 'ink';

import { useStyle } from '../hooks/useTheme.js';


export type LoadingProps = {
    width: number;
    height: number;
    /** what is being waited for, if it is not obvious from the panel title */
    label?: string;
};


const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const ASCII_FRAMES = ['-', '\\', '|', '/'];


export function Loading({ width, height, label = 'waiting for a full sampling window' }: LoadingProps)
{
    const { theme, unicode } = useStyle();
    const { frame } = useAnimation({ interval: 120 });

    // braille is safe here and nowhere else: a substituted glyph makes a
    // slightly wrong spinner rather than a shifted column, because nothing is
    // aligned against it. The ascii set is still used when the locale says the
    // multi-byte sequence will not survive the trip at all.
    const frames = unicode ? FRAMES : ASCII_FRAMES;
    const glyph = frames[frame % frames.length];

    return (
        <Box width={width} height={height} overflow="hidden">
            <Text color={theme.muted} wrap="truncate-end">{`${glyph} ${label}…`}</Text>
        </Box>
    );
}
