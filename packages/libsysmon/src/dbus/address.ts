/**
 * Where the system bus lives.
 *
 * DBUS_SYSTEM_BUS_ADDRESS overrides, and is usually unset - confirmed on this
 * machine, where the socket sits at the default path and the variable is not
 * there at all. So the default is the case that matters and the variable is the
 * exception, which is the reverse of how bus-address handling is usually
 * written.
 *
 * The address format is a semicolon-separated list of transports, each
 * `transport:key=value,key=value`. Only the unix transport is understood here:
 * tcp buses exist but a system monitor reading the local machine has no business
 * on one, and pretending to support it would mean pretending to support its
 * authentication too.
 */

export const DEFAULT_SYSTEM_BUS = '/run/dbus/system_bus_socket';


export type BusAddress =
    | { kind: 'path'; path: string }
    /** Linux's abstract namespace: a socket with no filesystem entry */
    | { kind: 'abstract'; path: string };


/**
 * Unescape a value from an address.
 *
 * Percent-encoding, as the spec defines it - a path containing a comma or a
 * semicolon would otherwise end the field early.
 */
function unescape(text: string): string
{
    return text.replace(/%([0-9a-fA-F]{2})/g, (_all, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)));
}


/**
 * Pick the first unix transport out of an address list.
 *
 * Returns null when nothing in the list is a unix socket this can open, so the
 * caller reports "no bus" rather than throwing at connect time.
 */
export function parseBusAddress(address: string): BusAddress | null
{
    for (const entry of address.split(';')) {
        const at = entry.indexOf(':');

        if (at === -1 || entry.slice(0, at).trim() !== 'unix') {
            continue;
        }

        const keys = new Map<string, string>();

        for (const pair of entry.slice(at + 1).split(',')) {
            const eq = pair.indexOf('=');

            if (eq !== -1) {
                keys.set(pair.slice(0, eq).trim(), unescape(pair.slice(eq + 1)));
            }
        }

        const path = keys.get('path');

        if (path !== undefined && path !== '') {
            return { kind: 'path', path };
        }

        const abstract = keys.get('abstract');

        if (abstract !== undefined && abstract !== '') {
            return { kind: 'abstract', path: abstract };
        }
    }

    return null;
}


/**
 * The address to use, given an explicit override and the environment.
 *
 * The explicit option wins so tests can point at a socket of their own, then
 * the environment, then the default path.
 */
export function systemBusAddress(override?: string, env: NodeJS.ProcessEnv = process.env): BusAddress | null
{
    if (override !== undefined && override !== '') {
        // a bare path is accepted as well as a full address: it is what a test
        // has in hand, and there is no ambiguity - an address always has a colon
        return override.includes(':') ? parseBusAddress(override) : { kind: 'path', path: override };
    }

    const fromEnv = env.DBUS_SYSTEM_BUS_ADDRESS;

    if (fromEnv !== undefined && fromEnv !== '') {
        return parseBusAddress(fromEnv);
    }

    return { kind: 'path', path: DEFAULT_SYSTEM_BUS };
}


/**
 * What node's net.connect wants.
 *
 * An abstract socket is addressed by a path beginning with a NUL byte, which is
 * how Linux distinguishes the abstract namespace from the filesystem.
 */
export function connectPath(address: BusAddress): string
{
    return address.kind === 'abstract' ? `\0${address.path}` : address.path;
}
