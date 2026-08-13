/**
 * The key bindings, generated from the same table that dispatches them.
 *
 * That is the point: no list of keys is written out here, so this screen cannot
 * describe a binding that does not exist or miss one that does.
 *
 * Built as flat pre-formatted lines, one <Text> each - the same rule as Graph
 * and Table, and for a second reason here: a newline inside a <Text> makes ink
 * treat it as a multi-line node and the surrounding flex accounting goes wrong,
 * which shows up as blank rows interleaved with overwritten ones. Blank lines
 * are their own entries in the list instead.
 *
 * It replaces the frame rather than floating over it. Ink has no z-index and no
 * absolute positioning, so a real overlay means compositing by hand - and a
 * help screen is somewhere people stop and read, not something to see through.
 */

import { Box, Text } from 'ink';
import { memo, useMemo } from 'react';

import { helpSections } from '../state/keymap.js';
import { useStyle } from '../hooks/useTheme.js';


export type HelpOverlayProps = {
    width: number;
    height: number;
};


type Line =
    | { kind: 'heading'; text: string }
    | { kind: 'binding'; keys: string; description: string }
    | { kind: 'blank' };


/** the widest key column, capped so a long chord cannot eat the descriptions */
const MAX_KEY_WIDTH = 20;


export function helpLines(): Line[] {
    const lines: Line[] = [];

    for (const section of helpSections()) {
        if (lines.length > 0) {
            lines.push({ kind: 'blank' });
        }

        lines.push({ kind: 'heading', text: section.title });

        for (const binding of section.bindings) {
            lines.push({ kind: 'binding', keys: binding.keys, description: binding.description });
        }
    }

    return lines;
}


export const HelpOverlay = memo(function HelpOverlay({ width, height }: HelpOverlayProps)
{
    const { theme, unicode } = useStyle();

    const { lines, keyWidth } = useMemo(() => {
        const all = helpLines();

        const widest = all.reduce(
            (max, line) => (line.kind === 'binding' ? Math.max(max, line.keys.length) : max),
            0,
        );

        return { lines: all, keyWidth: Math.min(MAX_KEY_WIDTH, widest) };
    }, []);

    const inner = Math.max(0, width - 2);
    // one row for each border, one for the title
    const body = Math.max(1, height - 3);

    // The full list is about twenty-five rows and a terminal is usually
    // twenty-four, so it does not fit down one side. Rather than scroll - a
    // second interaction model to learn, in the place someone went to avoid
    // learning one - it flows into columns, which is what a reference wants.
    const { columns, columnWidth } = useMemo(() => {
        const needed = Math.max(1, Math.ceil(lines.length / body));
        // a column is worth splitting into only if the descriptions survive it
        const natural = keyWidth + 2 + MIN_DESCRIPTION + COLUMN_GAP;
        const fit = Math.max(1, Math.floor(inner / Math.max(1, natural)));
        const count = Math.min(needed, fit);

        return { columns: count, columnWidth: Math.floor(inner / count) };
    }, [lines.length, keyWidth, inner, body]);

    const perColumn = Math.ceil(lines.length / columns);
    // what each column can actually show, which is what decides the shortfall -
    // not perColumn, which is what it would show given the room
    const shownPerColumn = Math.min(perColumn, body);
    const clipped = Math.max(0, lines.length - shownPerColumn * columns);

    return (
        <Box
            width={width}
            height={height}
            flexDirection="column"
            overflow="hidden"
            borderStyle={unicode ? 'round' : 'classic'}
            borderColor={theme.borderFocus}
        >
            <Text color={theme.titleFocus} bold wrap="truncate-end">
                {clipped > 0
                    ? `Keys — ${clipped} more; a taller terminal shows them all — Esc or ? to close`
                    : 'Keys — Esc or ? to close'}
            </Text>
            <Box width={inner} height={body} overflow="hidden">
                {Array.from({ length: columns }, (_unused, column) => (
                    <Box key={column} width={columnWidth} flexDirection="column" overflow="hidden">
                        {lines
                            .slice(column * perColumn, column * perColumn + shownPerColumn)
                            .map((line, i) => (
                                <HelpLine key={i} line={line} keyWidth={keyWidth} />
                            ))}
                    </Box>
                ))}
            </Box>
        </Box>
    );
});


/** the gap between columns when the list flows into more than one */
const COLUMN_GAP = 2;

/**
 * How much room a description needs to stay a sentence.
 *
 * Splitting into columns costs width, and a column too narrow to read is worse
 * than a list too long to fit - the second is honest about what it is showing.
 */
const MIN_DESCRIPTION = 30;


function HelpLine({ line, keyWidth }: { line: Line; keyWidth: number })
{
    const { theme } = useStyle();

    if (line.kind === 'blank') {
        return <Text> </Text>;
    }

    if (line.kind === 'heading') {
        return <Text color={theme.title} bold wrap="truncate-end">{line.text}</Text>;
    }

    return (
        <Text wrap="truncate-end">
            <Text color={theme.value}>{line.keys.padEnd(keyWidth)}</Text>
            <Text color={theme.label}>{`  ${line.description}`}</Text>
        </Text>
    );
}
