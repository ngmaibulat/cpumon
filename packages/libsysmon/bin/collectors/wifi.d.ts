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
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
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
export declare const IWD_SERVICE = "net.connman.iwd";
/** hundredths of a dBm to dBm; the conversion this file exists to get right */
export declare function centiDbm(value: DBusValue | undefined): number | undefined;
/** iwd counts bitrates in 100 kbit/s, so 7206 is 720.6 Mbit/s */
export declare function bitrateMbps(value: DBusValue | undefined): number | undefined;
/**
 * The managed-object tree, plus the two calls that carry what it does not.
 *
 * Pure and exported so the tests run against a captured reply with no bus. The
 * ordered list and the diagnostics are separate arguments rather than folded
 * in, because they come from separate calls and either can be missing - a
 * station that is scanning has no diagnostics to give.
 */
export declare function parseManagedObjects(objects: DBusValue, ordered?: DBusValue, diagnostics?: DBusValue): WifiState;
/**
 * /proc/net/wireless, the degraded mode.
 *
 * Two header lines, then one row per wifi interface. The quality and level
 * columns carry a trailing '.' - it is part of the kernel's format, not a
 * decimal point, and Number('-55.') happens to parse but Number('-55.-256')
 * would not, so the dot is stripped rather than relied on.
 */
export declare function parseProcWireless(text_: string): WifiState;
/**
 * iwd first, then /proc/net/wireless, then say so.
 *
 * `not-applicable` rather than `not-found` when the file is there and lists no
 * interface: a desktop with no wifi card is not a failure, and
 * `useLayout.isAbsent` already treats that reason as "this screen should not
 * exist on this machine".
 */
export declare function getWifi(options?: WifiOptions): Promise<Probe<WifiState>>;
