/**
 * The incremental filter bar.
 *
 * Takes the place of the footer while it is open, rather than adding a row -
 * a bar that pushes the table down by one line means the row under the cursor
 * moves the moment you start typing.
 *
 * It renders a cursor because an input without one looks like static text, and
 * someone who cannot tell whether the keyboard is going to the filter or to the
 * table will not trust either.
 */

import { Box, Text, useAnimation } from 'ink';

import { useStyle } from '../hooks/useTheme.js';


export type FilterInputProps = {
    value: string;
    width: number;
    /** how many rows survive the filter, so the effect is visible while typing */
    matches: number;
};


export function FilterInput({ value, width, matches }: FilterInputProps)
{
    const { theme } = useStyle();

    // half a second on, half a second off - the rate a terminal cursor blinks,
    // so it reads as a cursor rather than as something flashing for attention
    const { frame } = useAnimation({ interval: 500 });
    const cursor = frame % 2 === 0 ? '▏' : ' ';

    const count = `${matches} match${matches === 1 ? '' : 'es'}`;

    return (
        <Box width={width} overflow="hidden">
            <Text color={theme.titleFocus} bold>{'/'}</Text>
            <Text color={theme.value} wrap="truncate-start">{value}</Text>
            <Text color={theme.titleFocus}>{cursor}</Text>
            <Box flexGrow={1} />
            <Text color={theme.muted}>{`${count}  Enter keep · Esc cancel`}</Text>
        </Box>
    );
}
