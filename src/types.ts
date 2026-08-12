/**
 * Shared vocabulary for collectors that cannot succeed everywhere.
 *
 * Most of what a system monitor wants to read is platform-specific: /proc and
 * /sys exist only on Linux, statfs needs a recent Node, and a container can
 * deny a read that works fine on the host. Rather than throwing - which forces
 * every caller into a try/catch and makes one missing file fatal to a whole
 * snapshot - collectors return a Probe and let the caller decide.
 */


export type UnavailableReason =
    | 'unsupported-platform'
    | 'permission-denied'
    | 'not-found'
    | 'parse-error'
    | 'not-applicable';


export type Unavailable = {
    available: false;
    reason: UnavailableReason;
    detail?: string;
};


/**
 * The success branch is flattened into the object rather than nested under a
 * `value` key, so JSON output and CLI templates can address fields directly
 * (`mem.usedRatio`, not `mem.value.usedRatio`), and `available` doubles as the
 * discriminant.
 *
 * The flattening has two consequences worth knowing before you reach for it.
 *
 * `Probe<T>` cannot wrap an array. `Probe<Foo[]>` type-checks - it resolves to
 * `{ available: true } & Foo[]` - but JSON.stringify() of an array drops every
 * non-index property, so `available` vanishes in exactly the place a --json
 * consumer needs it.
 *
 * Nor can it wrap a payload that has an `available` field of its own: the
 * spread overwrites the discriminant with the payload's value. MemoryInfo is
 * the live example, carrying the kernel's MemAvailable under that name.
 *
 * In both cases wrap the payload in a named key instead - `Probe<{ processes:
 * Foo[] }>`, `Probe<{ memory: MemoryInfo }>`.
 *
 * In practice wrapping won every time: memory and disk both name a field
 * `available`, and the network, process and container collectors all return
 * lists. Treat the wrapped form as the default and flattening as the exception
 * to argue for, which is the reverse of how this comment originally read.
 */
export type Probe<T> = ({ available: true } & T) | Unavailable;


export function unavailable(reason: UnavailableReason, detail?: string): Unavailable
{
    return detail === undefined
        ? { available: false, reason }
        : { available: false, reason, detail };
}


export function isAvailable<T>(probe: Probe<T>): probe is { available: true } & T
{
    return probe.available;
}
