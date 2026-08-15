/**
 * Deciding why a unix socket cannot be used, before trying to speak to it.
 *
 * Shared by the docker and D-Bus collectors, and a filesystem check rather than
 * a reading of the connect error on purpose.
 *
 * Node reports connect failures with a real errno - ENOENT, EACCES - and
 * classifying from those is the obvious approach. It does not survive contact
 * with bun, whose net shim collapses every connect failure into one opaque
 * error with no errno at all. A collector that classified from the connect
 * error would give a different, much worse answer depending on which runtime
 * was executing it, and this package is tested under both.
 *
 * stat() and access() behave the same everywhere, and they also draw a
 * distinction the errno never could: a path that exists but is not a socket is
 * a different problem from a daemon that is not listening.
 */
import type { Unavailable } from '../types.js';
export type SocketHints = {
    /** what a missing path means, e.g. "docker is not installed" */
    missing?: string;
    /** what an unreadable path means, e.g. "not in the docker group?" */
    denied?: string;
};
/**
 * Returns null when the path looks usable and the caller should go ahead.
 *
 * The three outcomes stay distinct because they call for different actions, and
 * collapsing them into one "unavailable" throws away the only useful part of
 * the answer.
 */
export declare function checkUnixSocket(path: string, hints?: SocketHints): Unavailable | null;
