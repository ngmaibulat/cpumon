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

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { procRoot, readText } from './proc.js';
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
export function parseNetDev(text: string): InterfaceCounters[]
{
    const interfaces: InterfaceCounters[] = [];

    for (const line of text.split('\n')) {
        const colon = line.indexOf(':');

        if (colon === -1) {
            continue;
        }

        const name = line.slice(0, colon).trim();
        const columns = line.slice(colon + 1).trim().split(/\s+/).map(Number);

        // 8 receive columns then 8 transmit ones; anything shorter is a header
        // or a truncated read rather than an interface
        if (name === '' || columns.length < 16 || columns.some(Number.isNaN)) {
            continue;
        }

        interfaces.push({
            name,
            rxBytes: columns[0],
            rxPackets: columns[1],
            rxErrors: columns[2],
            rxDropped: columns[3],
            txBytes: columns[8],
            txPackets: columns[9],
            txErrors: columns[10],
            txDropped: columns[11],
        });
    }

    return interfaces;
}


export function getNetworkCounters(options?: CollectorOptions): Probe<NetworkCounters>
{
    const result = readText(`${procRoot(options)}/net/dev`);

    if (!result.ok) {
        return unavailable(result.reason, result.detail);
    }

    const interfaces = parseNetDev(result.text);

    if (interfaces.length === 0) {
        return unavailable('parse-error', 'net/dev listed no interfaces');
    }

    return { available: true, interfaces };
}


/**
 * Derive per-second rates from two counter readings.
 *
 * A negative delta means the counter was reset - `ip link set down/up`, or a
 * 32-bit counter wrapping on an old kernel. Clamping to 0 loses one window's
 * worth of traffic, which is much better than reporting a negative or absurdly
 * large rate.
 */
export function diffNetwork(prev: NetworkCounters, next: NetworkCounters, elapsedMs: number): NetworkRates
{
    const baseline = new Map(prev.interfaces.map(item => [item.name, item]));
    const seconds = elapsedMs / 1000;

    const interfaces: InterfaceRate[] = [];

    for (const current of next.interfaces) {
        const before = baseline.get(current.name);

        // an interface that appeared during this window has no baseline to
        // measure against; it gets a rate on the next one
        if (before === undefined) {
            continue;
        }

        const perSecond = (now: number, then: number) => {
            const delta = Math.max(0, now - then);
            return seconds > 0 ? delta / seconds : 0;
        };

        interfaces.push({
            ...current,
            rxBytesPerSec: perSecond(current.rxBytes, before.rxBytes),
            txBytesPerSec: perSecond(current.txBytes, before.txBytes),
        });
    }

    return { interfaces, elapsedMs };
}
