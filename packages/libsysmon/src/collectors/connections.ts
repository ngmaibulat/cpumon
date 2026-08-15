/**
 * TCP and UDP sockets, from /proc/net/{tcp,tcp6,udp,udp6}.
 *
 * Four files, one column layout, and three details in it that are traps rather
 * than trivia. Get any of them wrong and the output is not obviously broken -
 * it is plausible and false, which is worse.
 *
 * 1. The addresses are little-endian hex, one 32-bit word at a time. 0100007F
 *    is 127.0.0.1, not 1.0.0.127. The v6 form is four words, each individually
 *    byte-swapped, so "reverse the whole string" produces addresses that look
 *    like addresses and point somewhere else entirely.
 * 2. The port sharing that field is big-endian. A6E3 is 42723 and 01BB is 443,
 *    opposite convention to the address, separated by a colon.
 * 3. `st` is a hex state code, not a name. The table is short and lives here,
 *    because a panel that has to know 01 means ESTABLISHED is a panel that has
 *    grown a second copy of this file's knowledge.
 *
 * Owner resolution is deliberately NOT part of getConnections(). It costs a
 * readdir and a readlink per file descriptor on the machine, and it is only
 * worth paying for rows someone is actually looking at - so it is a separate
 * exported pass the caller opts into. See resolveOwners() below.
 */

import { readdirSync, readlinkSync } from 'node:fs';

import { unavailable } from '../types.js';
import type { Probe, Unavailable } from '../types.js';
import { procRoot, readText } from './proc.js';
import type { CollectorOptions } from './proc.js';
import { parsePidStat } from './process.js';


export type SocketProtocol = 'tcp' | 'tcp6' | 'udp' | 'udp6';


export type SocketState =
    | 'ESTABLISHED' | 'SYN_SENT' | 'SYN_RECV' | 'FIN_WAIT1' | 'FIN_WAIT2'
    | 'TIME_WAIT' | 'CLOSE' | 'CLOSE_WAIT' | 'LAST_ACK' | 'LISTEN' | 'CLOSING'
    | 'UNKNOWN';


/**
 * Who holds a socket - as three states, not an optional pid.
 *
 * Finding the owner means reading /proc/[pid]/fd for every process, and most of
 * those directories belong to other users. Measured on an ordinary desktop as a
 * non-root user: 398 of 557 processes denied the read. So "no owner found" is
 * the common case, and it covers two entirely different facts - that nothing
 * holds this socket (a TIME_WAIT remnant, genuinely ownerless) and that
 * something holds it and you were not allowed to see what.
 *
 * Reporting both as a blank is the kind of quiet falsehood the rest of this
 * package goes out of its way to avoid, so they are distinct values and the
 * caller is made to handle them separately.
 */
export type SocketOwner =
    | { kind: 'process'; pid: number; comm: string }
    | { kind: 'none' }
    | { kind: 'denied' };


export type Connection = {
    protocol: SocketProtocol;
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
    state: SocketState;
    uid: number;
    inode: number;
    txQueue: number;
    rxQueue: number;
    /** absent until resolveOwners() has been asked for it */
    owner?: SocketOwner;
};


/**
 * The kernel's hex state codes.
 *
 * UDP reuses this column with a much smaller vocabulary - an unconnected socket
 * reads 07, which lands on CLOSE. That is the kernel's own overload rather than
 * a mapping invented here, and inventing an UNCONNECTED name for it would mean
 * this table stopped describing what the file actually says.
 */
export const TCP_STATES: Record<string, SocketState> = {
    '01': 'ESTABLISHED',
    '02': 'SYN_SENT',
    '03': 'SYN_RECV',
    '04': 'FIN_WAIT1',
    '05': 'FIN_WAIT2',
    '06': 'TIME_WAIT',
    '07': 'CLOSE',
    '08': 'CLOSE_WAIT',
    '09': 'LAST_ACK',
    '0A': 'LISTEN',
    '0B': 'CLOSING',
};


const PROTOCOL_FILES: Record<SocketProtocol, string> = {
    tcp: 'net/tcp',
    tcp6: 'net/tcp6',
    udp: 'net/udp',
    udp6: 'net/udp6',
};


export const SOCKET_PROTOCOLS = Object.keys(PROTOCOL_FILES) as SocketProtocol[];


const HEX = /^[0-9A-Fa-f]+$/;


/**
 * One 8-hex-digit word, byte-reversed into network order.
 *
 * The kernel prints an address word with %08X, which on a little-endian machine
 * emits the bytes of a network-order value back to front. Undoing that is a
 * per-word operation, never a whole-string one.
 */
function swapWord(word: string): number[]
{
    const bytes: number[] = [];

    for (let at = 6; at >= 0; at -= 2) {
        bytes.push(parseInt(word.slice(at, at + 2), 16));
    }

    return bytes;
}


/**
 * Render 16 bytes as an address, with the longest zero run compressed to `::`.
 *
 * Runs of one group are left alone: `::` standing in for a single zero saves no
 * width and RFC 5952 forbids it, and two addresses that differ would otherwise
 * be able to render identically.
 */
function formatIpv6(bytes: number[]): string
{
    const groups: number[] = [];

    for (let at = 0; at < 16; at += 2) {
        groups.push((bytes[at] << 8) | bytes[at + 1]);
    }

    let bestStart = -1;
    let bestLength = 0;
    let start = -1;
    let length = 0;

    for (let at = 0; at < 8; at++) {
        if (groups[at] !== 0) {
            start = -1;
            length = 0;
            continue;
        }

        if (start === -1) {
            start = at;
        }

        length++;

        if (length > bestLength) {
            bestLength = length;
            bestStart = start;
        }
    }

    const text = groups.map(group => group.toString(16));

    if (bestLength < 2) {
        return text.join(':');
    }

    return `${text.slice(0, bestStart).join(':')}::${text.slice(bestStart + bestLength).join(':')}`;
}


/**
 * Decode the address half of a `local_address` field.
 *
 * Eight hex digits is v4, thirty-two is v6, and anything else is a line this
 * parser does not understand rather than something to guess at.
 */
export function decodeAddress(hex: string): string | null
{
    if (!HEX.test(hex)) {
        return null;
    }

    if (hex.length === 8) {
        return swapWord(hex).join('.');
    }

    if (hex.length === 32) {
        const bytes: number[] = [];

        for (let word = 0; word < 4; word++) {
            bytes.push(...swapWord(hex.slice(word * 8, word * 8 + 8)));
        }

        return formatIpv6(bytes);
    }

    return null;
}


/** `0100007F:A6E3` - little-endian address, big-endian port, one colon. */
function decodeEndpoint(field: string): { address: string; port: number } | null
{
    const colon = field.indexOf(':');

    if (colon === -1) {
        return null;
    }

    const address = decodeAddress(field.slice(0, colon));
    const portHex = field.slice(colon + 1);

    if (address === null || !HEX.test(portHex)) {
        return null;
    }

    return { address, port: parseInt(portHex, 16) };
}


/**
 * Parse one of the four socket tables.
 *
 * A header line, then one row per socket. Rows are identified by their `sl`
 * column - a run of digits and a colon - rather than by counting header lines,
 * so a truncated read or a file that is nothing but its header yields an empty
 * list instead of a row of NaN.
 */
export function parseNetSockets(text: string, protocol: SocketProtocol): Connection[]
{
    const connections: Connection[] = [];

    for (const line of text.split('\n')) {
        const columns = line.trim().split(/\s+/);

        // the slot number, and the only reliable mark of a data row
        if (!/^\d+:$/.test(columns[0] ?? '')) {
            continue;
        }

        const local = decodeEndpoint(columns[1] ?? '');
        const remote = decodeEndpoint(columns[2] ?? '');

        if (local === null || remote === null) {
            continue;
        }

        // tx_queue:rx_queue share a field, both hex
        const queues = (columns[4] ?? '').split(':');

        const uid = Number(columns[7]);
        const inode = Number(columns[9]);

        if (!Number.isFinite(uid) || !Number.isFinite(inode)) {
            continue;
        }

        connections.push({
            protocol,
            localAddress: local.address,
            localPort: local.port,
            remoteAddress: remote.address,
            remotePort: remote.port,
            state: TCP_STATES[(columns[3] ?? '').toUpperCase()] ?? 'UNKNOWN',
            uid,
            inode,
            txQueue: parseInt(queues[0] ?? '', 16) || 0,
            rxQueue: parseInt(queues[1] ?? '', 16) || 0,
        });
    }

    return connections;
}


/**
 * Read every socket table that exists.
 *
 * A missing file is a missing protocol, not a failed collector: a kernel built
 * without IPv6 has no /proc/net/tcp6, and refusing to report the v4 sockets
 * because of it would be a worse answer than the partial one. Only a machine
 * where none of the four could be read has nothing to say, and then the first
 * failure is passed through verbatim so `permission-denied` does not get
 * flattened into `not-found`.
 */
export function getConnections(options?: CollectorOptions): Probe<{ connections: Connection[] }>
{
    const root = procRoot(options);

    const connections: Connection[] = [];
    let firstFailure: Unavailable | null = null;
    let failures = 0;

    for (const protocol of SOCKET_PROTOCOLS) {
        const result = readText(`${root}/${PROTOCOL_FILES[protocol]}`);

        if (!result.ok) {
            firstFailure ??= unavailable(result.reason, result.detail);
            failures++;
            continue;
        }

        connections.push(...parseNetSockets(result.text, protocol));
    }

    // an empty list from four readable files is a real answer - a machine can
    // genuinely hold no sockets - so the test is whether anything was readable,
    // not whether anything was found
    if (firstFailure !== null && failures === SOCKET_PROTOCOLS.length) {
        return firstFailure;
    }

    return { available: true, connections };
}


/**
 * Build inode -> pid over every process whose file descriptors can be read.
 *
 * One pass answers every row, so the per-row cost afterwards is a Map lookup.
 * `denied` comes back alongside because an unreadable fd directory changes what
 * a miss means, and that distinction cannot be recovered later.
 */
function socketInodes(root: string): { owners: Map<number, number>; denied: boolean }
{
    const owners = new Map<number, number>();
    let denied = false;

    let entries: string[];

    try {
        entries = readdirSync(root);
    }
    catch {
        return { owners, denied: true };
    }

    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) {
            continue;
        }

        const pid = Number(entry);

        let descriptors: string[];

        try {
            descriptors = readdirSync(`${root}/${entry}/fd`);
        }
        catch (err) {
            // a process that exited between the readdir and this one is normal
            // and says nothing about permissions; anything else is a wall
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                denied = true;
            }

            continue;
        }

        for (const descriptor of descriptors) {
            let target: string;

            try {
                target = readlinkSync(`${root}/${entry}/fd/${descriptor}`);
            }
            catch {
                continue;
            }

            const match = /^socket:\[(\d+)\]$/.exec(target);

            if (match !== null) {
                // first writer wins: a socket shared by a parent and its fork
                // is reported against whichever holds it lower in /proc order,
                // and there is no basis for preferring the other
                if (!owners.has(Number(match[1]))) {
                    owners.set(Number(match[1]), pid);
                }
            }
        }
    }

    return { owners, denied };
}


/**
 * Attach an owner to each connection.
 *
 * Call this with the visible window rather than the whole list. The scan itself
 * is one pass whatever it is asked about, but the point is that it runs only
 * when a screen showing the column is open - the same bargain ProcessPanel
 * strikes for resident memory.
 */
export function resolveOwners(connections: Connection[], options?: CollectorOptions): Connection[]
{
    if (connections.length === 0) {
        return connections;
    }

    const root = procRoot(options);
    const { owners, denied } = socketInodes(root);
    const comms = new Map<number, string>();

    const commOf = (pid: number): string => {
        const cached = comms.get(pid);

        if (cached !== undefined) {
            return cached;
        }

        // read only for pids that actually own a socket in hand, not for all of
        // /proc: this is the second file per process the process collector also
        // refuses to pay for up front
        const result = readText(`${root}/${pid}/stat`);
        const comm = result.ok ? parsePidStat(result.text)?.comm ?? String(pid) : String(pid);

        comms.set(pid, comm);

        return comm;
    };

    return connections.map(connection => {
        const pid = owners.get(connection.inode);

        if (pid !== undefined) {
            return { ...connection, owner: { kind: 'process', pid, comm: commOf(pid) } as SocketOwner };
        }

        return { ...connection, owner: { kind: denied ? 'denied' : 'none' } as SocketOwner };
    });
}
