/**
 * CPU: the machine-wide history graph, plus per-core detail that adapts to how
 * many cores there are.
 *
 * The adaptation is the interesting part. A four-core laptop and a 128-core
 * server want genuinely different displays, and picking one and scaling it
 * fails at the other end: eight mini-graphs on 128 cores needs sixteen screens,
 * and a sparkline strip on four cores wastes a panel to show four characters.
 * So there are three modes and the core count chooses between them.
 */

import { Box, Text } from 'ink';
import { memo, useMemo } from 'react';

import { Gauge } from '../ui/Gauge.js';
import { Graph } from '../ui/Graph.js';
import { Loading } from '../ui/Loading.js';
import { Panel } from '../ui/Panel.js';
import { Sparkline } from '../ui/Sparkline.js';
import { rampStep } from '../theme/ramp.js';
import { useStore, useStoreState } from '../hooks/useStore.js';
import { useStyle } from '../hooks/useTheme.js';
import type { Ring } from '../render/ring.js';


export type CpuPanelProps = {
    width: number;
    height: number;
    focused?: boolean;
};


/** up to this many cores, each gets its own miniature history graph */
const GRAPH_CORES = 8;

/** up to this many, each gets a one-line gauge in a grid */
const GAUGE_CORES = 32;

/** a mini graph narrower than this shows too little history to read */
const MINI_WIDTH = 8;

/** `C00 [▆▃▁▂] 42%` */
const GAUGE_CELL = 16;

/** the right-hand gutter: the current figure and the load average under it */
const GUTTER = 22;


export const CpuPanel = memo(function CpuPanel({ width, height, focused = false }: CpuPanelProps)
{
    const store = useStore();
    const { snapshot, ticks } = useStoreState();
    const { theme } = useStyle();

    const cores = snapshot?.cpu ?? [];
    const overall = snapshot?.cpuOverall?.loadPercentage ?? 0;
    const model = snapshot?.cpu?.[0]?.model;

    return (
        <Panel
            title="CPU"
            subtitle={cores.length === 0 ? undefined : `${cores.length}C`}
            width={width}
            height={height}
            focused={focused}
            badge={
                <Text color={rampStep(theme.cpu, overall / 100)} bold>
                    {snapshot === null ? '' : `${Math.round(overall)}%`}
                </Text>
            }
        >
            {({ width: inner, height: innerHeight }) => {
                if (snapshot === null) {
                    return <Loading width={inner} height={innerHeight} />;
                }

                return (
                    <Body
                        store={store}
                        cores={cores.map(core => core.loadPercentage ?? 0)}
                        model={model}
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
    store: { rings: { cpu: Ring }; cores: Ring[] };
    cores: number[];
    model: string | undefined;
    width: number;
    height: number;
    tick: number;
};


function Body({ store, cores, model, width, height, tick }: BodyProps)
{
    const { theme } = useStyle();

    // the per-core section takes what it needs and the main graph takes the
    // rest, rather than a fixed split - on a short panel the machine-wide
    // graph is the one worth keeping
    const detail = coreLayout(cores.length, width, height);
    const graphHeight = Math.max(1, height - detail.rows);

    const gutter = width >= 50 ? Math.min(GUTTER, Math.floor(width / 3)) : 0;
    const graphWidth = Math.max(1, width - gutter);

    return (
        <Box flexDirection="column" width={width} height={height} overflow="hidden">
            <Box width={width} height={graphHeight} overflow="hidden">
                <Graph
                    series={store.rings.cpu}
                    width={graphWidth}
                    height={graphHeight}
                    max={100}
                    ramp={theme.cpu}
                    tick={tick}
                />
                {gutter === 0 ? null : (
                    <Box width={gutter} flexDirection="column" paddingLeft={1} overflow="hidden">
                        {model === undefined ? null : (
                            <Text color={theme.muted} wrap="truncate-end">{model}</Text>
                        )}
                    </Box>
                )}
            </Box>
            <CoreDetail store={store} cores={cores} layout={detail} width={width} tick={tick} />
        </Box>
    );
}


type CoreLayout =
    | { kind: 'none'; rows: 0 }
    | { kind: 'graphs'; rows: number; cellWidth: number }
    | { kind: 'gauges'; rows: number; perRow: number }
    | { kind: 'sparkline'; rows: number };


/**
 * Decide how to show the cores, given how many there are and what room is left.
 *
 * Height is checked before core count: a panel with three interior rows has
 * nothing to spare, and a per-core section that squeezes the main graph to
 * nothing has the priority backwards.
 */
export function coreLayout(count: number, width: number, height: number): CoreLayout
{
    if (count === 0 || height < 4 || width < MINI_WIDTH) {
        return { kind: 'none', rows: 0 };
    }

    if (count <= GRAPH_CORES) {
        const cellWidth = Math.floor(width / count);

        if (cellWidth >= MINI_WIDTH) {
            // a third of the panel, and never more than a third of the height
            return { kind: 'graphs', rows: Math.max(2, Math.floor(height / 3)), cellWidth };
        }
    }

    if (count <= GAUGE_CORES) {
        const perRow = Math.max(1, Math.floor(width / GAUGE_CELL));
        const rows = Math.ceil(count / perRow);

        // only if it leaves the main graph at least two rows to live in
        if (rows <= height - 2) {
            return { kind: 'gauges', rows, perRow };
        }
    }

    // a machine with more cores than a screen can hold: one glyph each, wrapped
    const rows = Math.min(Math.ceil(count / Math.max(1, width)), Math.max(1, height - 2));

    return { kind: 'sparkline', rows };
}


type CoreDetailProps = {
    store: { cores: Ring[] };
    /** the current percentage per core, for the labels */
    cores: number[];
    layout: CoreLayout;
    width: number;
    tick: number;
};


function CoreDetail({ store, cores, layout, width, tick }: CoreDetailProps)
{
    const { theme } = useStyle();

    if (layout.kind === 'none') {
        return null;
    }

    if (layout.kind === 'graphs') {
        return (
            <Box width={width} height={layout.rows} overflow="hidden">
                {store.cores.map((series, i) => (
                    <Box key={i} width={layout.cellWidth} flexDirection="column" overflow="hidden">
                        <Graph
                            series={series}
                            width={layout.cellWidth - 1}
                            height={layout.rows - 1}
                            max={100}
                            ramp={theme.cpu}
                            tick={tick}
                        />
                        <Text color={theme.muted} wrap="truncate-end">
                            {`${label(i)}${String(Math.round(cores[i] ?? 0)).padStart(4)}%`}
                        </Text>
                    </Box>
                ))}
            </Box>
        );
    }

    if (layout.kind === 'gauges') {
        const cellWidth = Math.floor(width / layout.perRow);

        return (
            <Box width={width} height={layout.rows} flexDirection="column" overflow="hidden">
                {chunk(cores, layout.perRow).map((group, r) => (
                    <Box key={r} width={width} overflow="hidden">
                        {group.map((value, c) => (
                            // the cell is one wider than the gauge, so adjacent
                            // cores do not run into each other
                            <Box key={c} width={cellWidth} overflow="hidden">
                                <Gauge
                                    label={label(r * layout.perRow + c)}
                                    ratio={value / 100}
                                    width={cellWidth - 1}
                                    ramp={theme.cpu}
                                    labelWidth={3}
                                    valueWidth={4}
                                />
                            </Box>
                        ))}
                    </Box>
                ))}
            </Box>
        );
    }

    return (
        <Box width={width} height={layout.rows} flexDirection="column" overflow="hidden">
            {chunk(cores, width).slice(0, layout.rows).map((group, r) => (
                <Sparkline key={r} values={group} max={100} ramp={theme.cpu} width={width} />
            ))}
        </Box>
    );
}


/** `C00`, wide enough for a 999-core machine before it needs another digit */
function label(index: number): string
{
    return `C${String(index).padStart(2, '0')}`;
}


function chunk<T>(items: T[], size: number): T[][]
{
    if (size < 1) {
        return [items];
    }

    const result: T[][] = [];

    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }

    return result;
}
