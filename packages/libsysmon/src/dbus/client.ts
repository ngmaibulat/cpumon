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

import { Socket } from 'node:net';


import { connectPath, systemBusAddress } from './address.js';
import { MESSAGE_TYPE, decodeMessage, encodeMessage, messageLength } from './message.js';
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
export class DBusError extends Error
{
    constructor(readonly name_: string, message: string)
    {
        super(`${name_}: ${message}`);
        this.name = 'DBusError';
    }
}


const DEFAULT_TIMEOUT = 5000;


export class DBusClient
{
    #socket: Socket;
    #buffer: Buffer = Buffer.alloc(0);
    #pending = new Map<number, { resolve: (body: DBusValue[]) => void; reject: (err: Error) => void }>();
    #serial = 1;
    #closed = false;
    #timeoutMs: number;

    /** the unique name the bus assigned us; diagnostic only */
    uniqueName = '';

    private constructor(socket: Socket, timeoutMs: number)
    {
        this.#socket = socket;
        this.#timeoutMs = timeoutMs;

        socket.on('data', chunk => this.#onData(chunk));

        // a dropped connection must fail every call waiting on it rather than
        // leaving them pending forever
        socket.on('error', err => this.#fail(err));
        socket.on('close', () => this.#fail(new Error('dbus: connection closed')));
    }

    get closed(): boolean
    {
        return this.#closed;
    }

    static async connect(options: DBusClientOptions = {}): Promise<DBusClient>
    {
        const address = systemBusAddress(options.address);

        if (address === null) {
            throw new Error('dbus: no unix bus address to connect to');
        }

        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
        const socket = await open(connectPath(address), timeoutMs);

        await authenticate(socket, timeoutMs);

        const client = new DBusClient(socket, timeoutMs);

        // Hello is mandatory: until it returns, the connection has no name and
        // the daemon will not route anything else
        const reply = await client.call({
            destination: 'org.freedesktop.DBus',
            path: '/org/freedesktop/DBus',
            iface: 'org.freedesktop.DBus',
            member: 'Hello',
        });

        client.uniqueName = String(reply[0] ?? '');

        return client;
    }

    call(options: CallOptions): Promise<DBusValue[]>
    {
        if (this.#closed) {
            return Promise.reject(new Error('dbus: client is closed'));
        }

        const serial = this.#serial++;

        const message = encodeMessage({
            type: MESSAGE_TYPE.methodCall,
            serial,
            path: options.path,
            iface: options.iface,
            member: options.member,
            destination: options.destination,
            signature: options.signature,
            body: options.body,
        });

        return new Promise<DBusValue[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(serial);
                reject(new Error(`dbus: ${options.member} did not answer in ${this.#timeoutMs}ms`));
            }, this.#timeoutMs);

            // never hold the event loop open on our own account
            timer.unref?.();

            this.#pending.set(serial, {
                resolve: body => {
                    clearTimeout(timer);
                    resolve(body);
                },
                reject: err => {
                    clearTimeout(timer);
                    reject(err);
                },
            });

            this.#socket.write(message);
        });
    }

    close(): void
    {
        this.#closed = true;
        this.#socket.destroy();
        this.#fail(new Error('dbus: client closed'));
    }

    #fail(err: Error): void
    {
        this.#closed = true;

        const waiting = [...this.#pending.values()];

        this.#pending.clear();

        for (const entry of waiting) {
            entry.reject(err);
        }
    }

    /**
     * Reassemble messages from a stream that knows nothing about them.
     *
     * A chunk can hold half a message, three messages, or two and a half - so
     * the loop consumes whole messages only and keeps the remainder.
     */
    #onData(chunk: Buffer): void
    {
        this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);

        for (;;) {
            const length = messageLength(this.#buffer);

            if (length === null) {
                return;
            }

            const frame = this.#buffer.subarray(0, length);

            this.#buffer = this.#buffer.subarray(length);

            try {
                this.#dispatch(decodeMessage(frame));
            }
            catch (err) {
                // a message this cannot decode is not a reason to drop the
                // connection: it may be a signal in a shape we never asked
                // about. A reply we cannot read will time out on its own.
                void err;
            }
        }
    }

    #dispatch(message: ReturnType<typeof decodeMessage>): void
    {
        if (message.replySerial === undefined) {
            // a signal, or a call to us; nothing here subscribes or serves
            return;
        }

        const waiting = this.#pending.get(message.replySerial);

        if (waiting === undefined) {
            return;
        }

        this.#pending.delete(message.replySerial);

        if (message.type === MESSAGE_TYPE.error) {
            waiting.reject(new DBusError(
                message.errorName ?? 'org.freedesktop.DBus.Error.Failed',
                String(message.body[0] ?? ''),
            ));

            return;
        }

        waiting.resolve(message.body);
    }
}


/**
 * Connect, with the error listener attached before anything can fail.
 *
 * `createConnection()` starts connecting immediately, and bun's net shim
 * surfaces a bad path before the caller has had a chance to attach a listener -
 * where node emits it on a later tick. An unhandled 'error' event is a thrown
 * exception, so on bun the "no such socket" case escaped as a crash rather than
 * resolving to an Unavailable. Building the socket first and connecting last
 * removes the window on both.
 */
function open(path: string, timeoutMs: number): Promise<Socket>
{
    return new Promise((resolve, reject) => {
        const socket = new Socket();

        let settled = false;

        const done = (err: Error | null): void => {
            if (settled) {
                return;
            }

            settled = true;

            socket.off('connect', onConnect);
            socket.off('error', onError);
            clearTimeout(timer);

            if (err === null) {
                resolve(socket);
            }
            else {
                socket.destroy();
                reject(err);
            }
        };

        const onConnect = (): void => done(null);
        const onError = (err: Error): void => done(err);

        const timer = setTimeout(
            () => done(new Error(`dbus: ${path} did not accept a connection in ${timeoutMs}ms`)),
            timeoutMs,
        );

        timer.unref?.();

        socket.once('connect', onConnect);
        socket.once('error', onError);

        // last, and guarded: a synchronous throw here would leave the promise
        // pending forever rather than rejecting
        try {
            socket.connect({ path });
        }
        catch (err) {
            done(err as Error);
        }
    });
}


/**
 * The EXTERNAL handshake.
 *
 * NEGOTIATE_UNIX_FD is skipped: nothing here passes a file descriptor, and
 * asking for a capability we will not use is one more answer to get wrong.
 */
function authenticate(socket: Socket, timeoutMs: number): Promise<void>
{
    return new Promise((resolve, reject) => {
        let text = '';

        const done = (err: Error | null): void => {
            socket.off('data', onData);
            socket.off('error', onError);
            clearTimeout(timer);

            err === null ? resolve() : reject(err);
        };

        const onError = (err: Error): void => done(err);

        const onData = (chunk: Buffer): void => {
            text += chunk.toString('latin1');

            const end = text.indexOf('\r\n');

            if (end === -1) {
                return;
            }

            const line = text.slice(0, end);

            if (line.startsWith('OK')) {
                socket.write('BEGIN\r\n');
                done(null);

                return;
            }

            if (line.startsWith('REJECTED')) {
                done(new Error(`dbus: authentication rejected (${line.slice(9).trim() || 'no mechanisms offered'})`));

                return;
            }

            done(new Error(`dbus: unexpected authentication reply ${JSON.stringify(line)}`));
        };

        const timer = setTimeout(() => done(new Error(`dbus: no authentication reply in ${timeoutMs}ms`)), timeoutMs);

        timer.unref?.();

        socket.on('data', onData);
        socket.once('error', onError);

        const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
        // the hex of the DECIMAL SPELLING of the uid: 1000 -> "1000" -> 31303030
        const credential = Buffer.from(String(uid), 'utf8').toString('hex');

        // the leading NUL is not part of any line; it is a byte the protocol
        // requires before the conversation begins
        socket.write(`\0AUTH EXTERNAL ${credential}\r\n`);
    });
}
