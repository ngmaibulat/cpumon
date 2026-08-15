/**
 * Whether a tunnel's ports are actually listening.
 *
 * This is the honest answer to "is it up", and it is deliberately not derived
 * from the ssh process. A live child proves ssh is running; a bound port proves
 * the forward exists. Those are different claims, and the second is the one
 * somebody opening this screen wants.
 *
 * It costs nothing to ask. /proc/net/tcp is already read every tick for the
 * connections screen - `getConnections` is in the collector list in index.ts -
 * so this is a join against a snapshot that had to be taken anyway. No new
 * sampling, no new socket, and in particular no subprocess: the amendment in
 * plans/README.md turns on this file existing.
 *
 * Pure, so the interesting assertions are about which ports are matched rather
 * than about what /proc happens to contain today.
 */

import type { Connection, SocketOwner } from 'libsysmon';

import type { Forward, Tunnel } from './config.js';


export type PortStatus = {
    port: number;
    listening: boolean;
    /** absent unless resolveOwners() has been asked for it */
    owner?: SocketOwner;
};


export type TunnelProbe = {
    name: string;
    ports: PortStatus[];
    /** how many of the local forwards have a listening socket */
    bound: number;
    /** how many local forwards there are; zero means nothing to check */
    total: number;
};


/**
 * The ports a tunnel opens on *this* machine.
 *
 * Only local and dynamic forwards. A remote forward binds on the far end,
 * where this process cannot see it, and counting it here would mean a tunnel
 * that works reports 1/2 for ever.
 */
export function localPorts(tunnel: Tunnel): number[]
{
    return tunnel.forwards.filter(listensHere).map(forward => forward.port);
}


function listensHere(forward: Forward): boolean
{
    return forward.kind === 'local' || forward.kind === 'dynamic';
}


/**
 * Join the configured ports against what is listening.
 *
 * A port counts as listening when some socket is in LISTEN on it. That is a
 * fact about the machine, not a claim about whose socket it is - which is why
 * `owner` is reported separately and never inferred from. See the note on
 * `etop tunnel down` in the CLI help: "a process holding this port" and "the
 * tunnel I configured" are not the same thing, and only one of them is
 * observable.
 */
export function probeTunnels(tunnels: Tunnel[], connections: Connection[]): TunnelProbe[]
{
    const listening = new Map<number, Connection>();

    for (const connection of connections) {
        if (connection.state !== 'LISTEN') {
            continue;
        }

        // first writer wins: a port bound on both 0.0.0.0 and ::1 shows twice,
        // and either row is equally good evidence that it is bound
        if (!listening.has(connection.localPort)) {
            listening.set(connection.localPort, connection);
        }
    }

    return tunnels.map(tunnel => {
        const ports = localPorts(tunnel).map((port): PortStatus => {
            const connection = listening.get(port);

            if (connection === undefined) {
                return { port, listening: false };
            }

            return connection.owner === undefined
                ? { port, listening: true }
                : { port, listening: true, owner: connection.owner };
        });

        return {
            name: tunnel.name,
            ports,
            bound: ports.filter(port => port.listening).length,
            total: ports.length,
        };
    });
}


/**
 * The owner column, as a person would read it.
 *
 * 'denied' is spelled out rather than blanked. On a normal machine most
 * sockets belong to other users and their owner cannot be resolved at all -
 * `collectors/connections.ts` counts 398 of 557 processes denied - and a blank
 * cell would say "nobody holds this", which is a different and false claim.
 */
export function ownerText(owner: SocketOwner | undefined): string
{
    if (owner === undefined) {
        return '-';
    }

    if (owner.kind === 'process') {
        return `${owner.comm} (${owner.pid})`;
    }

    return owner.kind === 'denied' ? 'denied' : '-';
}
