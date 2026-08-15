/**
 * Values to bytes.
 *
 * Pure: a signature and an array of values in, a Buffer out. No socket, no
 * daemon, so the whole thing is testable as a table of values on any platform -
 * which matters more here than anywhere else in the package, because a
 * hand-rolled binary format whose tests are written afterwards is a format that
 * agrees with its own bugs.
 *
 * Two rules carry most of the risk:
 *
 * 1. Alignment padding is measured from the start of the message, so a writer
 *    that has been handed a starting offset must keep counting from it. The
 *    header is marshalled at offset 0 and the body at its own 0 - which is
 *    correct only because the body always begins on an 8-byte boundary, and
 *    that padding is the caller's job.
 * 2. An array's length is the byte count of its *contents*, taken after the
 *    padding that aligns the first element. The padding is not in the count.
 */

import { Variant, align, alignmentOf, completeTypeLength, parseSignature } from './types.js';
import type { DBusValue } from './types.js';


export class Writer
{
    #buffer: Buffer;
    #length = 0;

    readonly littleEndian: boolean;

    constructor(littleEndian = true, capacity = 256)
    {
        this.littleEndian = littleEndian;
        this.#buffer = Buffer.alloc(capacity);
    }

    get length(): number
    {
        return this.#length;
    }

    take(): Buffer
    {
        return this.#buffer.subarray(0, this.#length);
    }

    #room(extra: number): void
    {
        if (this.#length + extra <= this.#buffer.length) {
            return;
        }

        let capacity = this.#buffer.length * 2;

        while (capacity < this.#length + extra) {
            capacity *= 2;
        }

        const grown = Buffer.alloc(capacity);

        this.#buffer.copy(grown, 0, 0, this.#length);
        this.#buffer = grown;
    }

    /** pad with zero bytes up to the next multiple of `to` */
    align(to: number): void
    {
        const target = align(this.#length, to);

        if (target === this.#length) {
            return;
        }

        this.#room(target - this.#length);
        this.#buffer.fill(0, this.#length, target);
        this.#length = target;
    }

    byte(value: number): void
    {
        this.#room(1);
        this.#buffer.writeUInt8(value & 0xff, this.#length);
        this.#length += 1;
    }

    uint16(value: number): void
    {
        this.#room(2);
        this.littleEndian
            ? this.#buffer.writeUInt16LE(value, this.#length)
            : this.#buffer.writeUInt16BE(value, this.#length);
        this.#length += 2;
    }

    int16(value: number): void
    {
        this.#room(2);
        this.littleEndian
            ? this.#buffer.writeInt16LE(value, this.#length)
            : this.#buffer.writeInt16BE(value, this.#length);
        this.#length += 2;
    }

    uint32(value: number): void
    {
        this.#room(4);
        this.littleEndian
            ? this.#buffer.writeUInt32LE(value, this.#length)
            : this.#buffer.writeUInt32BE(value, this.#length);
        this.#length += 4;
    }

    int32(value: number): void
    {
        this.#room(4);
        this.littleEndian
            ? this.#buffer.writeInt32LE(value, this.#length)
            : this.#buffer.writeInt32BE(value, this.#length);
        this.#length += 4;
    }

    uint64(value: bigint): void
    {
        this.#room(8);
        this.littleEndian
            ? this.#buffer.writeBigUInt64LE(value, this.#length)
            : this.#buffer.writeBigUInt64BE(value, this.#length);
        this.#length += 8;
    }

    int64(value: bigint): void
    {
        this.#room(8);
        this.littleEndian
            ? this.#buffer.writeBigInt64LE(value, this.#length)
            : this.#buffer.writeBigInt64BE(value, this.#length);
        this.#length += 8;
    }

    double(value: number): void
    {
        this.#room(8);
        this.littleEndian
            ? this.#buffer.writeDoubleLE(value, this.#length)
            : this.#buffer.writeDoubleBE(value, this.#length);
        this.#length += 8;
    }

    bytes(value: Buffer): void
    {
        this.#room(value.length);
        value.copy(this.#buffer, this.#length);
        this.#length += value.length;
    }

    /** overwrite a uint32 already written, for an array's back-patched length */
    patchUint32(at: number, value: number): void
    {
        this.littleEndian
            ? this.#buffer.writeUInt32LE(value, at)
            : this.#buffer.writeUInt32BE(value, at);
    }
}


function big(value: DBusValue): bigint
{
    return typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
}


export function writeValue(writer: Writer, type: string, value: DBusValue): void
{
    const code = type[0];

    switch (code) {
        case 'y':
            writer.byte(Number(value));

            return;

        case 'b':
            // a boolean on the wire is a uint32 that must be exactly 0 or 1
            writer.align(4);
            writer.uint32(value === true || value === 1 ? 1 : 0);

            return;

        case 'n':
            writer.align(2);
            writer.int16(Number(value));

            return;

        case 'q':
            writer.align(2);
            writer.uint16(Number(value));

            return;

        case 'i':
            writer.align(4);
            writer.int32(Number(value));

            return;

        case 'u':
        case 'h':
            writer.align(4);
            writer.uint32(Number(value));

            return;

        case 'x':
            writer.align(8);
            writer.int64(big(value));

            return;

        case 't':
            writer.align(8);
            writer.uint64(big(value));

            return;

        case 'd':
            writer.align(8);
            writer.double(Number(value));

            return;

        case 's':
        case 'o': {
            const text = Buffer.from(String(value), 'utf8');

            writer.align(4);
            writer.uint32(text.length);
            writer.bytes(text);
            // every string is NUL-terminated, and the NUL is not in the length
            writer.byte(0);

            return;
        }

        case 'g': {
            const text = Buffer.from(String(value), 'utf8');

            // a signature's length is ONE byte. It is the only length in the
            // format that is not a uint32, and writing four here shifts
            // everything after it by three.
            writer.byte(text.length);
            writer.bytes(text);
            writer.byte(0);

            return;
        }

        case 'a': {
            const element = type.slice(1);
            const items = toArray(element, value);

            writer.align(4);

            const lengthAt = writer.length;

            writer.uint32(0);
            // the padding that aligns the first element comes AFTER the length
            // and is not counted in it
            writer.align(alignmentOf(element));

            const start = writer.length;

            for (const item of items) {
                writeValue(writer, element, item);
            }

            writer.patchUint32(lengthAt, writer.length - start);

            return;
        }

        case '(': {
            const fields = parseSignature(type.slice(1, -1));
            const values = value as DBusValue[];

            writer.align(8);

            fields.forEach((field, i) => writeValue(writer, field, values[i]));

            return;
        }

        case '{': {
            const [keyType, valueType] = parseSignature(type.slice(1, -1));
            const pair = value as DBusValue[];

            writer.align(8);
            writeValue(writer, keyType, pair[0]);
            writeValue(writer, valueType, pair[1]);

            return;
        }

        case 'v': {
            if (!(value instanceof Variant)) {
                throw new Error('dbus: a variant must be marshalled as a Variant, so its signature is stated');
            }

            writeValue(writer, 'g', value.signature);
            writeValue(writer, value.signature, value.value);

            return;
        }

        default:
            throw new Error(`dbus: cannot marshal type ${JSON.stringify(type)}`);
    }
}


/**
 * The items of an array value.
 *
 * A dict-entry element accepts a plain object as well as a list of pairs,
 * because `{ Name: 'x' }` is what a caller naturally writes for `a{sv}` and
 * turning it into pairs here is cheaper than making every caller do it.
 */
function toArray(element: string, value: DBusValue): DBusValue[]
{
    if (Array.isArray(value)) {
        return value;
    }

    if (element.startsWith('{') && value !== null && typeof value === 'object' && !(value instanceof Variant)) {
        return Object.entries(value as Record<string, DBusValue>).map(([key, item]) => [key, item]);
    }

    throw new Error(`dbus: expected an array for ${JSON.stringify(element)}`);
}


export function marshal(signature: string, values: DBusValue[], littleEndian = true): Buffer
{
    const writer = new Writer(littleEndian);
    const types = parseSignature(signature);

    types.forEach((type, i) => writeValue(writer, type, values[i]));

    return Buffer.from(writer.take());
}


export { completeTypeLength, parseSignature };
