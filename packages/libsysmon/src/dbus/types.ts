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
export class Variant
{
    constructor(readonly signature: string, readonly value: DBusValue) {}
}


export type DBusValue =
    | number
    | bigint
    | string
    | boolean
    | Variant
    | DBusValue[]
    | { [key: string]: DBusValue };


export const ALIGNMENT: Record<string, number> = {
    y: 1,
    b: 4,
    n: 2,
    q: 2,
    i: 4,
    u: 4,
    x: 8,
    t: 8,
    d: 8,
    s: 4,
    o: 4,
    // the one length in the format that is a single byte rather than a uint32
    g: 1,
    a: 4,
    v: 1,
    h: 4,
    '(': 8,
    '{': 8,
};


export function alignmentOf(type: string): number
{
    return ALIGNMENT[type[0]] ?? 1;
}


/** round an offset up to the next multiple of `to` */
export function align(offset: number, to: number): number
{
    const over = offset % to;

    return over === 0 ? offset : offset + (to - over);
}


/**
 * The length of the complete type starting at `at`.
 *
 * `a` takes its element type with it, and brackets nest - `aa{sv}` is one
 * complete type seven characters long, and a splitter that did not count
 * brackets would read it as four.
 */
export function completeTypeLength(signature: string, at = 0): number
{
    const code = signature[at];

    if (code === undefined) {
        throw new Error(`dbus: signature ended early in ${JSON.stringify(signature)}`);
    }

    if (code === 'a') {
        return 1 + completeTypeLength(signature, at + 1);
    }

    if (code === '(' || code === '{') {
        const close = code === '(' ? ')' : '}';
        let depth = 0;

        for (let i = at; i < signature.length; i++) {
            const ch = signature[i];

            if (ch === '(' || ch === '{') {
                depth++;
            }
            else if (ch === ')' || ch === '}') {
                depth--;

                if (depth === 0) {
                    if (ch !== close) {
                        throw new Error(`dbus: mismatched brackets in ${JSON.stringify(signature)}`);
                    }

                    return i - at + 1;
                }
            }
        }

        throw new Error(`dbus: unclosed ${code} in ${JSON.stringify(signature)}`);
    }

    if (ALIGNMENT[code] === undefined) {
        throw new Error(`dbus: unknown type code ${JSON.stringify(code)} in ${JSON.stringify(signature)}`);
    }

    return 1;
}


/** split a signature into its top-level complete types */
export function parseSignature(signature: string): string[]
{
    const types: string[] = [];

    let at = 0;

    while (at < signature.length) {
        const length = completeTypeLength(signature, at);

        types.push(signature.slice(at, at + length));
        at += length;
    }

    return types;
}
