/**
 * The layout root.
 *
 * One useInput at the top, one reducer, one place that decides where panels go.
 *
 * The explicit width AND height on the root Box is not a detail. Without them
 * ink lets content size the frame, and a frame one line taller than the
 * terminal scrolls it - which in the alternate screen means the top line is
 * gone for good and every frame after it is drawn one row off. Clamping here is
 * what makes a layout bug show up as a missing row rather than a corrupted
 * screen.
 */

import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useMemo, useReducer } from 'react';

import { computeLayout, MIN_COLUMNS, MIN_ROWS } from './hooks/useLayout.js';
import { useStore, useStoreState } from './hooks/useStore.js';
import { StyleProvider } from './hooks/useTheme.js';
import { resolve } from './state/keymap.js';
import { reduce } from './state/reducer.js';
import { initialUi } from './state/types.js';
import { resolveTheme } from './theme/index.js';
import { CpuPanel } from './panels/CpuPanel.js';
import { DiskPanel } from './panels/DiskPanel.js';
import { Footer } from './panels/Footer.js';
import { Header } from './panels/Header.js';
import { HelpOverlay } from './panels/HelpOverlay.js';
import { MemoryPanel } from './panels/MemoryPanel.js';
import { Panel } from './ui/Panel.js';
import { resolveGraphStyle } from './term/capabilities.js';
import type { Capabilities } from './term/capabilities.js';
import type { PanelId } from './state/types.js';


export type AppProps = {
    capabilities: Capabilities;
    version: string;
    allowKill: boolean;
    theme: Parameters<typeof resolveTheme>[0];
    graph: Parameters<typeof resolveGraphStyle>[0];
    intervalMs: number;
};


export function App({ capabilities, version, theme: initialTheme, graph: initialGraph, intervalMs }: AppProps)
{
    const { columns, rows } = useWindowSize();
    const { exit } = useApp();
    const store = useStore();
    const state = useStoreState();

    const [ui, dispatch] = useReducer(reduce, initialUi(intervalMs, initialTheme, initialGraph));

    useInput((input, key) => {
        const action = resolve(input, key, ui);

        if (action === null) {
            return;
        }

        if (action.type === 'quit') {
            exit();

            return;
        }

        dispatch(action);
    });

    // the store owns sampling and the reducer owns intent; these two effects
    // are the only places they meet, and they run after the render that
    // changed the intent rather than inside the key handler - so a keypress
    // never reaches into the monitor mid-frame
    useEffect(() => {
        store.setPaused(ui.paused);
    }, [store, ui.paused]);

    useEffect(() => {
        store.setIntervalMs(ui.intervalMs);
    }, [store, ui.intervalMs]);

    useEffect(() => {
        if (ui.message === 'history cleared') {
            store.reset();
        }
    }, [store, ui.message]);

    const style = useMemo(() => {
        const resolved = resolveTheme(ui.theme, capabilities.colorLevel);

        return {
            theme: resolved,
            graph: resolveGraphStyle(ui.graph, capabilities.unicode),
            continuousColor: capabilities.colorLevel >= 3,
            unicode: capabilities.unicode,
        };
    }, [ui.theme, ui.graph, capabilities]);

    const layout = useMemo(
        () => computeLayout(columns, rows - 2, state.snapshot, { focus: ui.focus, maximised: ui.maximised }),
        [columns, rows, state.snapshot, ui.focus, ui.maximised],
    );

    if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
        return (
            <StyleProvider value={style}>
                <TooSmall columns={columns} rows={rows} />
            </StyleProvider>
        );
    }

    return (
        <StyleProvider value={style}>
            <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
                <Header width={columns} version={version} intervalMs={state.intervalMs} paused={ui.paused} />
                <Box flexGrow={1} flexDirection="column" overflow="hidden">
                    {ui.overlay === 'help'
                        ? <HelpOverlay width={columns} height={rows - 2} />
                        : layout.rows.map((band, i) => (
                            // the band carries the height its panels agreed on,
                            // so a panel that renders short cannot let the next
                            // band ride up into its space
                            <Box key={i} height={band[0]?.height ?? 0} overflow="hidden">
                                {band.map(rect => (
                                    <PanelFor
                                        key={rect.panel}
                                        panel={rect.panel}
                                        width={rect.width}
                                        height={rect.height}
                                        focused={rect.panel === ui.focus}
                                    />
                                ))}
                            </Box>
                        ))}
                </Box>
                <Footer width={columns} message={ui.message} note={layout.note} />
            </Box>
        </StyleProvider>
    );
}


type PanelForProps = {
    panel: PanelId;
    width: number;
    height: number;
    focused: boolean;
};


function PanelFor({ panel, width, height, focused }: PanelForProps)
{
    switch (panel) {
        case 'cpu':
            return <CpuPanel width={width} height={height} focused={focused} />;

        case 'memory':
            return <MemoryPanel width={width} height={height} focused={focused} />;

        case 'disk':
            return <DiskPanel width={width} height={height} focused={focused} />;

        // the remaining panels arrive with their milestone; until then their
        // slot is simply not claimed
        case 'network':
        case 'process':
        case 'container':
            return <Placeholder panel={panel} width={width} height={height} focused={focused} />;
    }
}


/** a real frame in the right place, so the layout can be judged before the
 *  panel that fills it exists */
function Placeholder({ panel, width, height, focused }: PanelForProps)
{
    return (
        <Panel title={panel.toUpperCase()} width={width} height={height} focused={focused}>
            {({ width: inner, height: innerHeight }) => (
                <Box width={inner} height={innerHeight} overflow="hidden">
                    <Text dimColor wrap="truncate-end">not built yet</Text>
                </Box>
            )}
        </Panel>
    );
}


function TooSmall({ columns, rows }: { columns: number; rows: number })
{
    // deliberately plain: at this size a bordered box would spend most of the
    // screen on its own border
    return (
        <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
            <Text wrap="truncate-end">terminal too small</Text>
            <Text wrap="truncate-end" dimColor>
                {`need ${MIN_COLUMNS}x${MIN_ROWS}, have ${columns}x${rows}`}
            </Text>
        </Box>
    );
}
