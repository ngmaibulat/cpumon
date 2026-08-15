/**
 * TCP and UDP sockets.
 *
 * The PROCESS column is why this panel needs care rather than just a table.
 * Finding who holds a socket means reading /proc/[pid]/fd for every process,
 * and on an ordinary machine most of those belong to other users - so the
 * column is blank for the majority of rows, and blank covers two entirely
 * different facts: nothing holds this socket, and something does and you were
 * not allowed to see it.
 *
 * libsysmon keeps those apart as SocketOwner, and this panel keeps them apart
 * on screen: '-' for genuinely ownerless, '?' for withheld, plus a footnote
 * whenever any row is withheld. Same shape as ContainerPanel's namespaced
 * footnote, and for the same reason - a dashboard is very good at hiding the
 * difference between "nothing there" and "cannot see", and hiding it is how
 * someone draws a confident wrong conclusion.
 *
 * The one-<Text>-per-row rule means the '?' cannot be dimmed on its own, so the
 * distinction is carried by the character rather than by colour.
 */

import { Box, Text } from 'ink';
import { memo, useEffect, useMemo } from 'react';
import { isAvailable, resolveOwners } from 'libsysmon';
import type { Connection, SocketState } from 'libsysmon';

import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import { cell } from '../render/columns.js';
import type { Column } from '../render/columns.js';


export type ConnectionPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    /** index into the connection list */
    selected?: number;
    /** the first row to show; the reducer owns scrolling */
    scroll?: number;
    /** how many rows there are and how many fit, once both are known */
    onRows?: (rowCount: number, windowRows: number) => void;
    /**
     * How owners are found. Defaults to libsysmon's /proc scan.
     *
     * A seam rather than a hard call, for the same reason every collector takes
     * a procRoot: this is the one thing in the panel that reads the machine, and
     * a test that cannot replace it asserts against whatever happens to be
     * listening on the runner.
     */
    resolve?: (connections: Connection[]) => Connection[];
};


const COLUMNS: Column[] = [
    { key: 'proto', header: 'PROTO', align: 'left', min: 5, priority: 60 },
    { key: 'local', header: 'LOCAL', align: 'left', min: 14, priority: 100 },
    { key: 'remote', header: 'REMOTE', align: 'left', min: 14, priority: 80 },
    { key: 'state', header: 'STATE', align: 'left', min: 11, priority: 90 },
    { key: 'owner', header: 'PROCESS', align: 'left', min: 8, flex: true, priority: 70 },
];


/** what the '?' cells mean, said once so the column does not have to guess */
const FOOTNOTE = '? = a process holds it that this user may not see; run as root';


/**
 * Sort order, most interesting first.
 *
 * Someone opening this screen is usually asking "what is listening?", so
 * listeners come first and the dead-and-dying states sink. Within a state the
 * order is by local port, which groups a service's sockets together.
 *
 * inode is the tiebreaker for the same reason pid is in sortProcesses: it is
 * the only field guaranteed unique here, and without it a host with a dozen
 * identical TIME_WAIT rows reshuffles them every tick for no visible reason.
 */
const STATE_ORDER: SocketState[] = [
    'LISTEN', 'ESTABLISHED', 'SYN_SENT', 'SYN_RECV', 'FIN_WAIT1', 'FIN_WAIT2',
    'CLOSE_WAIT', 'LAST_ACK', 'CLOSING', 'TIME_WAIT', 'CLOSE', 'UNKNOWN',
];


export function compareConnections(a: Connection, b: Connection): number
{
    const byState = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);

    if (byState !== 0) {
        return byState;
    }

    return a.localPort - b.localPort || a.inode - b.inode;
}


/** `addr:port`, `[v6]:port`, or '-' when there is no peer at all. */
export function endpoint(address: string, port: number): string
{
    // an unconnected socket reads 0.0.0.0:0 or :::0; writing that out invites
    // it to be read as a peer that happens to be at port zero
    if (port === 0 && (address === '0.0.0.0' || address === '::')) {
        return '-';
    }

    // a v6 address is already full of colons, so the port needs a bracket to be
    // a port rather than one more group. `ss` writes [::]:5555 for the same
    // reason, and without it 2001:db8::1:51000 is not even unambiguous.
    return address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`;
}


export function ownerCell(connection: Connection): string
{
    const owner = connection.owner;

    // absent means resolveOwners was never asked; that is the same amount of
    // knowledge as a denied read, so it renders the same way rather than
    // claiming the socket is ownerless
    if (owner === undefined || owner.kind === 'denied') {
        return '?';
    }

    return owner.kind === 'process' ? owner.comm : '-';
}


export function toRow(connection: Connection): string[]
{
    return [
        connection.protocol,
        endpoint(connection.localAddress, connection.localPort),
        endpoint(connection.remoteAddress, connection.remotePort),
        connection.state,
        ownerCell(connection),
    ];
}


export const ConnectionPanel = memo(function ConnectionPanel({
    width,
    height,
    focused = false,
    selected,
    scroll = 0,
    onRows,
    resolve = resolveOwners,
}: ConnectionPanelProps)
{
    const { snapshot, ticks } = useStoreState();
    const { theme, glyphs } = useStyle();

    const probe = snapshot?.connections;
    const raw = probe !== undefined && isAvailable(probe) ? probe.connections : undefined;

    /**
     * Sort and resolve owners once per snapshot.
     *
     * The design note for this phase called for resolving only the visible
     * window. That saves less than it looks: resolveOwners builds one
     * inode -> pid map over the whole machine whatever it is asked about, so
     * windowing would trim a handful of comm reads and nothing else - while
     * making every scroll that shifts the window pay the ~50 ms scan again.
     * Keying the memo on the snapshot instead bounds the cost at once per tick
     * and keeps the cursor keys instant, which is the point the note was
     * protecting.
     *
     * The part that does matter is unchanged: none of this runs unless the conn
     * screen is open, because that is the only thing that mounts this panel.
     */
    const connections = useMemo(
        () => (raw === undefined ? [] : resolve([...raw].sort(compareConnections))),
        [raw, resolve],
    );

    const denied = connections.some(item => item.owner?.kind === 'denied');

    // Panel spends two rows on its border and one on its title; the table
    // spends one more on its header, and the footnote takes a row when it
    // applies. What is left is what a cursor can actually stand on.
    const footnote = denied && height - 3 >= 3;
    const bodyRows = Math.max(0, height - 4 - (footnote ? 1 : 0));

    // selected and scroll are dependencies even though the report does not
    // carry them: `G` sets the selection past the end and leaves the reducer to
    // clamp it, which it can only do once something tells it the row count.
    useEffect(() => {
        onRows?.(connections.length, bodyRows);
    }, [onRows, connections.length, bodyRows, selected, scroll]);

    return (
        <Panel
            title="CONNECTIONS"
            subtitle={raw === undefined ? undefined : String(connections.length)}
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

                if (connections.length === 0) {
                    return ticks <= 1
                        ? <Loading width={inner} height={innerHeight} />
                        : <Text color={theme.muted} wrap="truncate-end">no sockets open</Text>;
                }

                // the footnote is not optional when it applies, so it claims its
                // row before the table gets one
                const tableHeight = Math.max(1, innerHeight - (footnote ? 1 : 0));

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        <Table
                            columns={COLUMNS}
                            rows={connections.map(toRow)}
                            width={inner}
                            height={tableHeight}
                            selected={selected}
                            offset={scroll}
                        />
                        {footnote ? (
                            // truncated here rather than by ink's wrap, which
                            // appends U+2026 whatever the terminal can draw -
                            // and a replacement box is exactly what the glyph
                            // set exists to avoid
                            <Text color={theme.muted} dimColor wrap="truncate-end">
                                {cell(FOOTNOTE, inner, 'left', glyphs.ellipsis)}
                            </Text>
                        ) : null}
                    </Box>
                );
            }}
        </Panel>
    );
});
