/**
 * The only file here that touches a socket.
 *
 * Scope is deliberately tiny: connect, authenticate, call a method, read the
 * reply. No signals, no properties-changed subscriptions, no server side, no
 * introspection. Both consumers poll and neither needs to be pushed to, and
 * every one of those features is a state machine that would have to be correct
 * for something nothing asks for.
 *
 * If this file grows past roughly 300 lines, or the directory past 600, the
 * scope has crept and it is time to reconsider taking a dependency.
 *
 * ## Authentication
 *
 * EXTERNAL, which on a unix socket means the kernel already told the daemon who
 * we are through SO_PEERCRED - so the "credential" is just our uid, and the
 * handshake is a formality. It is still a formality with an exact shape: a bare
 * NUL byte first, on the socket and outside any line, then ASCII lines ending
 * CRLF. The uid is sent as the hex of its *decimal spelling*: uid 1000 is the
 * four characters "1000", which is 31303030, not 0x3e8.
 */
import type { DBusValue } from './types.js';
export type DBusClientOptions = {
    /** a bus address, or a bare socket path; defaults to the system bus */
    address?: string;
    timeoutMs?: number;
};
export type CallOptions = {
    destination: string;
    path: string;
    iface: string;
    member: string;
    signature?: string;
    body?: DBusValue[];
};
/**
 * A D-Bus error reply.
 *
 * Distinct from a transport failure on purpose: the bus answered, and what it
 * said was "no". The collector maps the two to different Unavailable reasons.
 */
export declare class DBusError extends Error {
    readonly name_: string;
    constructor(name_: string, message: string);
}
export declare class DBusClient {
    #private;
    /** the unique name the bus assigned us; diagnostic only */
    uniqueName: string;
    private constructor();
    get closed(): boolean;
    static connect(options?: DBusClientOptions): Promise<DBusClient>;
    call(options: CallOptions): Promise<DBusValue[]>;
    close(): void;
}
