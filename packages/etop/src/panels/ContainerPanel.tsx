/**
 * Containers, from cgroups.
 *
 * The footnote at the bottom is the reason this panel needs care rather than
 * just a table. `scope: 'namespaced'` means the dashboard is itself running
 * inside a container and can only see its own cgroup - so a list with one row,
 * or none, is a statement about the namespace and not about the machine. A
 * dashboard is very good at hiding that distinction, and hiding it is how
 * someone concludes their host is idle when they are looking through a keyhole.
 *
 * Everything else here is the same shape as the process table: fitted columns,
 * one <Text> per row, unavailable probes explained rather than zeroed.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { bytes, shortId } from 'cpumon/format';
import { isAvailable } from 'cpumon';
import type { ContainerInfo } from 'cpumon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { rampStep } from '../theme/ramp.js';
import { useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';


export type ContainerPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
};


const COLUMNS: Column[] = [
    { key: 'id', header: 'CONTAINER', align: 'left', min: 12, priority: 90 },
    { key: 'runtime', header: 'RUNTIME', align: 'left', min: 7, priority: 40 },
    { key: 'cpu', header: '%CPU', align: 'right', min: 5, priority: 100 },
    { key: 'cpus', header: 'CPUS', align: 'right', min: 4, priority: 30 },
    { key: 'mem', header: 'MEM', align: 'right', min: 8, priority: 80 },
    { key: 'limit', header: 'LIMIT', align: 'right', min: 8, flex: true, priority: 60 },
];


export function toRow(container: ContainerInfo, unlimited = '∞'): string[]
{
    return [
        shortId(container.id),
        container.runtime,
        // undefined means "appeared during this window", which is not the same
        // claim as 0.0
        container.cpuPercentage === undefined ? '-' : container.cpuPercentage.toFixed(1),
        container.limits.cpuLimitCores === null ? unlimited : String(container.limits.cpuLimitCores),
        bytes(container.limits.memoryCurrent),
        container.limits.memoryMax === null ? unlimited : bytes(container.limits.memoryMax),
    ];
}


/**
 * How close a container is to its own memory limit.
 *
 * Against its limit rather than against the machine: a container capped at
 * 256 MiB and using 250 is in trouble on a host with a spare terabyte, and
 * colouring it by the host's usage would say the opposite.
 */
export function pressure(container: ContainerInfo): number
{
    const max = container.limits.memoryMax;

    if (max === null || max <= 0) {
        return 0;
    }

    return container.limits.memoryCurrent / max;
}


export const ContainerPanel = memo(function ContainerPanel({ width, height, focused = false }: ContainerPanelProps)
{
    const { snapshot, ticks } = useStoreState();
    const { theme, glyphs } = useStyle();

    const probe = snapshot?.containers;

    return (
        <Panel
            title="CONTAINERS"
            subtitle={probe !== undefined && isAvailable(probe) ? String(probe.containers.length) : undefined}
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

                if (probe.containers.length === 0) {
                    return ticks <= 1
                        ? <Loading width={inner} height={innerHeight} />
                        : (
                            <Text color={theme.muted} wrap="truncate-end">
                                {probe.scope === 'namespaced'
                                    ? 'inside a container: only this cgroup is visible'
                                    : 'no container cgroups found'}
                            </Text>
                        );
                }

                // the footnote is not optional when it applies, so it claims its
                // row before the table gets one
                const footnote = probe.scope === 'namespaced' && innerHeight >= 3;
                const tableHeight = Math.max(1, innerHeight - (footnote ? 1 : 0));

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={probe.containers.map(item => toRow(item, glyphs.unlimited))}
                            width={inner}
                            height={tableHeight}
                            rowColor={index => rampStep(theme.memory, pressure(probe.containers[index]))}
                        />
                        {footnote ? (
                            <Text color={theme.muted} dimColor wrap="truncate-end">
                                running inside a container: only this cgroup is visible
                            </Text>
                        ) : null}
                    </Box>
                );
            }}
        </Panel>
    );
});
