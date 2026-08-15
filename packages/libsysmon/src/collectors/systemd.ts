/**
 * systemd units, over the system bus.
 *
 * One method call: `ListUnits` on `org.freedesktop.systemd1.Manager`, signature
 * `a(ssssssouso)`. No arguments, and no privilege needed - the polkit rules on
 * systemd cover *starting* and *stopping* units, and this screen does neither.
 *
 * `ListUnits` returns LOADED units only. `ListUnitFiles` would add the ones
 * installed but not loaded, which is a second call answering a different
 * question; mixing the two silently would make the count mean nothing. The
 * screen says "loaded units" and means it.
 */

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { IS_LINUX } from './proc.js';
import { checkUnixSocket } from './socket.js';
import { systemBusAddress } from '../dbus/address.js';
import { DBusClient, DBusError } from '../dbus/client.js';
import type { DBusValue } from '../dbus/types.js';


export type UnitActiveState =
    | 'active' | 'reloading' | 'inactive' | 'failed' | 'activating' | 'deactivating';


export type SystemdUnit = {
    name: string;
    description: string;
    /** loaded, not-found, masked, error */
    loadState: string;
    activeState: UnitActiveState | string;
    subState: string;
    /** the suffix: service, socket, timer, mount, scope, slice, ... */
    type: string;
    /** present only while a job is queued against the unit */
    jobType?: string;
};


export type SystemdOptions = {
    address?: string;
    timeoutMs?: number;
};


export const SYSTEMD_SERVICE = 'org.freedesktop.systemd1';
export const SYSTEMD_PATH = '/org/freedesktop/systemd1';
export const SYSTEMD_MANAGER = 'org.freedesktop.systemd1.Manager';


/**
 * The suffix after the last dot.
 *
 * Not `split('.')[1]`: unit names are full of dots. A real one from this
 * machine is `dev-disk-by\x2did-nvme\x2deui.e8238fa6…\x2dpart1.device`, where
 * the hex escapes leave the name with several, and the type is only ever the
 * last.
 */
export function unitType(name: string): string
{
    const at = name.lastIndexOf('.');

    return at === -1 ? '' : name.slice(at + 1);
}


/**
 * The unmarshalled `a(ssssssouso)` in, rows out.
 *
 * Pure and exported, so the tests cover it with hand-written rows on a machine
 * with no bus - the same bargain every parseX() in this package makes.
 *
 * A row that is not ten fields is skipped rather than half-read. systemd has
 * returned ten since the interface existed, and a row of some other arity means
 * this is not the reply it was taken for.
 */
export function parseListUnits(rows: DBusValue[]): SystemdUnit[]
{
    const units: SystemdUnit[] = [];

    for (const entry of rows) {
        if (!Array.isArray(entry) || entry.length < 10) {
            continue;
        }

        const name = String(entry[0]);

        if (name === '') {
            continue;
        }

        const jobType = String(entry[8]);

        units.push({
            name,
            description: String(entry[1]),
            loadState: String(entry[2]),
            activeState: String(entry[3]),
            subState: String(entry[4]),
            type: unitType(name),
            ...(jobType === '' ? {} : { jobType }),
        });
    }

    return units;
}


/**
 * Ask the manager for its loaded units.
 *
 * A connection per call rather than a held one. The poller in `etop` holds
 * nothing itself, and the alternative - a cached client living across polls -
 * needs invalidation on every way a socket can die, which is a state machine
 * this does not otherwise need. Measured against the real bus: connect,
 * authenticate, Hello and ListUnits together cost about 15 ms for 475 units,
 * which at one poll every three seconds is not worth a cache.
 */
export async function getSystemdUnits(options: SystemdOptions = {}): Promise<Probe<{ units: SystemdUnit[] }>>
{
    if (!IS_LINUX) {
        return unavailable('unsupported-platform', 'systemd is Linux-only');
    }

    const address = systemBusAddress(options.address);

    if (address === null) {
        return unavailable('not-found', 'no unix system bus address');
    }

    // classified from the filesystem rather than from the connect error, for
    // the reason collectors/socket.ts documents. An abstract socket has no
    // filesystem entry to check, so it goes straight to the connect.
    if (address.kind === 'path') {
        const unusable = checkUnixSocket(address.path, {
            missing: 'no system bus socket; does this machine run systemd?',
            denied: 'the system bus refused a connection',
        });

        if (unusable !== null) {
            return unusable;
        }
    }

    let client: DBusClient | null = null;

    try {
        client = await DBusClient.connect({ address: options.address, timeoutMs: options.timeoutMs });

        const reply = await client.call({
            destination: SYSTEMD_SERVICE,
            path: SYSTEMD_PATH,
            iface: SYSTEMD_MANAGER,
            member: 'ListUnits',
        });

        const rows = reply[0];

        if (!Array.isArray(rows)) {
            return unavailable('parse-error', 'ListUnits did not return an array');
        }

        return { available: true, units: parseListUnits(rows) };
    }
    catch (err) {
        return failure(err);
    }
    finally {
        client?.close();
    }
}


/**
 * Why the call did not happen.
 *
 * The three cases stay distinct because they call for different actions: no bus
 * at all means this machine does not run systemd, a rejected handshake means
 * the socket is there and will not have us, and an error reply means the bus
 * answered and said no - which is a different thing again, and worth showing
 * with the name systemd chose.
 */
function failure(err: unknown): Probe<{ units: SystemdUnit[] }>
{
    if (err instanceof DBusError) {
        return unavailable('parse-error', err.message);
    }

    const message = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'ENOTSOCK' || /no unix bus address/.test(message)) {
        return unavailable('not-found', `no system bus: ${message}`);
    }

    if (code === 'EACCES' || code === 'EPERM' || /authentication rejected/.test(message)) {
        return unavailable('permission-denied', message);
    }

    return unavailable('parse-error', message);
}
