/**
 * The screen strip, one row under the header.
 *
 * This is the one component that deliberately does NOT follow the "one <Text>
 * per row, carrying a whole pre-padded line" rule that Table and Graph state.
 * That rule exists because a fifty-row table with seven columns is fifty Yoga
 * nodes one way and three hundred and fifty the other, and the process table is
 * the panel most likely to be tall. A tab bar is one row of at most seven
 * labels: nine nodes, once. Paying that buys the thing a single <Text> cannot
 * do, which is highlight the active tab - and a tab bar that cannot show which
 * tab you are on is not a tab bar.
 *
 * Every width the row spends is subtracted before fitTabs is called rather than
 * being left to flexbox to sort out. Ink will happily shrink a Text to make a
 * row fit, and a shrunk tab label is a tab bar that silently lies; reserving up
 * front means the thing that gets dropped is the hint, which nobody needs
 * twice.
 *
 * It always claims its row, on every screen and at every size. A strip that
 * appeared and disappeared with the terminal height would move every row below
 * it by one, which in the alternate screen is the difference between a redraw
 * and a smear.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { fitTabs } from '../render/tabs.js';
import { useStyle } from '../hooks/useTheme.js';
import type { ScreenId } from '../state/types.js';


export type TabBarProps = {
    width: number;
    screen: ScreenId;
};


/** below this the row is all tabs; the hint is the first thing to go */
const HINT_WIDTH = 16;


export const TabBar = memo(function TabBar({ width, screen }: TabBarProps)
{
    const { theme, glyphs, unicode } = useStyle();

    const hint = `Tab ${glyphs.pointer} screen`;
    const showHint = width >= 72;

    const { tabs, moreBefore, moreAfter } = fitTabs(screen, showHint ? width - HINT_WIDTH : width);

    // ascii terminals have no guillemets, and the ellipsis glyph is already
    // spoken for as "this value was cut", which is a different claim
    const before = unicode ? '‹' : '<';
    const after = unicode ? '›' : '>';

    return (
        <Box width={width} overflow="hidden">
            {moreBefore ? <Text color={theme.muted} dimColor>{`${before} `}</Text> : null}
            {tabs.map((tab, i) => (
                <Text
                    key={tab.screen}
                    wrap="truncate-end"
                    color={tab.active ? theme.selectionForeground ?? theme.title : theme.muted}
                    backgroundColor={tab.active ? theme.selectionBackground : undefined}
                    // a theme with no selection colour still has to show which
                    // tab is active, so it inverts instead - the same fallback
                    // Table uses for the selected row
                    inverse={tab.active && theme.selectionBackground === undefined}
                    bold={tab.active}
                >
                    {`${i === 0 ? '' : '  '}${tab.active ? ` ${tab.label} ` : tab.label}`}
                </Text>
            ))}
            {moreAfter ? <Text color={theme.muted} dimColor>{` ${after}`}</Text> : null}
            <Box flexGrow={1} />
            {showHint ? <Text color={theme.muted} dimColor wrap="truncate-end">{hint}</Text> : null}
        </Box>
    );
});
