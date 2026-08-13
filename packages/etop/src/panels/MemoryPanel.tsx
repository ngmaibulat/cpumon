/**
 * Memory and swap.
 *
 * Three things here are decisions rather than layout.
 *
 * The composition bar. `68% used` on its own is the number people panic about,
 * and the breakdown into used / buffers / cached / free is what explains that
 * most of it is reclaimable. MemoryInfo already carries every field for it.
 *
 * Swap is omitted entirely when the machine has none, rather than shown as
 * 0 of 0. That is what libsysmon's own renderMemory does, and a row that is always
 * zero teaches people to stop reading the panel.
 *
 * The source badge. On the 'os' fallback path there is no MemAvailable
 * equivalent, so `used` counts the page cache and reads ten to fifteen points
 * high. Hiding that would make the same dashboard mean two different things on
 * two machines, which is the failure a monitoring tool can least afford.
 */

import { Box, Text } from 'ink';
import { memo } from 'react';
import type { ReactNode } from 'react';
import { bytes } from 'libsysmon/format';
import type { MemoryInfo } from 'libsysmon';

import { Gauge } from '../ui/Gauge.js';
import { Graph } from '../ui/Graph.js';
import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { StackBar } from '../ui/StackBar.js';
import { rampStep } from '../theme/ramp.js';
import { useStore, useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ring } from '../render/ring.js';


export type MemoryPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
};


export const MemoryPanel = memo(function MemoryPanel({ width, height, focused = false }: MemoryPanelProps)
{
    const store = useStore();
    const { snapshot, ticks } = useStoreState();
    const { theme } = useStyle();

    const memory = snapshot?.memory;

    return (
        <Panel
            title="MEM"
            subtitle={memory === undefined || memory.source !== 'os' ? undefined : 'os · cache counted as used'}
            width={width}
            height={height}
            focused={focused}
            badge={
                <Text color={rampStep(theme.memory, (memory?.usedRatio ?? 0))} bold>
                    {memory === undefined ? '' : `${memory.usedPercentage}%`}
                </Text>
            }
        >
            {({ width: inner, height: innerHeight }) => {
                if (memory === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                return (
                    <Body
                        memory={memory}
                        series={store.rings.memory}
                        width={inner}
                        height={innerHeight}
                        tick={ticks}
                    />
                );
            }}
        </Panel>
    );
});


type BodyProps = {
    memory: MemoryInfo;
    series: Ring;
    width: number;
    height: number;
    tick: number;
};


function Body({ memory, series, width, height, tick }: BodyProps)
{
    const { theme } = useStyle();

    const hasSwap = memory.swapTotal > 0;
    const swapRatio = hasSwap ? memory.swapUsed / memory.swapTotal : 0;

    // The two gauges agree on their figures rather than each deciding alone.
    // Gauge falls back to a percentage when a byte figure will not fit, so
    // independently they can end up one showing "63%" and the other
    // "1.0 GiB / 4.0 GiB" - which reads as a bug rather than as two widths.
    const memValue = `${bytes(memory.used)} / ${bytes(memory.total)}`;
    const swapValue = `${bytes(memory.swapUsed)} / ${bytes(memory.swapTotal)}`;

    const valueWidth = Math.max(memValue.length, hasSwap ? swapValue.length : 0);
    // label, space, brackets, space, and a bar worth drawing at all
    const detailed = width >= 4 + 1 + 2 + 1 + valueWidth + 4;

    // rows are claimed in order of what they are worth: the headline gauge,
    // then the breakdown that explains it, then swap, then history in whatever
    // is left
    const rows: { key: string; node: ReactNode }[] = [];

    rows.push({
        key: 'used',
        node: (
            <Gauge
                label="MEM"
                ratio={memory.usedRatio}
                width={width}
                ramp={theme.memory}
                labelWidth={4}
                value={detailed ? memValue : undefined}
                valueWidth={detailed ? valueWidth : 4}
            />
        ),
    });

    if (height >= 3 && width >= 30) {
        rows.push({ key: 'bar', node: <Composition memory={memory} width={width} /> });
        rows.push({ key: 'legend', node: <Legend memory={memory} width={width} /> });
    }

    if (hasSwap) {
        rows.push({
            key: 'swap',
            node: (
                <Gauge
                    label="SWAP"
                    ratio={swapRatio}
                    width={width}
                    ramp={theme.memory}
                    labelWidth={4}
                    value={detailed ? swapValue : undefined}
                    valueWidth={detailed ? valueWidth : 4}
                />
            ),
        });
    }

    const used = Math.min(rows.length, height);
    const graphHeight = height - used;

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            {rows.slice(0, used).map(row => <Box key={row.key} width={width} overflow="hidden">{row.node}</Box>)}
            {graphHeight < 1 ? null : (
                <Graph
                    series={series}
                    width={width}
                    height={graphHeight}
                    max={100}
                    ramp={theme.memory}
                    tick={tick}
                />
            )}
        </Box>
    );
}


function Composition({ memory, width }: { memory: MemoryInfo; width: number })
{
    const { theme } = useStyle();

    // what `used` means here is the same thing the gauge shows - total minus
    // available - so the four segments add up to total and the bar agrees with
    // the number above it
    const reclaimable = Math.max(0, memory.available - memory.free);
    const buffers = Math.min(memory.buffers, reclaimable);
    const cached = Math.max(0, reclaimable - buffers);

    return (
        <StackBar
            width={width}
            useGlyphs={theme.useAttributes}
            segments={[
                { label: 'used', value: memory.used, color: theme.used },
                { label: 'buff', value: buffers, color: theme.buffers },
                { label: 'cache', value: cached, color: theme.cached },
                { label: 'free', value: memory.free, color: theme.free },
            ]}
        />
    );
}


const SEPARATOR = '  ';


/**
 * Names the segments of the composition bar above it.
 *
 * Items are dropped whole when they do not fit, never truncated. `free 3.9 G…`
 * is not a shortened gigabyte figure - it reads as some other unit, and a
 * legend that misstates a unit is worse than one that omits an entry.
 */
function Legend({ memory, width }: { memory: MemoryInfo; width: number })
{
    const { theme } = useStyle();

    const reclaimable = Math.max(0, memory.available - memory.free);

    const items: { label: string; value: string; color: string | undefined }[] = [
        { label: 'used', value: bytes(memory.used), color: theme.used },
        { label: 'cache', value: bytes(reclaimable), color: theme.cached },
        { label: 'free', value: bytes(memory.free), color: theme.free },
    ];

    const shown: typeof items = [];
    let used = 0;

    for (const item of items) {
        const text = `${item.label} ${item.value}`;
        const cost = text.length + (shown.length === 0 ? 0 : SEPARATOR.length);

        if (used + cost > width) {
            break;
        }

        shown.push(item);
        used += cost;
    }

    return (
        <Box width={width} overflow="hidden">
            {shown.map((item, i) => (
                <Text key={item.label} color={item.color} wrap="truncate-end">
                    {`${i === 0 ? '' : SEPARATOR}${item.label} ${item.value}`}
                </Text>
            ))}
        </Box>
    );
}
