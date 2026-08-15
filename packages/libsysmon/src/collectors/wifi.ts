/**
 * Wifi, from iwd over the system bus, with /proc/net/wireless as a fallback.
 *
 * ## The unit trap
 *
 * iwd reports signal strength in two different units on two calls that a screen
 * shows side by side:
 *
 * - `Station.GetOrderedNetworks()` gives **hundredths of a dBm**: -5600.
 * - `StationDiagnostic.GetDiagnostics()` gives **plain dBm**: -55.
 *
 * Both were captured from this machine at the same moment, for the same
 * network. Rendering the first as dBm produces a reading two orders of
 * magnitude wrong that still looks like a plausible number, so the conversion
 * happens here and no raw value reaches a panel: every field on the types below
 * is already dBm. Bitrates get the same treatment - iwd counts in 100 kbit/s,
 * so 7206 is 720.6 Mbit/s.
 *
 * ## Liveness
 *
 * There is no filesystem probe for iwd. `/run/iwd` does NOT exist on a machine
 * where iwd is running perfectly well - checked here, where it is running and
 * the directory is absent - so probing for it reports "not installed" for a
 * working daemon. The only honest check is whether the bus name answers, which
 * falls out of the call failing.
 *
 * ## Why the fallback exists
 *
 * /proc/net/wireless is a synchronous file read that needs no daemon and no
 * bus, and it works on a wpa_supplicant or NetworkManager machine - which is
 * most of them. It has no SSID, no security and no network list, so it is a
 * degraded mode and never the primary: `source` says which one answered, and
 * the panel shows it. A screen that silently degrades is a screen that lies
 * about what it knows.
 */

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { procRoot, readText } from './proc.js';
import type { CollectorOptions } from './proc.js';
import { DBusClient } from '../dbus/client.js';
import type { DBusValue } from '../dbus/types.js';


export type WifiSource = 'iwd' | 'proc';


export type WifiNetwork = {
    ssid: string;
    /** Network.Type: 'psk' | 'open' | '8021x' | ... */
    security: string;
    connected: boolean;
    /** iwd holds a KnownNetwork object for it, so it has been joined before */
    known: boolean;
    /** dBm, normalised; absent when this network was not in the last scan */
    signalDbm?: number;
};


export type WifiConnection = {
    ssid: string;
    bssid: string;
    frequencyMhz: number;
    channel: number;
    security: string;
    signalDbm: number;
    averageSignalDbm?: number;
    rxMode?: string;
    txMode?: string;
    rxBitrateMbps?: number;
    txBitrateMbps?: number;
    connectedSeconds?: number;
};


export type WifiDevice = {
    name: string;
    address: string;
    powered: boolean;
    /** 'station' | 'ap' */
    mode: string;
    adapterModel?: string;
    /** 'connected' | 'disconnected' | 'scanning' | ... */
    state: string;
    scanning: boolean;
    /**
     * Only set in the degraded /proc mode, where there is no connection object
     * to carry it. Under iwd the signal belongs to the connection, which knows
     * which network it is about.
     */
    signalDbm?: number;
    linkQuality?: number;
};


export type WifiState = {
    source: WifiSource;
    devices: WifiDevice[];
    connection?: WifiConnection;
    networks: WifiNetwork[];
};


export type WifiOptions = CollectorOptions & {
    /** bus address, or a bare socket path */
    address?: string;
    timeoutMs?: number;
};


export const IWD_SERVICE = 'net.connman.iwd';

const IFACE = {
    adapter: 'net.connman.iwd.Adapter',
    device: 'net.connman.iwd.Device',
    station: 'net.connman.iwd.Station',
    diagnostic: 'net.connman.iwd.StationDiagnostic',
    network: 'net.connman.iwd.Network',
    known: 'net.connman.iwd.KnownNetwork',
} as const;


type Objects = Record<string, Record<string, Record<string, DBusValue>>>;


function text(value: DBusValue | undefined): string
{
    return typeof value === 'string' ? value : '';
}


function num(value: DBusValue | undefined): number | undefined
{
    if (typeof value === 'bigint') {
        return Number(value);
    }

    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}


/** hundredths of a dBm to dBm; the conversion this file exists to get right */
export function centiDbm(value: DBusValue | undefined): number | undefined
{
    const raw = num(value);

    return raw === undefined ? undefined : raw / 100;
}


/** iwd counts bitrates in 100 kbit/s, so 7206 is 720.6 Mbit/s */
export function bitrateMbps(value: DBusValue | undefined): number | undefined
{
    const raw = num(value);

    return raw === undefined ? undefined : raw / 10;
}


function isObjects(value: DBusValue): value is Objects
{
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}


/**
 * The managed-object tree, plus the two calls that carry what it does not.
 *
 * Pure and exported so the tests run against a captured reply with no bus. The
 * ordered list and the diagnostics are separate arguments rather than folded
 * in, because they come from separate calls and either can be missing - a
 * station that is scanning has no diagnostics to give.
 */
export function parseManagedObjects(
    objects: DBusValue,
    ordered?: DBusValue,
    diagnostics?: DBusValue,
): WifiState
{
    if (!isObjects(objects)) {
        return { source: 'iwd', devices: [], networks: [] };
    }

    const entries = Object.entries(objects);

    const of = (iface: string): [string, Record<string, DBusValue>][] =>
        entries
            .filter(([, ifaces]) => ifaces[iface] !== undefined)
            .map(([path, ifaces]) => [path, ifaces[iface]]);

    const adapters = new Map(of(IFACE.adapter));
    const stations = new Map(of(IFACE.station));

    const devices: WifiDevice[] = of(IFACE.device).map(([path, props]) => {
        const station = stations.get(path);
        const adapter = adapters.get(text(props.Adapter));
        const model = text(adapter?.Model);

        return {
            name: text(props.Name),
            address: text(props.Address),
            powered: props.Powered === true,
            mode: text(props.Mode),
            ...(model === '' ? {} : { adapterModel: model }),
            // a device with no Station interface is not in station mode; it has
            // no state to report rather than a state of "disconnected"
            state: station === undefined ? 'unknown' : text(station.State),
            scanning: station?.Scanning === true,
        };
    });

    // signal lives on neither Network nor Station: it comes from the ordered
    // list, keyed by object path
    const signals = new Map<string, number>();

    if (Array.isArray(ordered)) {
        for (const entry of ordered) {
            if (!Array.isArray(entry) || entry.length < 2) {
                continue;
            }

            const dbm = centiDbm(entry[1]);

            if (dbm !== undefined) {
                signals.set(text(entry[0]), dbm);
            }
        }
    }

    const knownPaths = new Set(of(IFACE.known).map(([path]) => path));

    const networks: WifiNetwork[] = of(IFACE.network).map(([path, props]) => {
        const signal = signals.get(path);
        const knownPath = text(props.KnownNetwork);

        return {
            ssid: text(props.Name),
            security: text(props.Type),
            connected: props.Connected === true,
            // the property has to point at an object that is actually there: a
            // network iwd has forgotten keeps a stale path for a moment
            known: knownPath !== '' && knownPaths.has(knownPath),
            ...(signal === undefined ? {} : { signalDbm: signal }),
        };
    });

    // strongest first, and a network the scan did not see sinks below the ones
    // it did rather than sorting as if it were silent
    networks.sort((a, b) => (b.signalDbm ?? -Infinity) - (a.signalDbm ?? -Infinity));

    const connectedSsid = networks.find(network => network.connected)?.ssid ?? '';
    const connection = toConnection(diagnostics, connectedSsid);

    return {
        source: 'iwd',
        devices,
        ...(connection === undefined ? {} : { connection }),
        networks,
    };
}


/**
 * GetDiagnostics into a connection.
 *
 * RSSI here is plain dBm and passes through unscaled - the opposite of the
 * ordered list, three lines above. Keeping the two conversions adjacent is
 * deliberate: they are the pair most likely to be made to agree wrongly.
 */
function toConnection(diagnostics: DBusValue | undefined, ssid: string): WifiConnection | undefined
{
    if (diagnostics === null || diagnostics === undefined || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
        return undefined;
    }

    const props = diagnostics as Record<string, DBusValue>;
    const rssi = num(props.RSSI);

    if (rssi === undefined) {
        return undefined;
    }

    const optional = {
        averageSignalDbm: num(props.AverageRSSI),
        rxMode: text(props.RxMode) || undefined,
        txMode: text(props.TxMode) || undefined,
        rxBitrateMbps: bitrateMbps(props.RxBitrate),
        txBitrateMbps: bitrateMbps(props.TxBitrate),
        connectedSeconds: num(props.ConnectedTime),
    };

    return {
        ssid,
        bssid: text(props.ConnectedBss),
        frequencyMhz: num(props.Frequency) ?? 0,
        channel: num(props.Channel) ?? 0,
        security: text(props.Security),
        signalDbm: rssi,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    };
}


/**
 * /proc/net/wireless, the degraded mode.
 *
 * Two header lines, then one row per wifi interface. The quality and level
 * columns carry a trailing '.' - it is part of the kernel's format, not a
 * decimal point, and Number('-55.') happens to parse but Number('-55.-256')
 * would not, so the dot is stripped rather than relied on.
 */
export function parseProcWireless(text_: string): WifiState
{
    const devices: WifiDevice[] = [];

    for (const line of text_.split('\n')) {
        const colon = line.indexOf(':');

        if (colon === -1) {
            continue;
        }

        const name = line.slice(0, colon).trim();

        // the second header line ends in '| 22' and has no interface name; a
        // real row is `wlan0: 0000 55. -55. -256 ...`
        if (name === '' || /\s/.test(name) || name === 'face') {
            continue;
        }

        const columns = line.slice(colon + 1).trim().split(/\s+/).map(item => item.replace(/\.$/, ''));

        const quality = Number(columns[1]);
        const level = Number(columns[2]);

        devices.push({
            name,
            address: '',
            // the interface is listed, so the kernel has it up as a wireless
            // device; nothing here can say more than that
            powered: true,
            mode: '',
            state: 'unknown',
            scanning: false,
            ...(Number.isFinite(level) ? { signalDbm: level } : {}),
            ...(Number.isFinite(quality) ? { linkQuality: quality } : {}),
        });
    }

    return { source: 'proc', devices, networks: [] };
}


/**
 * iwd first, then /proc/net/wireless, then say so.
 *
 * `not-applicable` rather than `not-found` when the file is there and lists no
 * interface: a desktop with no wifi card is not a failure, and
 * `useLayout.isAbsent` already treats that reason as "this screen should not
 * exist on this machine".
 */
export async function getWifi(options: WifiOptions = {}): Promise<Probe<WifiState>>
{
    const viaIwd = await fromIwd(options);

    if (viaIwd !== null) {
        return { available: true, ...viaIwd };
    }

    const result = readText(`${procRoot(options)}/net/wireless`);

    if (!result.ok) {
        return unavailable(result.reason, `iwd is not reachable and ${result.detail ?? 'no /proc/net/wireless'}`);
    }

    const viaProc = parseProcWireless(result.text);

    if (viaProc.devices.length === 0) {
        return unavailable('not-applicable', 'no wireless interface on this machine');
    }

    return { available: true, ...viaProc };
}


/** null when iwd could not be reached, whatever the reason */
async function fromIwd(options: WifiOptions): Promise<WifiState | null>
{
    let client: DBusClient | null = null;

    try {
        client = await DBusClient.connect({ address: options.address, timeoutMs: options.timeoutMs });

        const [objects] = await client.call({
            destination: IWD_SERVICE,
            path: '/',
            iface: 'org.freedesktop.DBus.ObjectManager',
            member: 'GetManagedObjects',
        });

        if (!isObjects(objects)) {
            return null;
        }

        const stationPath = Object.entries(objects)
            .find(([, ifaces]) => ifaces[IFACE.station] !== undefined)?.[0];

        // an adapter in ap mode, or none at all: the tree is still the answer,
        // there is simply no station to ask for a scan
        const ordered = stationPath === undefined
            ? undefined
            : await tryCall(client, stationPath, IFACE.station, 'GetOrderedNetworks');

        const diagnostics = stationPath === undefined
            ? undefined
            : await tryCall(client, stationPath, IFACE.diagnostic, 'GetDiagnostics');

        return parseManagedObjects(objects, ordered, diagnostics);
    }
    catch {
        // no bus, no iwd, or iwd refused: all of them mean "try the file"
        return null;
    }
    finally {
        client?.close();
    }
}


/**
 * A follow-up call whose failure is not fatal.
 *
 * GetDiagnostics fails outright when nothing is connected, and a station that
 * is mid-scan can refuse GetOrderedNetworks. Neither is a reason to lose the
 * device and network list that already arrived.
 */
async function tryCall(
    client: DBusClient,
    path: string,
    iface: string,
    member: string,
): Promise<DBusValue | undefined>
{
    try {
        const [value] = await client.call({ destination: IWD_SERVICE, path, iface, member });

        return value;
    }
    catch {
        return undefined;
    }
}
