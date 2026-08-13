/**
 * Raw numbers, no layout, no colour.
 *
 * A scaffold for the milestone that builds the data spine before any of the
 * real panels exist - and worth keeping afterwards, because when a graph looks
 * wrong the first question is always whether the number behind it is wrong too.
 */

import { Box, Text } from 'ink';
import { bytes, rate } from 'cpumon/format';
import { isAvailable } from 'cpumon';
import type { Probe } from 'cpumon';

import { useStore, useStoreState } from '../hooks/useStore.js';


export function DebugPanel()
{
    const store = useStore();
    const { snapshot, error, ticks, intervalMs, paused } = useStoreState();

    if (snapshot === null) {
        return (
            <Box flexDirection="column">
                <Text dimColor>waiting for a full sampling window…</Text>
                {error === null ? null : <Text color="red">{error.message}</Text>}
            </Box>
        );
    }

    const lines: string[] = [
        `tick ${ticks}  every ${intervalMs}ms  window ${snapshot.elapsedMs}ms${paused ? '  [PAUSED]' : ''}`,
        `cpu   ${(snapshot.cpuOverall?.loadPercentage ?? 0).toString().padStart(3)}%  across ${snapshot.cpu?.length ?? 0} cores`,
    ];

    if (snapshot.memory !== undefined) {
        const { memory } = snapshot;
        lines.push(`mem   ${memory.usedPercentage.toString().padStart(3)}%  ${bytes(memory.used)} of ${bytes(memory.total)}  (${memory.source})`);
    }

    if (snapshot.load !== undefined && isAvailable(snapshot.load)) {
        lines.push(`load  ${snapshot.load.one.toFixed(2)} ${snapshot.load.five.toFixed(2)} ${snapshot.load.fifteen.toFixed(2)}`);
    }

    if (snapshot.disk !== undefined && isAvailable(snapshot.disk)) {
        lines.push(`disk  ${snapshot.disk.disk.usedPercentage.toString().padStart(3)}%  ${bytes(snapshot.disk.disk.used)} of ${bytes(snapshot.disk.disk.size)}  on ${snapshot.disk.disk.mount}`);
    }

    lines.push(probeLine('net', snapshot.network, probe => {
        const total = probe.interfaces
            .filter(nic => nic.name !== 'lo')
            .reduce((sum, nic) => ({ rx: sum.rx + nic.rxBytesPerSec, tx: sum.tx + nic.txBytesPerSec }), { rx: 0, tx: 0 });

        return `${probe.interfaces.length} interfaces  down ${rate(total.rx)}  up ${rate(total.tx)}`;
    }));

    lines.push(probeLine('proc', snapshot.processes, probe =>
        probe.processes.length === 0
            ? 'no processes with a full window yet'
            : `${probe.processes.length} rows, busiest ${probe.processes[0].comm} at ${probe.processes[0].cpuPercentage.toFixed(1)}%`));

    lines.push(probeLine('cgrp', snapshot.containers, probe =>
        `${probe.containers.length} containers (${probe.scope})`));

    lines.push(`hist  cpu ${store.rings.cpu.length}  mem ${store.rings.memory.length}  rx ${store.rings.rx.length}  cores ${store.cores.length}`);

    return (
        <Box flexDirection="column">
            {lines.map((line, i) => <Text key={i} wrap="truncate-end">{line}</Text>)}
            {error === null ? null : <Text color="red" wrap="truncate-end">{`err   ${error.message}`}</Text>}
        </Box>
    );
}


/**
 * One line for a probe, showing the reason rather than hiding the row.
 *
 * The debug panel is the one place that should never elide an unavailable
 * probe. Everywhere else 'not-applicable' is noise worth suppressing; here the
 * whole point of looking is to find out which reads are failing and why.
 */
function probeLine<T>(
    label: string,
    probe: Probe<T> | undefined,
    format: (value: T) => string,
): string
{
    if (probe === undefined) {
        return `${label}   not collected`;
    }

    if (!isAvailable(probe)) {
        const detail = probe.detail === undefined ? '' : ` — ${probe.detail}`;

        return `${label}   unavailable (${probe.reason})${detail}`;
    }

    return `${label}   ${format(probe)}`;
}
