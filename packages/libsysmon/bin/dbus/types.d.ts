/**
 * The D-Bus type system, reduced to the two things a marshaller needs:
 * how to split a signature into complete types, and what each one aligns to.
 *
 * Alignment is the whole format. Every value is padded to its alignment
 * *measured from the start of the message*, not from the start of its own
 * field - which is why the reader and the writer both have to carry an absolute
 * offset rather than a local one. Getting this wrong produces a buffer that is
 * the right length and decodes to plausible nonsense.
 */
/** a variant carries its own signature, so marshalling one needs it stated */
export declare class Variant {
    readonly signature: string;
    readonly value: DBusValue;
    constructor(signature: string, value: DBusValue);
}
export type DBusValue = number | bigint | string | boolean | Variant | DBusValue[] | {
    [key: string]: DBusValue;
};
export declare const ALIGNMENT: Record<string, number>;
export declare function alignmentOf(type: string): number;
/** round an offset up to the next multiple of `to` */
export declare function align(offset: number, to: number): number;
/**
 * The length of the complete type starting at `at`.
 *
 * `a` takes its element type with it, and brackets nest - `aa{sv}` is one
 * complete type seven characters long, and a splitter that did not count
 * brackets would read it as four.
 */
export declare function completeTypeLength(signature: string, at?: number): number;
/** split a signature into its top-level complete types */
export declare function parseSignature(signature: string): string[];
