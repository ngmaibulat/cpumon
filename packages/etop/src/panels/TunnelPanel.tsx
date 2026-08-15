/**
 * SSH tunnels.
 *
 * The one screen that acts on the machine rather than reporting on it, and the
 * columns are arranged around that. STATE is what the supervisor believes;
 * BOUND is what /proc says. They are kept apart on purpose: a tunnel whose ssh
 * is alive but whose ports are not listening is a real and confusing failure,
 * and a single merged "up" column would hide exactly that case behind a green
 * word. See tunnels/status.ts.
 *
 * The row colour follows the state rather than the binding count, because the
 * state is the thing a key press changes and the eye should be able to find
 * the failed row without reading.
 */

import { Box, Text } from 'ink';
import { memo, useEffect, useMemo } from 'react';
import { isAvailable } from 'libsysmon';

import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { useStoreState } from '../hooks/useStore.js';
import { useTunnelsState } from '../hooks/useTunnels.js';
import { useStyle } from '../hooks/useTheme.js';
import { probeTunnels } from '../tunnels/status.js';
import type { Column } from '../render/columns.js';
import type { Theme } from '../theme/index.js';
import type { TunnelProbe } from '../tunnels/status.js';
import type { TunnelStatus } from '../tunnels/supervisor.js';


export type TunnelPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    selected?: number;
    scroll?: number;
    /** the tunnel whose ssh output is expanded, by name */
    detail?: string | null;
    onRows?: (rowCount: number, windowRows: number) => void;
    /** which tunnel the cursor is on; App holds it in a ref for the key handler */
    onTunnel?: (name: string | null) => void;
};


const COLUMNS: Column[] = [
    { key: 'name', header: 'NAME', align: 'left', min: 6, priority: 100 },
    { key: 'state', header: 'STATE', align: 'left', min: 8, priority: 95 },
    { key: 'bound', header: 'BOUND', align: 'right', min: 5, priority: 80 },
    { key: 'target', header: 'TARGET', align: 'left', min: 10, priority: 70 },
    { key: 'ports', header: 'PORTS', align: 'left', min: 5, priority: 60 },
    { key: 'detail', header: 'DETAIL', align: 'left', min: 10, flex: true, priority: 50 },
];


export function targetOf(status: TunnelStatus): string
{
    const { tunnel } = status;
    const host = tunnel.user === undefined ? tunnel.host : `${tunnel.user}@${tunnel.host}`;

    return tunnel.port === undefined ? host : `${host}:${tunnel.port}`;
}


export function toRow(status: TunnelStatus, probe: TunnelProbe | undefined): string[]
{
    return [
        status.tunnel.name,
        status.phase,
        // '-' rather than 0/0 for a tunnel with nothing that listens here: a
        // remote forward binds on the far end and there is nothing to count
        probe === undefined || probe.total === 0 ? '-' : `${probe.bound}/${probe.total}`,
        targetOf(status),
        probe === undefined || probe.ports.length === 0
            ? '-'
            : probe.ports.map(port => port.port).join(','),
        status.message,
    ];
}


/**
 * The colour of a state.
 *
 * `up` is only green when its ports are actually bound. A tunnel whose ssh is
 * running while nothing listens is the failure this screen exists to make
 * visible, so it is drawn as a warning rather than as a success.
 */
export function stateColor(status: TunnelStatus, probe: TunnelProbe | undefined, theme: Theme): string | undefined
{
    if (status.phase === 'failed') {
        return theme.danger ?? theme.warn;
    }

    if (status.phase === 'backoff' || status.phase === 'stopping') {
        return theme.warn;
    }

    if (status.phase === 'up') {
        const short = probe !== undefined && probe.total > 0 && probe.bound < probe.total;

        return short ? theme.warn : theme.ok;
    }

    // idle and stopped are not problems, but they are not running either, and a
    // list where dead and running look the same answers nothing
    return status.phase === 'starting' ? theme.value : theme.muted;
}


export const TunnelPanel = memo(function TunnelPanel({
    width,
    height,
    focused = false,
    selected,
    scroll = 0,
    detail = null,
    onRows,
    onTunnel,
}: TunnelPanelProps)
{
    const { statuses, config } = useTunnelsState();
    const { snapshot } = useStoreState();
    const { theme, glyphs } = useStyle();

    // the socket table is already sampled every tick for the connections
    // screen, so joining against it costs nothing and needs no new collector
    const connections = snapshot?.connections !== undefined && isAvailable(snapshot.connections)
        ? snapshot.connections.connections
        : [];

    const probes = useMemo(
        () => probeTunnels(statuses.map(status => status.tunnel), connections),
        [statuses, connections],
    );

    const byName = useMemo(
        () => new Map(probes.map(probe => [probe.name, probe])),
        [probes],
    );

    // Panel spends two rows on its border and one on its title; the table
    // spends one more on its header. What is left is what a cursor can stand on.
    const bodyRows = Math.max(0, height - 4);

    // selected and scroll are dependencies even though the report does not
    // carry them: `G` sets the selection past the end and leaves the reducer to
    // clamp it, which it can only do once something tells it the row count
    useEffect(() => {
        onRows?.(statuses.length, bodyRows);
    }, [onRows, statuses.length, bodyRows, selected, scroll]);

    const cursor = selected ?? 0;

    useEffect(() => {
        onTunnel?.(statuses[cursor]?.tunnel.name ?? null);
    }, [onTunnel, statuses, cursor]);

    const open = detail === null ? undefined : statuses.find(status => status.tunnel.name === detail);

    return (
        <Panel
            title="TUNNELS"
            subtitle={subtitle(statuses, probes, glyphs.separator)}
            width={width}
            height={height}
            focused={focused}
        >
            {({ width: inner, height: innerHeight }) => {
                if (config !== null && !isAvailable(config)) {
                    return <Missing reason={config} width={inner} height={innerHeight} />;
                }

                if (statuses.length === 0) {
                    return (
                        <Text color={theme.muted} wrap="truncate-end">
                            no tunnels configured — press e to write one
                        </Text>
                    );
                }

                // the detail takes rows from the table rather than adding them:
                // a panel that grows when you press a key moves the row out
                // from under the cursor
                const lines = open === undefined ? 0 : Math.min(open.output.length + 1, 5);
                const tableHeight = Math.max(1, innerHeight - lines);

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={statuses.map(status => toRow(status, byName.get(status.tunnel.name)))}
                            width={inner}
                            height={tableHeight}
                            selected={selected}
                            offset={scroll}
                            rowColor={index => stateColor(
                                statuses[index]!,
                                byName.get(statuses[index]!.tunnel.name),
                                theme,
                            )}
                        />
                        {open === undefined ? null : (
                            <Detail status={open} width={inner} lines={lines} />
                        )}
                    </Box>
                );
            }}
        </Panel>
    );
});


/**
 * The last thing ssh said.
 *
 * `ssh -N` is silent while it works, so an empty box here means "nothing has
 * gone wrong", and saying so is better than an empty box.
 */
function Detail({ status, width, lines }: { status: TunnelStatus; width: number; lines: number })
{
    const { theme } = useStyle();
    const shown = status.output.slice(-(lines - 1));

    return (
        <Box flexDirection="column" width={width} height={lines} overflow="hidden">
            <Text color={theme.label} wrap="truncate-end">{`${status.tunnel.name} — ssh output`}</Text>
            {shown.length === 0
                ? <Text color={theme.muted} dimColor wrap="truncate-end">nothing; ssh is quiet while it works</Text>
                : shown.map((line, i) => (
                    <Text key={i} color={theme.muted} wrap="truncate-end">{line}</Text>
                ))}
        </Box>
    );
}


/**
 * No usable config.
 *
 * A missing file is not a failure - nobody has written one yet - so it gets a
 * plain instruction rather than the Unavailable treatment, which is reserved
 * for things that went wrong.
 */
function Missing({ reason, width, height }: {
    reason: { reason: 'permission-denied' | 'not-found' | 'parse-error' | 'unsupported-platform' | 'not-applicable'; detail?: string };
    width: number;
    height: number;
})
{
    const { theme } = useStyle();

    if (reason.reason === 'not-found') {
        return (
            <Box flexDirection="column" width={width} height={height} overflow="hidden">
                <Text color={theme.muted} wrap="truncate-end">no tunnel config yet</Text>
                <Text color={theme.muted} dimColor wrap="truncate-end">
                    press e to write one and open it in your editor
                </Text>
            </Box>
        );
    }

    // every complaint the validator made, most useful first; the rest are in
    // `etop tunnel list`, which has a whole terminal to print them in
    const lines = (reason.detail ?? '').split('\n');

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Unavailable reason={reason.reason} detail={lines[0]} width={width} height={Math.min(2, height)} />
            {lines.slice(1, Math.max(0, height - 2)).map((line, i) => (
                <Text key={i} color={theme.muted} dimColor wrap="truncate-end">{line}</Text>
            ))}
        </Box>
    );
}


function subtitle(statuses: TunnelStatus[], probes: TunnelProbe[], separator: string): string
{
    if (statuses.length === 0) {
        return '';
    }

    const running = statuses.filter(status => status.phase === 'up').length;
    const broken = statuses.filter(status => status.phase === 'failed').length;
    const bound = probes.reduce((total, probe) => total + probe.bound, 0);
    const wanted = probes.reduce((total, probe) => total + probe.total, 0);

    const parts = [`${running}/${statuses.length} up`, `${bound}/${wanted} ports bound`];

    if (broken > 0) {
        parts.push(`${broken} failed`);
    }

    return parts.join(` ${separator} `);
}
