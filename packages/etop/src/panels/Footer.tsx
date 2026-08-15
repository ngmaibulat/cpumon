/**
 * The bottom line.
 *
 * Three things compete for it, in priority order: whatever just happened, the
 * one-line note about panels this platform has not got, and otherwise a short
 * reminder of the keys. The reminder is the least important - anyone who needs
 * it presses `?` - but an empty bottom line looks like a rendering fault.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { useStyle } from '../hooks/useTheme.js';


export type FooterProps = {
    width: number;
    message: string | null;
    note: string | null;
};


// Tab is the tab bar's own key and is already named up there; what this row is
// for is the keys with nothing on screen to suggest them
const HINTS = ['q quit', '? help', 'w panel', 'Space pause', '/ filter'];

const SHORT_HINTS = ['q quit', '? help'];


const join = (parts: string[], separator: string) => parts.join(` ${separator} `);


export const Footer = memo(function Footer({ width, message, note }: FooterProps)
{
    const { theme, glyphs } = useStyle();

    if (message !== null) {
        return (
            <Box width={width} overflow="hidden">
                <Text color={theme.value} wrap="truncate-end">{message}</Text>
            </Box>
        );
    }

    if (note !== null) {
        return (
            <Box width={width} overflow="hidden">
                <Text color={theme.muted} dimColor wrap="truncate-end">{note}</Text>
            </Box>
        );
    }

    return (
        <Box width={width} overflow="hidden">
            <Text color={theme.muted} dimColor wrap="truncate-end">
                {join(HINTS, glyphs.separator).length <= width
                    ? join(HINTS, glyphs.separator)
                    : join(SHORT_HINTS, glyphs.separator)}
            </Text>
        </Box>
    );
});
