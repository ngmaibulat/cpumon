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
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
export type SocketProtocol = 'tcp' | 'tcp6' | 'udp' | 'udp6';
export type SocketState = 'ESTABLISHED' | 'SYN_SENT' | 'SYN_RECV' | 'FIN_WAIT1' | 'FIN_WAIT2' | 'TIME_WAIT' | 'CLOSE' | 'CLOSE_WAIT' | 'LAST_ACK' | 'LISTEN' | 'CLOSING' | 'UNKNOWN';
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
export type SocketOwner = {
    kind: 'process';
    pid: number;
    comm: string;
} | {
    kind: 'none';
} | {
    kind: 'denied';
};
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
export declare const TCP_STATES: Record<string, SocketState>;
export declare const SOCKET_PROTOCOLS: SocketProtocol[];
/**
 * Decode the address half of a `local_address` field.
 *
 * Eight hex digits is v4, thirty-two is v6, and anything else is a line this
 * parser does not understand rather than something to guess at.
 */
export declare function decodeAddress(hex: string): string | null;
/**
 * Parse one of the four socket tables.
 *
 * A header line, then one row per socket. Rows are identified by their `sl`
 * column - a run of digits and a colon - rather than by counting header lines,
 * so a truncated read or a file that is nothing but its header yields an empty
 * list instead of a row of NaN.
 */
export declare function parseNetSockets(text: string, protocol: SocketProtocol): Connection[];
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
export declare function getConnections(options?: CollectorOptions): Probe<{
    connections: Connection[];
}>;
/**
 * Attach an owner to each connection.
 *
 * Call this with the visible window rather than the whole list. The scan itself
 * is one pass whatever it is asked about, but the point is that it runs only
 * when a screen showing the column is open - the same bargain ProcessPanel
 * strikes for resident memory.
 */
export declare function resolveOwners(connections: Connection[], options?: CollectorOptions): Connection[];
