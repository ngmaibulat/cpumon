/**
 * Compose projects and their services.
 *
 * The screen someone opens to ask "which stack is down?", so the counts on the
 * project row are the headline and the services underneath are the detail.
 *
 * A flat list of pre-built rows rather than a tree component. `Table` draws one
 * <Text> per row carrying a whole padded line, and that is not negotiable for
 * the Yoga-node reason Table.tsx documents - a nested tree of Boxes would be
 * several nodes per service and this list is the one most likely to be long.
 * So the hierarchy is expressed by indentation inside the cell, which is what a
 * terminal does anyway.
 *
 * Projects collapse rather than paginate: six stacks of ten services is sixty
 * rows of which the interesting six are the headers.
 */

import { Box, Text } from 'ink';
import { memo, useEffect, useMemo } from 'react';
import { groupIntoStacks, isAvailable } from 'libsysmon';
import type { ComposeStack, DockerContainer } from 'libsysmon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { useSlowState } from '../hooks/useSlow.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';
import type { Glyphs } from '../hooks/useTheme.js';
import type { Theme } from '../theme/index.js';


export type StackPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    selected?: number;
    scroll?: number;
    /** projects whose services are hidden */
    collapsed?: Record<string, true>;
    onRows?: (rowCount: number, windowRows: number) => void;
    /**
     * Which project the cursor is on, so Enter can fold it.
     *
     * Narrow and separate from onRows for the reason ProcessPanel's onView is
     * narrow: only the panel knows what the selection has landed on, and only
     * this callback is allowed to say so.
     */
    onProject?: (project: string | null) => void;
};


export type StackRow =
    | { kind: 'project'; stack: ComposeStack }
    | { kind: 'service'; stack: ComposeStack; container: DockerContainer };


const COLUMNS: Column[] = [
    { key: 'name', header: 'PROJECT / SERVICE', align: 'left', min: 16, priority: 100 },
    { key: 'state', header: 'STATE', align: 'left', min: 8, priority: 90 },
    { key: 'image', header: 'IMAGE', align: 'left', min: 12, priority: 70 },
    { key: 'status', header: 'STATUS', align: 'left', min: 12, flex: true, priority: 60 },
];


/**
 * Flatten projects and their services into drawable rows.
 *
 * Pure and exported: this is the whole layout decision, and asserting on rows
 * is far more legible than asserting on a rendered frame.
 */
export function buildStackRows(stacks: ComposeStack[], collapsed: Record<string, true> = {}): StackRow[]
{
    const rows: StackRow[] = [];

    for (const stack of stacks) {
        rows.push({ kind: 'project', stack });

        if (collapsed[stack.project] === true) {
            continue;
        }

        for (const container of stack.services) {
            rows.push({ kind: 'service', stack, container });
        }
    }

    return rows;
}


/**
 * Keep the tail of a path, which is the part that identifies it.
 *
 * Table truncates a left-aligned cell from the end, and the end of a project
 * folder is the only part anyone recognises - a column of
 * "/home/admin/Downloads/2026-06-…" tells you nothing and tells you it
 * identically for every stack on the machine.
 */
export function shortPath(path: string, ellipsis = '…', segments = 3): string
{
    const parts = path.split('/').filter(part => part !== '');

    if (parts.length <= segments) {
        return path;
    }

    return `${ellipsis}/${parts.slice(-segments).join('/')}`;
}


export function toRow(row: StackRow, glyphs: Glyphs, collapsed: Record<string, true> = {}): string[]
{
    if (row.kind === 'project') {
        const { stack } = row;
        const marker = collapsed[stack.project] === true ? glyphs.pointer : glyphs.down;

        return [
            `${marker} ${stack.project}`,
            `${stack.running}/${stack.total} up`,
            stack.workingDir === undefined ? '-' : shortPath(stack.workingDir, glyphs.ellipsis),
            '',
        ];
    }

    const { container } = row;
    const compose = container.compose;

    return [
        // two spaces of indent: enough to read as nested against the marker on
        // the project row, cheap enough to survive a narrow column
        `  ${compose?.service ?? container.name}${compose?.oneoff === true ? ' (run)' : ''}`,
        container.state,
        container.image,
        container.status,
    ];
}


export const StackPanel = memo(function StackPanel({
    width,
    height,
    focused = false,
    selected,
    scroll = 0,
    collapsed,
    onRows,
    onProject,
}: StackPanelProps)
{
    const { docker, ticks } = useSlowState();
    const { theme, glyphs } = useStyle();

    const folded = collapsed ?? {};

    const stacks = useMemo(
        () => (docker !== undefined && isAvailable(docker) ? groupIntoStacks(docker.containers) : []),
        [docker],
    );

    const rows = useMemo(() => buildStackRows(stacks, folded), [stacks, folded]);

    const services = stacks.reduce((sum, stack) => sum + stack.total, 0);

    // Panel spends two rows on its border and one on its title; the table
    // spends one more on its header. What is left is what a cursor can stand on.
    const bodyRows = Math.max(0, height - 4);

    // selected and scroll are dependencies even though the report does not
    // carry them: `G` sets the selection past the end and leaves the reducer to
    // clamp it, which it can only do once something tells it the row count.
    useEffect(() => {
        onRows?.(rows.length, bodyRows);
    }, [onRows, rows.length, bodyRows, selected, scroll]);

    useEffect(() => {
        onProject?.(selected === undefined ? null : rows[selected]?.stack.project ?? null);
    }, [onProject, rows, selected]);

    return (
        <Panel
            title="STACKS"
            subtitle={docker === undefined || !isAvailable(docker)
                ? undefined
                : `${stacks.length} ${stacks.length === 1 ? 'project' : 'projects'} ${glyphs.separator} ${services} services`}
            width={width}
            height={height}
            focused={focused}
        >
            {({ width: inner, height: innerHeight }) => {
                if (docker === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(docker)) {
                    return <Unavailable reason={docker.reason} detail={docker.detail} width={inner} height={innerHeight} />;
                }

                if (rows.length === 0) {
                    return ticks < 1
                        ? <Loading width={inner} height={innerHeight} />
                        : (
                            <Text color={theme.muted} wrap="truncate-end">
                                {docker.containers.length === 0
                                    ? 'no containers'
                                    : 'no compose projects: every container here was started by hand'}
                            </Text>
                        );
                }

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={rows.map(row => toRow(row, glyphs, folded))}
                            width={inner}
                            height={innerHeight}
                            selected={selected}
                            offset={scroll}
                            // a project row is the heading of its group, and a
                            // stack with something down is the reason to look
                            rowColor={index => rowColor(rows[index], theme)}
                        />
                    </Box>
                );
            }}
        </Panel>
    );
});


function rowColor(row: StackRow | undefined, theme: Theme): string | undefined
{
    if (row === undefined) {
        return undefined;
    }

    if (row.kind === 'project') {
        // a project with something down is the reason someone opened this
        return row.stack.running < row.stack.total ? theme.warn ?? theme.title : theme.title;
    }

    // a stopped service is the thing the screen exists to surface, so it is not
    // allowed to look the same as a running one
    return row.container.state === 'running' ? theme.value : theme.muted;
}
