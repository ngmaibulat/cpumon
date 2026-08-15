/**
 * Message headers.
 *
 * The fixed header is `yyyyuu` - endianness, type, flags, protocol version,
 * body length, serial - followed by `a(yv)` of header fields. Then, and this is
 * the trap, **the whole header is padded to an 8-byte boundary before the body
 * begins**, and that padding is in neither the header array's length nor the
 * body's.
 *
 * The endianness byte is read from every reply rather than assumed. x86 will
 * only ever send 'l', but the field exists because it varies, and a client that
 * assumes will decode a big-endian peer into plausible nonsense rather than
 * failing.
 */
import type { DBusValue } from './types.js';
export declare const LITTLE_ENDIAN = 108;
export declare const BIG_ENDIAN = 66;
export declare const PROTOCOL_VERSION = 1;
export declare const MESSAGE_TYPE: {
    readonly methodCall: 1;
    readonly methodReturn: 2;
    readonly error: 3;
    readonly signal: 4;
};
/** the fixed part, up to and including the header array's own length word */
export declare const FIXED_HEADER = 16;
export declare const FIELD: {
    readonly path: 1;
    readonly iface: 2;
    readonly member: 3;
    readonly errorName: 4;
    readonly replySerial: 5;
    readonly destination: 6;
    readonly sender: 7;
    readonly signature: 8;
    readonly unixFds: 9;
};
export type MessageHeader = {
    littleEndian: boolean;
    type: number;
    flags: number;
    serial: number;
    bodyLength: number;
    path?: string;
    iface?: string;
    member?: string;
    errorName?: string;
    replySerial?: number;
    destination?: string;
    sender?: string;
    signature?: string;
};
export type Message = MessageHeader & {
    body: DBusValue[];
};
export type EncodeOptions = {
    type: number;
    serial: number;
    flags?: number;
    path?: string;
    iface?: string;
    member?: string;
    destination?: string;
    signature?: string;
    body?: DBusValue[];
    littleEndian?: boolean;
};
/**
 * Build a whole message.
 *
 * The body is marshalled first because the header has to state its length, and
 * the body is marshalled into its own writer starting at zero - which is correct
 * only because the header is padded to 8 before the body starts, so the two
 * agree about where the alignment clock began.
 */
export declare function encodeMessage(options: EncodeOptions): Buffer;
/**
 * How long the message starting at offset 0 is, or null if it is not all here.
 *
 * A stream gives no framing of its own, so this is what turns a socket's
 * arbitrary chunks back into messages.
 */
export declare function messageLength(buffer: Buffer): number | null;
export declare function decodeMessage(buffer: Buffer): Message;
