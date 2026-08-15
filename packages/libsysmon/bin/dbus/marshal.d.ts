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
import { completeTypeLength, parseSignature } from './types.js';
import type { DBusValue } from './types.js';
export declare class Writer {
    #private;
    readonly littleEndian: boolean;
    constructor(littleEndian?: boolean, capacity?: number);
    get length(): number;
    take(): Buffer;
    /** pad with zero bytes up to the next multiple of `to` */
    align(to: number): void;
    byte(value: number): void;
    uint16(value: number): void;
    int16(value: number): void;
    uint32(value: number): void;
    int32(value: number): void;
    uint64(value: bigint): void;
    int64(value: bigint): void;
    double(value: number): void;
    bytes(value: Buffer): void;
    /** overwrite a uint32 already written, for an array's back-patched length */
    patchUint32(at: number, value: number): void;
}
export declare function writeValue(writer: Writer, type: string, value: DBusValue): void;
export declare function marshal(signature: string, values: DBusValue[], littleEndian?: boolean): Buffer;
export { completeTypeLength, parseSignature };
