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

import { Variant, align, parseSignature } from './types.js';
import type { DBusValue } from './types.js';
import { Writer, writeValue } from './marshal.js';
import { Reader, readValue } from './unmarshal.js';


export const LITTLE_ENDIAN = 0x6c;   // 'l'
export const BIG_ENDIAN = 0x42;      // 'B'

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPE = {
    methodCall: 1,
    methodReturn: 2,
    error: 3,
    signal: 4,
} as const;

/** the fixed part, up to and including the header array's own length word */
export const FIXED_HEADER = 16;

export const FIELD = {
    path: 1,
    iface: 2,
    member: 3,
    errorName: 4,
    replySerial: 5,
    destination: 6,
    sender: 7,
    signature: 8,
    unixFds: 9,
} as const;

const FIELD_TYPE: Record<number, string> = {
    [FIELD.path]: 'o',
    [FIELD.iface]: 's',
    [FIELD.member]: 's',
    [FIELD.errorName]: 's',
    [FIELD.replySerial]: 'u',
    [FIELD.destination]: 's',
    [FIELD.sender]: 's',
    [FIELD.signature]: 'g',
    [FIELD.unixFds]: 'u',
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


export type Message = MessageHeader & { body: DBusValue[] };


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
export function encodeMessage(options: EncodeOptions): Buffer
{
    const littleEndian = options.littleEndian ?? true;
    const signature = options.signature ?? '';

    const bodyWriter = new Writer(littleEndian);

    if (signature !== '') {
        parseSignature(signature).forEach((type, i) => {
            writeValue(bodyWriter, type, (options.body ?? [])[i]);
        });
    }

    const body = bodyWriter.take();

    const fields: DBusValue[] = [];

    const push = (code: number, value: string | undefined): void => {
        if (value !== undefined && value !== '') {
            fields.push([code, new Variant(FIELD_TYPE[code], value)]);
        }
    };

    push(FIELD.path, options.path);
    push(FIELD.iface, options.iface);
    push(FIELD.member, options.member);
    push(FIELD.destination, options.destination);
    push(FIELD.signature, signature);

    const writer = new Writer(littleEndian);

    writer.byte(littleEndian ? LITTLE_ENDIAN : BIG_ENDIAN);
    writer.byte(options.type);
    writer.byte(options.flags ?? 0);
    writer.byte(PROTOCOL_VERSION);
    writer.uint32(body.length);
    writer.uint32(options.serial);

    writeValue(writer, 'a(yv)', fields);

    // the body begins on an 8-byte boundary, always
    writer.align(8);
    writer.bytes(Buffer.from(body));

    return Buffer.from(writer.take());
}


/**
 * How long the message starting at offset 0 is, or null if it is not all here.
 *
 * A stream gives no framing of its own, so this is what turns a socket's
 * arbitrary chunks back into messages.
 */
export function messageLength(buffer: Buffer): number | null
{
    if (buffer.length < FIXED_HEADER) {
        return null;
    }

    const littleEndian = buffer.readUInt8(0) === LITTLE_ENDIAN;

    const bodyLength = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    const fieldsLength = littleEndian ? buffer.readUInt32LE(12) : buffer.readUInt32BE(12);

    // fixed header, the field array, the padding to 8, then the body
    const total = align(FIXED_HEADER + fieldsLength, 8) + bodyLength;

    return buffer.length < total ? null : total;
}


export function decodeMessage(buffer: Buffer): Message
{
    const endianness = buffer.readUInt8(0);

    if (endianness !== LITTLE_ENDIAN && endianness !== BIG_ENDIAN) {
        throw new Error(`dbus: unknown endianness byte 0x${endianness.toString(16)}`);
    }

    const littleEndian = endianness === LITTLE_ENDIAN;
    const reader = new Reader(buffer, 1, littleEndian);

    const type = reader.byte();
    const flags = reader.byte();

    reader.byte();   // protocol version, which only ever moves with the format

    const bodyLength = reader.uint32();
    const serial = reader.uint32();

    const header: MessageHeader = { littleEndian, type, flags, serial, bodyLength };

    for (const entry of readValue(reader, 'a(yv)') as DBusValue[]) {
        const [code, value] = entry as DBusValue[];

        switch (Number(code)) {
            case FIELD.path: header.path = String(value); break;
            case FIELD.iface: header.iface = String(value); break;
            case FIELD.member: header.member = String(value); break;
            case FIELD.errorName: header.errorName = String(value); break;
            case FIELD.replySerial: header.replySerial = Number(value); break;
            case FIELD.destination: header.destination = String(value); break;
            case FIELD.sender: header.sender = String(value); break;
            case FIELD.signature: header.signature = String(value); break;
            default: break;   // unix fds and anything a later spec adds
        }
    }

    reader.align(8);

    const body = header.signature === undefined || header.signature === ''
        ? []
        : parseBody(header.signature, buffer, reader.offset, littleEndian);

    return { ...header, body };
}


function parseBody(signature: string, buffer: Buffer, offset: number, littleEndian: boolean): DBusValue[]
{
    const reader = new Reader(buffer, offset, littleEndian);

    return parseSignature(signature).map(type => readValue(reader, type));
}
