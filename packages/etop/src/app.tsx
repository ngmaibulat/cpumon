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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { CHROME_ROWS, computeLayout, MIN_COLUMNS, MIN_ROWS } from './hooks/useLayout.js';
import { useStore, useStoreState } from './hooks/useStore.js';
import { useSlow } from './hooks/useSlow.js';
import { StyleProvider, glyphsFor } from './hooks/useTheme.js';
import { resolve } from './state/keymap.js';
import { reduce } from './state/reducer.js';
import { initialUi } from './state/types.js';
import { resolveTheme } from './theme/index.js';
import { CpuPanel } from './panels/CpuPanel.js';
import { DiskPanel } from './panels/DiskPanel.js';
import { Footer } from './panels/Footer.js';
import { Header } from './panels/Header.js';
import { HelpOverlay } from './panels/HelpOverlay.js';
import { ContainerPanel } from './panels/ContainerPanel.js';
import { ConnectionPanel } from './panels/ConnectionPanel.js';
import { StackPanel } from './panels/StackPanel.js';
import { UnitPanel } from './panels/UnitPanel.js';
import { WifiPanel } from './panels/WifiPanel.js';
import { KillModal } from './panels/KillModal.js';
import { MemoryPanel } from './panels/MemoryPanel.js';
import { NetworkPanel } from './panels/NetworkPanel.js';
import { ProcessPanel } from './panels/ProcessPanel.js';
import { TabBar } from './panels/TabBar.js';
import { FilterInput } from './ui/FilterInput.js';
import { sendSignal } from './state/signals.js';
import { resolveGraphStyle } from './term/capabilities.js';
import type { Capabilities } from './term/capabilities.js';
import type { Layout } from './hooks/useLayout.js';
import type { PanelId, ScreenId, UiState } from './state/types.js';
import type { SlowSource } from './state/slow.js';
import type { ProcessView } from './panels/ProcessPanel.js';
import type { Killer } from './state/signals.js';


export type AppProps = {
    capabilities: Capabilities;
    version: string;
    allowKill: boolean;
    /** test seam: nothing in the suite ever signals a real process */
    kill?: Killer;
    theme: Parameters<typeof resolveTheme>[0];
    graph: Parameters<typeof resolveGraphStyle>[0];
    intervalMs: number;
};


export function App({ capabilities, version, allowKill, kill, theme: initialTheme, graph: initialGraph, intervalMs }: AppProps)
{
    const { columns, rows } = useWindowSize();
    const { exit } = useApp();
    const store = useStore();
    const state = useStoreState();

    const [ui, dispatch] = useReducer(reduce, initialUi(intervalMs, initialTheme, initialGraph));

    // The reducer cannot know how many processes there are or how many rows
    // the table has - both depend on data and on layout. The panel reports
    // them and the reducer clamps itself, so a list that shrinks under a
    // stationary cursor moves the cursor without needing a keypress, and there
    // is still only one copy of the state for a keypress to act on.
    const [matchCount, setMatchCount] = useState(0);

    // held in a ref rather than state: the modal reads it once, when it opens,
    // and re-rendering the whole app every time the row under the cursor
    // changes identity would defeat every memo below it
    const view = useRef<ProcessView>({ rowCount: 0, windowRows: 1, selected: null });

    const onView = useCallback((next: ProcessView) => {
        view.current = next;
        setMatchCount(next.rowCount);
        dispatch({ type: 'clamp', rowCount: next.rowCount, windowRows: next.windowRows });
    }, []);

    /**
     * The same report from a list that is not the process table.
     *
     * Narrower on purpose: `view.current` is what the kill modal reads to
     * decide which pid it is about to signal, so only the process table gets to
     * write it. Every other scrollable screen reports its geometry and nothing
     * else.
     */
    const onRows = useCallback((rowCount: number, windowRows: number) => {
        dispatch({ type: 'clamp', rowCount, windowRows });
    }, []);

    // which compose project the cursor is on, held in a ref for the same reason
    // `view` is: Enter reads it once, and re-rendering on every cursor move
    // would defeat the memo on the panel it came from
    const project = useRef<string | null>(null);

    const onProject = useCallback((next: string | null) => {
        project.current = next;
    }, []);

    const slow = useSlow();

    /**
     * Tell the slow poller what this screen needs.
     *
     * The union is exactly what is visible, so leaving the stacks screen stops
     * the docker traffic and a session that never visits it never opens the
     * socket. setActive is idempotent, which is what makes running this on
     * every screen change safe.
     */
    useEffect(() => {
        slow?.setActive(SOURCES_FOR[ui.screen] ?? []);
    }, [slow, ui.screen]);

    useInput((input, key) => {
        if (ui.overlay === 'kill') {
            handleKillKeys(input, key);

            return;
        }

        const action = resolve(input, key, ui);

        if (action === null) {
            return;
        }

        if (action.type === 'quit') {
            exit();

            return;
        }

        // the binding says "open the kill modal"; only here is it known which
        // process the selection has landed on, so the pid is pinned now rather
        // than read again at the moment of confirmation
        if (action.type === 'overlay' && action.overlay === 'kill') {
            const row = view.current.selected;

            dispatch({
                type: 'kill-open',
                target: row === null
                    ? null
                    : { pid: row.pid, comm: row.comm, threads: row.threads },
            });

            return;
        }

        // the binding says "fold the selected project"; only the panel knows
        // which row the cursor is on, so the name is filled in here
        if (action.type === 'toggle-collapse') {
            dispatch({ type: 'toggle-collapse', project: project.current ?? '' });

            return;
        }

        dispatch(action);
    });

    /**
     * The modal owns the keyboard while it is up.
     *
     * Confirmation is `y` rather than Enter, because Enter is muscle memory in
     * the list this was opened from. Ctrl-C still quits, since a modal that can
     * trap someone is not a safety feature.
     */
    function handleKillKeys(input: string, key: { ctrl?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean })
    {
        if (key.ctrl === true && input === 'c') {
            exit();

            return;
        }

        if (key.escape === true || input === 'n' || input === 'q') {
            dispatch({ type: 'kill-close' });

            return;
        }

        if (input === 'k' || key.upArrow === true) {
            dispatch({ type: 'kill-move', delta: -1 });

            return;
        }

        if (input === 'j' || key.downArrow === true) {
            dispatch({ type: 'kill-move', delta: 1 });

            return;
        }

        if (input !== 'y') {
            return;
        }

        if (!allowKill) {
            dispatch({ type: 'kill-close' });
            dispatch({ type: 'message', text: 'signalling is disabled; restart with --allow-kill' });

            return;
        }

        if (ui.killTarget === null) {
            dispatch({ type: 'kill-close' });

            return;
        }

        const result = sendSignal(ui.killTarget.pid, ui.signal, kill);

        dispatch({ type: 'kill-close' });
        dispatch({ type: 'message', text: result.message });
    }

    // the store owns sampling and the reducer owns intent; these two effects
    // are the only places they meet, and they run after the render that
    // changed the intent rather than inside the key handler - so a keypress
    // never reaches into the monitor mid-frame
    useEffect(() => {
        // the modal freezes the view as well as pinning its target, so
        // cancelling returns to the list that was there rather than to one that
        // has moved on underneath
        store.setPaused(ui.paused || ui.overlay === 'kill');
    }, [store, ui.paused, ui.overlay]);

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
            glyphs: glyphsFor(capabilities.unicode),
        };
    }, [ui.theme, ui.graph, capabilities]);

    // header, tab bar, footer. Every consumer of the body height below has to
    // use this one figure: a frame one line taller than the terminal scrolls
    // the alternate screen, and that damage does not wash out on the next frame
    const body = rows - CHROME_ROWS;

    const layout = useMemo(
        () => computeLayout(columns, body, state.snapshot, { focus: ui.focus, maximised: ui.maximised }),
        [columns, body, state.snapshot, ui.focus, ui.maximised],
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
                <TabBar width={columns} screen={ui.screen} />
                <Box flexGrow={1} flexDirection="column" overflow="hidden">
                    {ui.overlay === 'help'
                        ? <HelpOverlay width={columns} height={body} />
                        : ui.overlay === 'kill'
                        ? (
                            <KillModal
                                width={columns}
                                height={body}
                                target={ui.killTarget}
                                signal={ui.signal}
                                allowed={allowKill}
                            />
                        )
                        : (
                            <ScreenFor
                                width={columns}
                                height={body}
                                layout={layout}
                                ui={ui}
                                onView={onView}
                                onRows={onRows}
                                onProject={onProject}
                            />
                        )}
                </Box>
                {ui.filtering
                    // the bar replaces the footer rather than adding a row: a
                    // layout that grows by one line the moment you start typing
                    // moves the row out from under the cursor
                    ? <FilterInput value={ui.filter} width={columns} matches={matchCount} />
                    : <Footer width={columns} message={ui.message} note={layout.note} />}
            </Box>
        </StyleProvider>
    );
}


/**
 * What each screen needs from the slow poller.
 *
 * A screen that is not listed asks for nothing, and the poller then opens no
 * socket at all - which is the whole point of setActive. `containers` is here
 * as well as `stacks` because the container table now joins the cgroup figures
 * against docker's names.
 */
const SOURCES_FOR: Partial<Record<ScreenId, SlowSource[]>> = {
    stacks: ['docker'],
    containers: ['docker'],
    units: ['units'],
    wifi: ['wifi'],
};


type ScreenForProps = {
    width: number;
    height: number;
    layout: Layout;
    ui: UiState;
    onView: (view: ProcessView) => void;
    onRows: (rowCount: number, windowRows: number) => void;
    onProject: (project: string | null) => void;
};


/**
 * What fills the frame.
 *
 * The dashboard is the tiled arrangement it always was. Every other screen is
 * one panel handed the whole body rect - which is why adding screens needed no
 * new panel code: ProcessPanel and ContainerPanel already take a width and a
 * height and render inside Panel, and "full screen" is just a bigger rect.
 */
function ScreenFor({ width, height, layout, ui, onView, onRows, onProject }: ScreenForProps)
{
    switch (ui.screen) {
        case 'dash':
            return (
                <>
                    {layout.rows.map((band, i) => (
                        // the band carries the height its panels agreed on, so
                        // a panel that renders short cannot let the next band
                        // ride up into its space
                        <Box key={i} height={band[0]?.height ?? 0} overflow="hidden">
                            {band.map(rect => (
                                <PanelFor
                                    key={rect.panel}
                                    panel={rect.panel}
                                    width={rect.width}
                                    height={rect.height}
                                    focused={rect.panel === ui.focus}
                                    ui={ui}
                                    onView={onView}
                                />
                            ))}
                        </Box>
                    ))}
                </>
            );

        case 'proc':
            return (
                <ProcessPanel
                    width={width}
                    height={height}
                    focused
                    selected={ui.selected}
                    scroll={ui.scroll}
                    sort={ui.sort}
                    sortReverse={ui.sortReverse}
                    filter={ui.filter}
                    expanded={ui.expanded}
                    onView={onView}
                />
            );

        case 'containers':
            return (
                <ContainerPanel
                    width={width}
                    height={height}
                    focused
                    selected={ui.selected}
                    scroll={ui.scroll}
                    onRows={onRows}
                />
            );

        case 'conn':
            return (
                <ConnectionPanel
                    width={width}
                    height={height}
                    focused
                    selected={ui.selected}
                    scroll={ui.scroll}
                    onRows={onRows}
                />
            );

        case 'wifi':
            return <WifiPanel width={width} height={height} focused />;

        case 'units':
            return (
                <UnitPanel
                    width={width}
                    height={height}
                    focused
                    selected={ui.selected}
                    scroll={ui.scroll}
                    allTypes={ui.allUnitTypes}
                    filter={ui.filter}
                    onRows={onRows}
                />
            );

        case 'stacks':
            return (
                <StackPanel
                    width={width}
                    height={height}
                    focused
                    selected={ui.selected}
                    scroll={ui.scroll}
                    collapsed={ui.collapsed}
                    onRows={onRows}
                    onProject={onProject}
                />
            );

        default: {
            // Every ScreenId now has a case above, and this is the compiler's
            // proof of it: adding a screen without a panel is a type error here
            // rather than a blank frame at runtime. It replaces Placeholder,
            // which existed only while some screens had no collector.
            const unreachable: never = ui.screen;

            void unreachable;

            return null;
        }
    }
}


type PanelForProps = {
    panel: PanelId;
    width: number;
    height: number;
    focused: boolean;
    ui: UiState;
    onView: (view: ProcessView) => void;
};


function PanelFor({ panel, width, height, focused, ui, onView }: PanelForProps)
{
    switch (panel) {
        case 'cpu':
            return <CpuPanel width={width} height={height} focused={focused} />;

        case 'memory':
            return <MemoryPanel width={width} height={height} focused={focused} />;

        case 'disk':
            return <DiskPanel width={width} height={height} focused={focused} />;

        case 'network':
            return (
                <NetworkPanel
                    width={width}
                    height={height}
                    focused={focused}
                    index={ui.interfaceIndex}
                    bits={ui.bits}
                />
            );

        case 'process':
            return (
                <ProcessPanel
                    width={width}
                    height={height}
                    focused={focused}
                    selected={ui.selected}
                    scroll={ui.scroll}
                    sort={ui.sort}
                    sortReverse={ui.sortReverse}
                    filter={ui.filter}
                    expanded={ui.expanded}
                    onView={onView}
                />
            );

        case 'container':
            return <ContainerPanel width={width} height={height} focused={focused} />;
    }
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
