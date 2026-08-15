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
import type { DBusValue } from './types.js';
export declare class Reader {
    #private;
    readonly buffer: Buffer;
    readonly littleEndian: boolean;
    offset: number;
    constructor(buffer: Buffer, offset?: number, littleEndian?: boolean);
    align(to: number): void;
    byte(): number;
    uint16(): number;
    int16(): number;
    uint32(): number;
    int32(): number;
    uint64(): bigint;
    int64(): bigint;
    double(): number;
    text(length: number): string;
}
export declare function readValue(reader: Reader, type: string): DBusValue;
export declare function unmarshal(signature: string, buffer: Buffer, offset?: number, littleEndian?: boolean): {
    value: DBusValue[];
    offset: number;
};
