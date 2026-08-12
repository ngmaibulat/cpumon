/**
 * Per-interface network counters, from /proc/net/dev.
 *
 * The kernel reports cumulative byte and packet totals since boot, so a rate
 * needs two readings and the elapsed time between them - the same shape as
 * getCpuDiff(), and for the same reason.
 *
 * Unlike getCpuDiff(), diffNetwork() does NOT require the two samples to line
 * up. Interfaces appear and vanish constantly on any machine running
 * containers or a VPN (veth, docker0, wg0), and throwing on a length mismatch
 * would make this collector useless on exactly the hosts it is most wanted on.
 * Interfaces are matched by name; anything without a baseline is skipped until
 * the next window.
 */
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
export type InterfaceCounters = {
    name: string;
    rxBytes: number;
    rxPackets: number;
    rxErrors: number;
    rxDropped: number;
    txBytes: number;
    txPackets: number;
    txErrors: number;
    txDropped: number;
};
export type NetworkCounters = {
    interfaces: InterfaceCounters[];
};
export type InterfaceRate = InterfaceCounters & {
    rxBytesPerSec: number;
    txBytesPerSec: number;
};
export type NetworkRates = {
    interfaces: InterfaceRate[];
    elapsedMs: number;
};
/**
 * Parse the /proc/net/dev table.
 *
 * Two header lines, then one row per interface. The name is separated from its
 * counters by a colon rather than by whitespace, which matters: once a counter
 * passes ten digits the kernel stops padding and the row reads `lo:17952586029`
 * with nothing between them. Splitting on whitespace would take the name and
 * the first counter as a single token.
 */
export declare function parseNetDev(text: string): InterfaceCounters[];
export declare function getNetworkCounters(options?: CollectorOptions): Probe<NetworkCounters>;
/**
 * Derive per-second rates from two counter readings.
 *
 * A negative delta means the counter was reset - `ip link set down/up`, or a
 * 32-bit counter wrapping on an old kernel. Clamping to 0 loses one window's
 * worth of traffic, which is much better than reporting a negative or absurdly
 * large rate.
 */
export declare function diffNetwork(prev: NetworkCounters, next: NetworkCounters, elapsedMs: number): NetworkRates;
