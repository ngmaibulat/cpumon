/**
 * The process table.
 *
 * Two things here are not obvious from the code.
 *
 * The visible row count feeds store.setTop(), so resident memory is read only
 * for rows that exist. But setTop restarts the monitor and loses a window, so
 * the panel asks for more than it needs and only changes the figure when the
 * shortfall is real - scrolling never restarts anything, and a drag-resize
 * settles before it does.
 *
 * Sorting happens in the collector, not here. The top-N cut is taken after the
 * sort, so which processes are even collected depends on it; sorting the
 * visible page would silently mean "the busiest ten, ordered by memory", which
 * is not what the column header claims.
 *
 * Filtering, on the other hand, is local: it narrows what is already in hand,
 * and pushing it into the collector would make the filter change which
 * processes are sampled.
 */

import { Box, Text } from 'ink';
import { memo, useEffect, useMemo } from 'react';
import { bytes } from 'libsysmon/format';
import { isAvailable } from 'libsysmon';
import type { ProcessLoad, ProcessSortKey } from 'libsysmon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { rampStep } from '../theme/ramp.js';
import { useStore, useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';


export type ProcessPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    selected: number;
    scroll: number;
    sort: ProcessSortKey;
    sortReverse: boolean;
    filter: string;
    expanded: boolean;
    /**
     * What the panel is actually showing.
     *
     * The reducer cannot know the row count or the window height, and the kill
     * modal cannot know which process the selection lands on - all three depend
     * on data and layout that only this component has resolved.
     */
    onView: (view: ProcessView) => void;
};


export type ProcessView = {
    rowCount: number;
    windowRows: number;
    /** the row under the cursor, or null when the list is empty */
    selected: ProcessLoad | null;
};


/**
 * Rows requested beyond what is visible.
 *
 * Enough that ordinary scrolling never crosses the boundary and restarts the
 * monitor. Each extra row costs one /proc/[pid]/status read per tick, so this
 * is cheap; a restart costs a whole sampling window, which is not.
 */
const HEADROOM = 32;

/**
 * The granularity the request is rounded up to.
 *
 * Headroom alone was enough while the table only ever had one size. It is not
 * enough now that Tab moves the same table between a ten-row tile on the
 * dashboard and a forty-row full screen: that jump crosses the headroom every
 * time, and every crossing respawns the monitor and throws away a sampling
 * window. Rounding up to a bucket means both sizes usually ask for the same
 * number and the switch costs nothing.
 */
const BUCKET = 32;

/**
 * Rows collected while a filter is active.
 *
 * The filter narrows what has already been sampled, and what has been sampled
 * is the busiest N. So filtering for "postgres" on a machine where postgres is
 * idle would find nothing and say "nothing matches" - which is not a shortage
 * of matches, it is a shortage of rows to match against, and the difference is
 * invisible to the person reading it.
 *
 * Collecting essentially everything while a filter is open costs one extra
 * /proc read per process per tick, and only for as long as the filter is on.
 */
const FILTER_TOP = 4096;

/** the column layout, in display order; priority decides what goes first */
const COLUMNS: Column[] = [
    { key: 'pid', header: 'PID', align: 'right', min: 6, priority: 90 },
    { key: 'cpu', header: '%CPU', align: 'right', min: 5, priority: 100 },
    { key: 'mem', header: 'MEM', align: 'right', min: 8, priority: 70 },
    { key: 'thr', header: 'THR', align: 'right', min: 3, priority: 20 },
    { key: 'state', header: 'S', align: 'left', min: 1, priority: 10 },
    { key: 'comm', header: 'COMMAND', align: 'left', min: 8, flex: true, priority: 80 },
];

/** maps a column key to the sort key it corresponds to, for the header marker */
const SORT_COLUMN: Record<ProcessSortKey, string> = {
    cpu: 'cpu',
    mem: 'mem',
    pid: 'pid',
    name: 'comm',
    threads: 'thr',
};


export function matches(process: ProcessLoad, filter: string): boolean
{
    if (filter === '') {
        return true;
    }

    const needle = filter.toLowerCase();

    return process.comm.toLowerCase().includes(needle) || String(process.pid).includes(needle);
}


export const ProcessPanel = memo(function ProcessPanel({
    width,
    height,
    focused = false,
    selected,
    scroll,
    sort,
    sortReverse,
    filter,
    expanded,
    onView,
}: ProcessPanelProps)
{
    const store = useStore();
    const { snapshot, ticks } = useStoreState();
    const { theme } = useStyle();

    const probe = snapshot?.processes;

    const processes = useMemo(
        () => (probe !== undefined && isAvailable(probe) ? probe.processes.filter(p => matches(p, filter)) : []),
        [probe, filter],
    );

    // the interior, less the header row and the detail line when it is open
    const bodyRows = Math.max(0, height - 3 - (expanded ? 1 : 0));

    const current = processes[selected] ?? null;

    useEffect(() => {
        onView({ rowCount: processes.length, windowRows: bodyRows, selected: current });
    }, [onView, processes.length, bodyRows, current]);

    // ask for more than is visible so scrolling never restarts the monitor,
    // and for everything while a filter is narrowing the list
    useEffect(() => {
        store.setTop(filter === '' ? Math.ceil((bodyRows + HEADROOM) / BUCKET) * BUCKET : FILTER_TOP);
    }, [store, bodyRows, filter]);

    useEffect(() => {
        store.setSort(sort, sortReverse);
    }, [store, sort, sortReverse]);

    const rows = useMemo(() => processes.map(toRow), [processes]);

    return (
        <Panel
            title="PROC"
            subtitle={subtitle(processes.length, filter)}
            width={width}
            height={height}
            focused={focused}
        >
            {({ width: inner, height: innerHeight }) => {
                if (probe === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(probe)) {
                    return <Unavailable reason={probe.reason} detail={probe.detail} width={inner} height={innerHeight} />;
                }

                // the first tick has no window to diff, so an empty list is a
                // missing baseline rather than a machine running nothing
                if (probe.processes.length === 0) {
                    return ticks <= 1
                        ? <Loading width={inner} height={innerHeight} />
                        : <Text color={theme.muted} wrap="truncate-end">no processes with a full window yet</Text>;
                }

                if (processes.length === 0) {
                    return (
                        <Text color={theme.muted} wrap="truncate-end">
                            {`nothing matches "${filter}"`}
                        </Text>
                    );
                }

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={rows}
                            width={inner}
                            height={Math.max(1, innerHeight - (expanded ? 1 : 0))}
                            selected={selected}
                            offset={scroll}
                            sortKey={SORT_COLUMN[sort]}
                            sortReverse={sortReverse}
                            rowColor={index => rampStep(theme.cpu, (processes[index]?.cpuPercentage ?? 0) / 100)}
                        />
                        {expanded && current !== null
                            ? <Detail process={current} width={inner} />
                            : null}
                    </Box>
                );
            }}
        </Panel>
    );
});


function subtitle(count: number, filter: string): string
{
    return filter === '' ? `${count}` : `${count} matching "${filter}"`;
}


function toRow(process: ProcessLoad): string[]
{
    return [
        String(process.pid),
        process.cpuPercentage.toFixed(1),
        process.rss === undefined ? '-' : bytes(process.rss),
        String(process.threads),
        process.state,
        process.comm,
    ];
}


function Detail({ process, width }: { process: ProcessLoad; width: number })
{
    const { theme, glyphs } = useStyle();

    // comm is truncated to fifteen bytes by the kernel, so this is as much of
    // the identity as libsysmon can currently supply; a cmdline collector would
    // make this line worth much more
    const parts = [
        `ppid ${process.ppid}`,
        `state ${process.state}`,
        `threads ${process.threads}`,
        `jiffies ${process.jiffies}`,
    ];

    return (
        <Box width={width} overflow="hidden">
            <Text color={theme.muted} wrap="truncate-end">
                {`  ${parts.join(`  ${glyphs.separator}  `)}`}
            </Text>
        </Box>
    );
}
