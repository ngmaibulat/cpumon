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
export declare const DEFAULT_SYSTEM_BUS = "/run/dbus/system_bus_socket";
export type BusAddress = {
    kind: 'path';
    path: string;
}
/** Linux's abstract namespace: a socket with no filesystem entry */
 | {
    kind: 'abstract';
    path: string;
};
/**
 * Pick the first unix transport out of an address list.
 *
 * Returns null when nothing in the list is a unix socket this can open, so the
 * caller reports "no bus" rather than throwing at connect time.
 */
export declare function parseBusAddress(address: string): BusAddress | null;
/**
 * The address to use, given an explicit override and the environment.
 *
 * The explicit option wins so tests can point at a socket of their own, then
 * the environment, then the default path.
 */
export declare function systemBusAddress(override?: string, env?: NodeJS.ProcessEnv): BusAddress | null;
/**
 * What node's net.connect wants.
 *
 * An abstract socket is addressed by a path beginning with a NUL byte, which is
 * how Linux distinguishes the abstract namespace from the filesystem.
 */
export declare function connectPath(address: BusAddress): string;
