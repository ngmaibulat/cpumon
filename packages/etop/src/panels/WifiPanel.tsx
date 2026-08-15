/**
 * Wifi: the connected network at the top, the scan list below it.
 *
 * Not a bare table, because the two things are not the same question. "What am
 * I on and how good is it" is one line and a gauge; "what else is there" is a
 * list. Giving the connection the top of the screen is the whole layout
 * decision.
 *
 * ## The gauge is absolute, not relative
 *
 * dBm maps to a ratio over a fixed range - -30 excellent, -90 unusable - rather
 * than being normalised against the strongest network in the list. A relative
 * scale would draw the best of three terrible signals as a full bar, which is
 * the opposite of what a signal meter is for.
 *
 * ## The source is always shown
 *
 * When iwd cannot be reached the collector falls back to /proc/net/wireless,
 * which has an interface and a signal level and nothing else - no SSID, no
 * security, no scan. The header says `proc` in that case and the panel says
 * plainly what is missing. A screen that silently degrades is a screen that
 * lies about what it knows.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import { isAvailable } from 'libsysmon';
import { duration } from 'libsysmon/format';
import type { WifiConnection, WifiNetwork, WifiState } from 'libsysmon';

import { Gauge } from '../ui/Gauge.js';
import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Table } from '../ui/Table.js';
import { Unavailable } from '../ui/Unavailable.js';
import { useSlowState } from '../hooks/useSlow.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Column } from '../render/columns.js';
import type { Glyphs } from '../hooks/useTheme.js';
import type { Ramp } from '../theme/index.js';


export type WifiPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
};


/** the range a signal meter is worth drawing over */
export const BEST_DBM = -30;
export const WORST_DBM = -90;


const COLUMNS: Column[] = [
    { key: 'ssid', header: 'NETWORK', align: 'left', min: 12, flex: true, priority: 100 },
    { key: 'security', header: 'SEC', align: 'left', min: 5, priority: 60 },
    { key: 'signal', header: 'SIGNAL', align: 'right', min: 8, priority: 90 },
    { key: 'note', header: '', align: 'left', min: 9, priority: 70 },
];


/**
 * dBm to a 0..1 ratio over a fixed range.
 *
 * Clamped at both ends: a signal better than -30 is not more than full, and one
 * worse than -90 is not negative.
 */
export function signalRatio(dbm: number): number
{
    return Math.max(0, Math.min(1, (dbm - WORST_DBM) / (BEST_DBM - WORST_DBM)));
}


/**
 * A ramp where strong is good.
 *
 * Every other ramp in the theme runs low-is-fine to high-is-alarming, because
 * they measure usage. Signal is the other way round, so this reverses one
 * rather than adding a theme field that would have to be defined four times.
 */
export function signalRamp(ramp: Ramp): Ramp
{
    return [ramp[3], ramp[2], ramp[1], ramp[0]] as unknown as Ramp;
}


export function toRow(network: WifiNetwork, glyphs: Glyphs): string[]
{
    return [
        network.ssid,
        network.security,
        // a network the last scan did not see has no strength to report, and a
        // dash says that where a 0 would claim something false
        network.signalDbm === undefined ? '-' : `${Math.round(network.signalDbm)} dBm`,
        network.connected ? `${glyphs.check} connected` : network.known ? 'known' : '',
    ];
}


/**
 * The line under the gauge, dropping fields right to left as it narrows.
 *
 * Same shape as Header: everything is optional, the leftmost items are the ones
 * worth keeping, and the line is built to fit rather than truncated - a
 * half-written "802.11a" is worse than no mode at all.
 */
export function detailLine(connection: WifiConnection, width: number, separator: string): string
{
    const parts: string[] = [];

    if (connection.channel > 0) {
        parts.push(`ch ${connection.channel}`);
    }

    if (connection.frequencyMhz > 0) {
        parts.push(`${connection.frequencyMhz} MHz`);
    }

    if (connection.rxMode !== undefined) {
        parts.push(connection.rxMode);
    }

    if (connection.rxBitrateMbps !== undefined && connection.txBitrateMbps !== undefined) {
        parts.push(`rx ${connection.rxBitrateMbps} / tx ${connection.txBitrateMbps} Mbit/s`);
    }

    if (connection.connectedSeconds !== undefined) {
        parts.push(`up ${duration(connection.connectedSeconds * 1000)}`);
    }

    const glue = ` ${separator} `;

    let line = '';

    for (const part of parts) {
        const next = line === '' ? part : `${line}${glue}${part}`;

        if (next.length > width) {
            break;
        }

        line = next;
    }

    return line;
}


export const WifiPanel = memo(function WifiPanel({ width, height, focused = false }: WifiPanelProps)
{
    const { wifi: probe, ticks } = useSlowState();
    const { theme, glyphs } = useStyle();

    const state: WifiState | undefined = probe !== undefined && isAvailable(probe) ? probe : undefined;
    const device = state?.devices[0];

    return (
        <Panel
            title="WIFI"
            subtitle={state === undefined ? undefined : subtitle(state, glyphs.separator)}
            width={width}
            height={height}
            focused={focused}
        >
            {({ width: inner, height: innerHeight }) => {
                if (probe === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(probe)) {
                    return <Unavailable reason={probe.reason} detail={probe.detail} width={inner} height={innerHeight} />;
                }

                if (device === undefined) {
                    return ticks < 1
                        ? <Loading width={inner} height={innerHeight} />
                        : <Text color={theme.muted} wrap="truncate-end">no wireless interface</Text>;
                }

                const ramp = signalRamp(theme.network);
                const connection = probe.connection;

                // the degraded source has a level and nothing to attach it to,
                // so the device's own signal is the only thing to draw
                const dbm = connection?.signalDbm ?? device.signalDbm;

                return (
                    <Box flexDirection="column" width={inner} height={innerHeight} overflow="hidden">
                        {dbm === undefined ? null : (
                            <Gauge
                                label={connection?.ssid !== undefined && connection.ssid !== '' ? connection.ssid : device.name}
                                ratio={signalRatio(dbm)}
                                width={inner}
                                ramp={ramp}
                                value={`${Math.round(dbm)} dBm`}
                                valueWidth={8}
                            />
                        )}
                        {connection === undefined ? (
                            <Text color={theme.muted} wrap="truncate-end">
                                {probe.source === 'proc'
                                    ? 'signal only: iwd is not reachable, so there is no ssid, security or scan'
                                    : `${device.state}${device.scanning ? ', scanning' : ''}`}
                            </Text>
                        ) : (
                            <Text color={theme.muted} wrap="truncate-end">
                                {detailLine(connection, inner, glyphs.separator)}
                            </Text>
                        )}
                        {probe.networks.length === 0 ? null : (
                            <Box marginTop={1} flexDirection="column" width={inner} overflow="hidden">
                                <Table
                                    columns={COLUMNS}
                                    rows={probe.networks.map(network => toRow(network, glyphs))}
                                    width={inner}
                                    // the gauge, the detail line and the blank
                                    // row above have already taken three
                                    height={Math.max(1, innerHeight - 3)}
                                    rowColor={index => rowColor(probe.networks[index], theme, ramp)}
                                />
                            </Box>
                        )}
                    </Box>
                );
            }}
        </Panel>
    );
});


/**
 * The header line.
 *
 * The source is named whenever it is not iwd, because `proc` means most of this
 * screen is missing and the reader has to know that without inferring it from
 * an empty list.
 */
function subtitle(state: WifiState, separator: string): string
{
    const device = state.devices[0];
    const name = device === undefined ? 'no interface' : device.name;

    return state.source === 'iwd' ? name : `${name} ${separator} ${state.source}`;
}


function rowColor(
    network: WifiNetwork | undefined,
    theme: { value: string | undefined; muted: string | undefined },
    ramp: Ramp,
): string | undefined
{
    if (network === undefined) {
        return undefined;
    }

    if (network.connected) {
        return theme.value;
    }

    return network.signalDbm === undefined
        ? theme.muted
        : ramp[Math.min(3, Math.floor(signalRatio(network.signalDbm) * 4))];
}
