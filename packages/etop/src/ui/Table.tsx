/**
 * A fitted table.
 *
 * One <Text> per row, carrying a whole pre-padded line - same reason as Graph.
 * A fifty-row process table with seven columns is 50 Yoga nodes this way and
 * 350 the other, and the process table is the panel most likely to be tall.
 *
 * The consequence is that a row is one colour. That is a real constraint and it
 * is the right trade: what a process table needs is for the selected row to
 * stand out and for the rest to be legible, not for %CPU to be individually
 * tinted. The one exception the design allows for - a value that has to be red
 * on its own - is handled by the panel choosing the row's colour, not by
 * splitting the row.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';

import { fit, row as buildRow } from '../render/columns.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';


export type TableProps = {
    columns: Column[];
    rows: string[][];
    width: number;
    /** including the header row */
    height: number;
    /** index into `rows`, not into the visible window */
    selected?: number;
    /** the first row to show; the panel owns scrolling */
    offset?: number;
    /** marks the sorted column in the header */
    sortKey?: string;
    sortReverse?: boolean;
    /** per-row colour, by index into `rows` */
    rowColor?: (index: number) => string | undefined;
};


export const Table = memo(function Table({
    columns,
    rows,
    width,
    height,
    selected,
    offset = 0,
    sortKey,
    sortReverse = false,
    rowColor,
}: TableProps)
{
    const { theme, glyphs } = useStyle();

    if (width < 1 || height < 1) {
        return null;
    }

    const bodyHeight = Math.max(0, height - 1);
    const visible = rows.slice(offset, offset + bodyHeight);

    // fit against the rows actually on screen: sizing to the whole list would
    // make the columns jump every time a wide value scrolls into view
    const fitted = fit(columns, width, visible);

    if (fitted.columns.length === 0) {
        return <Text color={theme.muted} wrap="truncate-end">too narrow</Text>;
    }

    // built over every column, not just the survivors: row() indexes a cell
    // array by original column position, and the header row is a cell array
    const headers = columns.map(column => {
        if (column.key !== sortKey) {
            return column.header;
        }

        // the marker has to fit inside the column, so it replaces a character
        // rather than adding one
        const marker = sortReverse ? glyphs.sortAscending : glyphs.sortDescending;

        return `${column.header}${marker}`;
    });

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Text color={theme.title} inverse wrap="truncate-end">
                {buildRow(headers, fitted, glyphs.ellipsis)}
            </Text>
            {visible.map((cells, i) => {
                const index = offset + i;
                const isSelected = index === selected;

                return (
                    <Text
                        key={index}
                        wrap="truncate-end"
                        color={isSelected ? theme.selectionForeground : rowColor?.(index) ?? theme.value}
                        backgroundColor={isSelected ? theme.selectionBackground : undefined}
                        // a theme with no selection colour still has to show
                        // which row is selected, so it inverts instead
                        inverse={isSelected && theme.selectionBackground === undefined}
                    >
                        {buildRow(cells, fitted, glyphs.ellipsis)}
                    </Text>
                );
            })}
        </Box>
    );
});
