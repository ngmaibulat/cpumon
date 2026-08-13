/**
 * The bordered frame every panel sits in.
 *
 * Two things here are not negotiable, and both exist to stop one panel's
 * mistake becoming the whole frame's mistake:
 *
 * - an explicit height, always. Without it a panel sizes to its content, and a
 *   panel one line too tall pushes every line below it down and off the screen.
 * - overflow hidden. A single long line inside a flex row shifts the layout
 *   sideways, and in the alternate screen that damage persists across frames.
 *
 * Children are given the interior size so they never have to guess how much the
 * border took.
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

import { useStyle } from '../hooks/useTheme.js';


export type PanelProps = {
    title: string;
    /** shown dim after the title: units, a source, a count */
    subtitle?: string;
    width: number;
    height: number;
    focused?: boolean;
    /** right-aligned in the title row; a current value, usually */
    badge?: ReactNode;
    children?: (inner: { width: number; height: number }) => ReactNode;
};


/** the border costs one cell on each side */
const BORDER = 2;


export function Panel({ title, subtitle, width, height, focused = false, badge, children }: PanelProps)
{
    const { theme, unicode } = useStyle();

    const innerWidth = Math.max(0, width - BORDER);
    const innerHeight = Math.max(0, height - BORDER);

    // the title sits in the top border, so it does not cost a row
    const heading = (
        <Box width={innerWidth} overflow="hidden">
            <Text
                color={focused ? theme.titleFocus : theme.title}
                bold={focused}
                wrap="truncate-end"
            >
                {title}
            </Text>
            {subtitle === undefined ? null : (
                <Text color={theme.muted} wrap="truncate-end">{` ${subtitle}`}</Text>
            )}
            <Box flexGrow={1} />
            {badge}
        </Box>
    );

    return (
        <Box
            width={width}
            height={height}
            flexDirection="column"
            overflow="hidden"
            borderStyle={unicode ? 'round' : 'classic'}
            borderColor={focused ? theme.borderFocus : theme.border}
        >
            {heading}
            <Box width={innerWidth} height={Math.max(0, innerHeight - 1)} flexDirection="column" overflow="hidden">
                {children?.({ width: innerWidth, height: Math.max(0, innerHeight - 1) })}
            </Box>
        </Box>
    );
}
