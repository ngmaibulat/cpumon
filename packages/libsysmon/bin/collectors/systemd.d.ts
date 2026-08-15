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
import type { Probe } from '../types.js';
import type { DBusValue } from '../dbus/types.js';
export type UnitActiveState = 'active' | 'reloading' | 'inactive' | 'failed' | 'activating' | 'deactivating';
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
export declare const SYSTEMD_SERVICE = "org.freedesktop.systemd1";
export declare const SYSTEMD_PATH = "/org/freedesktop/systemd1";
export declare const SYSTEMD_MANAGER = "org.freedesktop.systemd1.Manager";
/**
 * The suffix after the last dot.
 *
 * Not `split('.')[1]`: unit names are full of dots. A real one from this
 * machine is `dev-disk-by\x2did-nvme\x2deui.e8238fa6…\x2dpart1.device`, where
 * the hex escapes leave the name with several, and the type is only ever the
 * last.
 */
export declare function unitType(name: string): string;
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
export declare function parseListUnits(rows: DBusValue[]): SystemdUnit[];
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
export declare function getSystemdUnits(options?: SystemdOptions): Promise<Probe<{
    units: SystemdUnit[];
}>>;
