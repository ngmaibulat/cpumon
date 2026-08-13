/**
 * Network throughput for one interface at a time.
 *
 * Two mirrored graphs around a centre axis, receive above and transmit below.
 *
 * The obvious way to draw the lower half is with a top-anchored block set, and
 * it does not exist: Unicode has ▔ (one eighth) and ▀ (four) and nothing in
 * between. So transmit uses the same bottom-anchored glyphs with the rows
 * emitted in reverse, which reads correctly as a reflection and uses only
 * characters that are actually in the font.
 *
 * The axis is shared between the two halves rather than scaled separately.
 * Independent axes make a 2 KiB/s upload look the same size as a 200 MiB/s
 * download, which is exactly the comparison the mirrored layout invites.
 */

import { Box, Text } from 'ink';
import { memo, useMemo, useRef } from 'react';
import { bytes, rate } from 'cpumon/format';
import { isAvailable } from 'cpumon';
import type { InterfaceRate } from 'cpumon';

import { Graph } from '../ui/Graph.js';
import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Unavailable } from '../ui/Unavailable.js';
import { AutoScale } from '../render/scale.js';
import { useStore, useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ring } from '../render/ring.js';


export type NetworkPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
    /** which interface, as an index into the sorted list */
    index: number;
    /** show bits per second rather than bytes */
    bits: boolean;
};


/**
 * Interfaces, busiest first, but loopback last regardless.
 *
 * Ported from cpumon's own renderNetwork: lo is almost always the loudest
 * interface on a machine and almost never the interesting one, so sorting it
 * to the top would mean the default selection is nearly always wrong.
 */
export function orderInterfaces(interfaces: InterfaceRate[]): InterfaceRate[]
{
    return [...interfaces].sort((a, b) => {
        if ((a.name === 'lo') !== (b.name === 'lo')) {
            return a.name === 'lo' ? 1 : -1;
        }

        return (b.rxBytesPerSec + b.txBytesPerSec) - (a.rxBytesPerSec + a.txBytesPerSec);
    });
}


export const NetworkPanel = memo(function NetworkPanel({
    width,
    height,
    focused = false,
    index,
    bits,
}: NetworkPanelProps)
{
    const store = useStore();
    const { snapshot, ticks } = useStoreState();
    const { theme } = useStyle();

    // one axis, held across renders, so the graph does not rescale every frame
    const scale = useRef<AutoScale | null>(null);

    scale.current ??= new AutoScale({ shrinkAfter: 8, floor: 1024 });

    const probe = snapshot?.network;

    const ordered = useMemo(
        () => (probe !== undefined && isAvailable(probe) ? orderInterfaces(probe.interfaces) : []),
        [probe],
    );

    const selected = ordered.length === 0 ? null : ordered[index % ordered.length];

    return (
        <Panel
            title="NET"
            subtitle={selected?.name ?? undefined}
            width={width}
            height={height}
            focused={focused}
            badge={
                selected === null ? null : (
                    <Text color={theme.network[1]}>
                        {`${ordered.length > 1 ? `${(index % ordered.length) + 1}/${ordered.length} ` : ''}`}
                    </Text>
                )
            }
        >
            {({ width: inner, height: innerHeight }) => {
                if (probe === undefined) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                if (!isAvailable(probe)) {
                    return <Unavailable reason={probe.reason} detail={probe.detail} width={inner} height={innerHeight} />;
                }

                // an available probe with nothing in it on the first tick is a
                // missing baseline, not a machine with no interfaces
                if (ordered.length === 0) {
                    return ticks <= 1
                        ? <Loading width={inner} height={innerHeight} />
                        : (
                            <Text color={theme.muted} wrap="truncate-end">
                                no interfaces with a full sampling window yet
                            </Text>
                        );
                }

                const series = store.seriesFor((selected as InterfaceRate).name);

                return (
                    <Body
                        rx={series.rx}
                        tx={series.tx}
                        current={selected as InterfaceRate}
                        scale={scale.current as AutoScale}
                        width={inner}
                        height={innerHeight}
                        bits={bits}
                        tick={ticks}
                    />
                );
            }}
        </Panel>
    );
});


type BodyProps = {
    rx: Ring;
    tx: Ring;
    current: InterfaceRate;
    scale: AutoScale;
    width: number;
    height: number;
    bits: boolean;
    tick: number;
};


function Body({ rx, tx, current, scale, width, height, bits, tick }: BodyProps)
{
    const { theme, glyphs } = useStyle();

    // one ceiling for both halves: separate axes would make a 2 KiB/s upload
    // look the same size as a 200 MiB/s download
    const max = scale.update(Math.max(rx.max(width), tx.max(width)));

    // The figures come first and the graphs take what is left. A one-row graph
    // split between receive and transmit shows one glyph of each and says
    // nothing, while "↓ 4.2 MiB/s" in the same row says the thing someone
    // opened the panel to find out.
    const summaryRows = Math.min(height, 2);
    const graphRows = height - summaryRows;

    // a mirrored pair needs a row each; with only one to give, receive takes it
    const rxRows = graphRows >= 2 ? Math.ceil(graphRows / 2) : graphRows;
    const txRows = graphRows >= 2 ? graphRows - rxRows : 0;

    const unit = (value: number) => (bits ? `${bytes(value * 8).replace('iB', 'ib')}/s` : rate(value));

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            {rxRows < 1 ? null : (
                <Graph
                    series={rx}
                    width={width}
                    height={rxRows}
                    max={max}
                    ramp={theme.network}
                    tick={tick}
                />
            )}
            {txRows < 1 ? null : (
                <Graph
                    series={tx}
                    width={width}
                    height={txRows}
                    max={max}
                    ramp={theme.network}
                    inverted
                    tick={tick}
                />
            )}
            {summaryRows === 1 ? (
                // one row left: both directions on it, dropping the totals
                <Text wrap="truncate-end">
                    <Text color={theme.network[1]}>{`${glyphs.down} `}</Text>
                    <Text color={theme.value}>{unit(current.rxBytesPerSec)}</Text>
                    <Text color={theme.network[2]}>{`  ${glyphs.up} `}</Text>
                    <Text color={theme.value}>{unit(current.txBytesPerSec)}</Text>
                </Text>
            ) : null}
            {summaryRows >= 2 ? (
                <>
                    <Text wrap="truncate-end">
                        <Text color={theme.network[1]}>{`${glyphs.down} `}</Text>
                        <Text color={theme.value}>{unit(current.rxBytesPerSec).padEnd(12)}</Text>
                        <Text color={theme.muted}>{`total ${bytes(current.rxBytes)}`}</Text>
                    </Text>
                    <Text wrap="truncate-end">
                        <Text color={theme.network[2]}>{`${glyphs.up} `}</Text>
                        <Text color={theme.value}>{unit(current.txBytesPerSec).padEnd(12)}</Text>
                        <Text color={theme.muted}>{`total ${bytes(current.txBytes)}`}</Text>
                    </Text>
                </>
            ) : null}
        </Box>
    );
}
