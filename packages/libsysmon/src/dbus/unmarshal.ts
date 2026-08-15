/**
 * Bytes to values.
 *
 * The mirror of marshal.ts, and pure for the same reason. The reader carries an
 * absolute offset because alignment is measured from the start of the message,
 * so a value's padding depends on everything that came before it and not on the
 * value itself.
 *
 * A variant unmarshals to its inner value, not to a wrapper. Marshalling one
 * needs its signature stated and reading one does not, so the asymmetry is real
 * and deliberate: consumers get `{ Name: 'wlan0' }` rather than a tree of
 * type-tagged boxes they would immediately unwrap.
 */

import { align, alignmentOf, parseSignature } from './types.js';
import type { DBusValue } from './types.js';


export class Reader
{
    readonly buffer: Buffer;
    readonly littleEndian: boolean;

    offset: number;

    constructor(buffer: Buffer, offset = 0, littleEndian = true)
    {
        this.buffer = buffer;
        this.offset = offset;
        this.littleEndian = littleEndian;
    }

    #need(bytes: number): void
    {
        if (this.offset + bytes > this.buffer.length) {
            throw new Error(`dbus: message ended early, wanted ${bytes} bytes at ${this.offset}`);
        }
    }

    align(to: number): void
    {
        const target = align(this.offset, to);

        if (target > this.buffer.length) {
            throw new Error(`dbus: padding ran past the end at ${this.offset}`);
        }

        this.offset = target;
    }

    byte(): number
    {
        this.#need(1);

        return this.buffer.readUInt8(this.offset++);
    }

    uint16(): number
    {
        this.#need(2);
        const value = this.littleEndian
            ? this.buffer.readUInt16LE(this.offset)
            : this.buffer.readUInt16BE(this.offset);
        this.offset += 2;

        return value;
    }

    int16(): number
    {
        this.#need(2);
        const value = this.littleEndian
            ? this.buffer.readInt16LE(this.offset)
            : this.buffer.readInt16BE(this.offset);
        this.offset += 2;

        return value;
    }

    uint32(): number
    {
        this.#need(4);
        const value = this.littleEndian
            ? this.buffer.readUInt32LE(this.offset)
            : this.buffer.readUInt32BE(this.offset);
        this.offset += 4;

        return value;
    }

    int32(): number
    {
        this.#need(4);
        const value = this.littleEndian
            ? this.buffer.readInt32LE(this.offset)
            : this.buffer.readInt32BE(this.offset);
        this.offset += 4;

        return value;
    }

    uint64(): bigint
    {
        this.#need(8);
        const value = this.littleEndian
            ? this.buffer.readBigUInt64LE(this.offset)
            : this.buffer.readBigUInt64BE(this.offset);
        this.offset += 8;

        return value;
    }

    int64(): bigint
    {
        this.#need(8);
        const value = this.littleEndian
            ? this.buffer.readBigInt64LE(this.offset)
            : this.buffer.readBigInt64BE(this.offset);
        this.offset += 8;

        return value;
    }

    double(): number
    {
        this.#need(8);
        const value = this.littleEndian
            ? this.buffer.readDoubleLE(this.offset)
            : this.buffer.readDoubleBE(this.offset);
        this.offset += 8;

        return value;
    }

    text(length: number): string
    {
        this.#need(length + 1);
        const value = this.buffer.toString('utf8', this.offset, this.offset + length);

        // step over the trailing NUL, which is present but not in the length
        this.offset += length + 1;

        return value;
    }
}


export function readValue(reader: Reader, type: string): DBusValue
{
    const code = type[0];

    switch (code) {
        case 'y':
            return reader.byte();

        case 'b':
            reader.align(4);

            return reader.uint32() !== 0;

        case 'n':
            reader.align(2);

            return reader.int16();

        case 'q':
            reader.align(2);

            return reader.uint16();

        case 'i':
            reader.align(4);

            return reader.int32();

        case 'u':
        case 'h':
            reader.align(4);

            return reader.uint32();

        case 'x':
            reader.align(8);

            return reader.int64();

        case 't':
            reader.align(8);

            return reader.uint64();

        case 'd':
            reader.align(8);

            return reader.double();

        case 's':
        case 'o':
            reader.align(4);

            return reader.text(reader.uint32());

        case 'g':
            // one byte of length, not four
            return reader.text(reader.byte());

        case 'a': {
            const element = type.slice(1);

            reader.align(4);

            // a byte count, not an element count, and it excludes the padding
            // that aligns the first element - so the only correct way to stop is
            // by offset
            const bytes = reader.uint32();

            reader.align(alignmentOf(element));

            const end = reader.offset + bytes;
            const items: DBusValue[] = [];

            while (reader.offset < end) {
                items.push(readValue(reader, element));
            }

            if (reader.offset !== end) {
                throw new Error(`dbus: array of ${JSON.stringify(element)} overran its length by ${reader.offset - end}`);
            }

            // an array of dict entries is what a caller wants as an object
            if (element.startsWith('{')) {
                const record: Record<string, DBusValue> = {};

                for (const item of items) {
                    const [key, value] = item as DBusValue[];

                    record[String(key)] = value;
                }

                return record;
            }

            return items;
        }

        case '(': {
            reader.align(8);

            return parseSignature(type.slice(1, -1)).map(field => readValue(reader, field));
        }

        case '{': {
            reader.align(8);

            const [keyType, valueType] = parseSignature(type.slice(1, -1));

            return [readValue(reader, keyType), readValue(reader, valueType)];
        }

        case 'v':
            return readValue(reader, readValue(reader, 'g') as string);

        default:
            throw new Error(`dbus: cannot unmarshal type ${JSON.stringify(type)}`);
    }
}


export function unmarshal(
    signature: string,
    buffer: Buffer,
    offset = 0,
    littleEndian = true,
): { value: DBusValue[]; offset: number }
{
    const reader = new Reader(buffer, offset, littleEndian);
    const value = parseSignature(signature).map(type => readValue(reader, type));

    return { value, offset: reader.offset };
}
