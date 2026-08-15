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
import { memo, useEffect, useMemo } from 'react';
import { bytes, shortId } from 'libsysmon/format';
import { isAvailable } from 'libsysmon';
import type { ContainerInfo, DockerContainer } from 'libsysmon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { rampStep } from '../theme/ramp.js';
import { useSlowState } from '../hooks/useSlow.js';
import { useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';


export type ContainerPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    /** index into the container list */
    selected?: number;
    /** the first row to show; the reducer owns scrolling */
    scroll?: number;
    /**
     * How many rows there are and how many fit, once both are known.
     *
     * Deliberately narrower than the process table's onView: that one also
     * carries the selected row, because the kill modal reads it to pin a pid.
     * Nothing here can be signalled, so nothing here needs to hand out a row.
     */
    onRows?: (rowCount: number, windowRows: number) => void;
};


const COLUMNS: Column[] = [
    { key: 'id', header: 'CONTAINER', align: 'left', min: 12, priority: 90 },
    { key: 'image', header: 'IMAGE', align: 'left', min: 10, priority: 25 },
    { key: 'runtime', header: 'RUNTIME', align: 'left', min: 7, priority: 40 },
    { key: 'cpu', header: '%CPU', align: 'right', min: 5, priority: 100 },
    { key: 'cpus', header: 'CPUS', align: 'right', min: 4, priority: 30 },
    { key: 'mem', header: 'MEM', align: 'right', min: 8, priority: 80 },
    { key: 'limit', header: 'LIMIT', align: 'right', min: 8, flex: true, priority: 60 },
];


/**
 * The docker id inside a cgroup directory name.
 *
 * `docker-<64hex>.scope` carries exactly the id the engine API returns, which
 * is what makes the join a Map lookup rather than a heuristic. Anything else -
 * an lxc payload, a podman scope, a bare cgroup - has no docker id in it and
 * gets null rather than a guess.
 */
export function dockerIdOf(cgroupId: string): string | null
{
    return /^docker-([0-9a-f]{64})\.scope$/.exec(cgroupId)?.[1] ?? null;
}


/** index the engine's list by full id, for the join above */
export function dockerIndex(containers: DockerContainer[]): Map<string, DockerContainer>
{
    return new Map(containers.map(container => [container.id, container]));
}


/**
 * One row, optionally enriched with what docker knows.
 *
 * The cgroup collector stays the source of truth for every number here.
 * Docker's own /containers/<id>/stats is a streaming endpoint with a different
 * sampling model, and adopting it would put two incompatible definitions of
 * "%CPU" on one screen. Docker supplies identity; cgroups supply figures.
 *
 * Where the join fails the existing columns stay exactly as they were - a
 * podman or lxc container keeps its short id rather than going blank, because a
 * blank cell reads as "this container has no name".
 */
export function toRow(container: ContainerInfo, unlimited = '∞', match?: DockerContainer): string[]
{
    return [
        match?.name ?? shortId(container.id),
        match?.image ?? '-',
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


export const ContainerPanel = memo(function ContainerPanel({
    width,
    height,
    focused = false,
    selected,
    scroll = 0,
    onRows,
}: ContainerPanelProps)
{
    const { snapshot, ticks } = useStoreState();
    const { docker } = useSlowState();
    const { theme, glyphs } = useStyle();

    const probe = snapshot?.containers;

    // empty whenever the slow poller has not been asked for docker, or docker
    // is not there: every row then falls back to its short id, which is what
    // this panel showed before the join existed
    const byId = useMemo(
        () => (docker !== undefined && isAvailable(docker) ? dockerIndex(docker.containers) : new Map()),
        [docker],
    );

    const containers = probe !== undefined && isAvailable(probe) ? probe.containers : [];
    const namespaced = probe !== undefined && isAvailable(probe) && probe.scope === 'namespaced';

    // Panel spends two rows on its border and one on its title; the table
    // spends one more on its header, and the footnote takes a row when it
    // applies. What is left is what a cursor can actually stand on.
    const footnote = namespaced && height - 3 >= 3;
    const bodyRows = Math.max(0, height - 4 - (footnote ? 1 : 0));

    // selected and scroll are dependencies even though the report does not
    // carry them. `G` sets the selection to an index no list could contain and
    // leaves the reducer to clamp it, which it can only do once something tells
    // it the row count - so the report has to fire on a cursor move too, not
    // only when the list itself changes. clamp returns the state unchanged when
    // there is nothing to fix, so the pass that follows a move settles at once
    // rather than looping.
    useEffect(() => {
        onRows?.(containers.length, bodyRows);
    }, [onRows, containers.length, bodyRows, selected, scroll]);

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
                const tableHeight = Math.max(1, innerHeight - (footnote ? 1 : 0));

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={probe.containers.map(item => toRow(item, glyphs.unlimited, byId.get(dockerIdOf(item.id) ?? '')))}
                            width={inner}
                            height={tableHeight}
                            selected={selected}
                            offset={scroll}
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
