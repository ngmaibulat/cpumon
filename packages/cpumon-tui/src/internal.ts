/**
 * The test surface.
 *
 * Deliberately not in package.json's `exports`, so it is not public API - but
 * it is a real entry point, because the alternative is worse. The build bundles
 * with code splitting, so a test that reached into a module directly would be
 * importing `dist/chunk-YVT2GH6V.js`, a name that changes whenever the contents
 * do.
 *
 * Everything reachable from here is a pure function. Components and hooks are
 * exercised through ink's renderToString instead, which needs no help from this
 * file.
 */

export {
    checkRefusal,
    detectCapabilities,
    detectColorLevel,
    resolveGraphStyle,
    supportsUnicode,
} from './term/capabilities.js';

export type { Capabilities, Refusal } from './term/capabilities.js';

export { installLifecycle } from './term/lifecycle.js';

export { buildHelp, parseCliArgs } from './cli-args.js';

export { Ring } from './render/ring.js';

export { SnapshotStore } from './state/store.js';
export type { MonitorLike, MonitorOptions, StoreOptions, StoreState } from './state/store.js';

export { BLOCKS, HALF_BLOCKS, meter, quantise, rasterise, rasteriseInverted, spark } from './render/blocks.js';
export type { Raster } from './render/blocks.js';

export { meterAscii, rasteriseAscii } from './render/ascii.js';

export { brailleCapacity, brailleChar, dotMask, rasteriseBraille } from './render/braille.js';

export { AutoScale, niceMax } from './render/scale.js';

export { GAP, cell, fit, row } from './render/columns.js';
export type { Column, Fitted } from './render/columns.js';

export {
    ANSI16_THEME,
    DEFAULT_THEME,
    MONO_THEME,
    THEME_ORDER,
    nextTheme,
    resolveTheme,
} from './theme/index.js';
export type { Ramp, Theme } from './theme/index.js';

export { rampLerp, rampStep, rowColor } from './theme/ramp.js';

export { StyleProvider } from './hooks/useTheme.js';
export type { DrawStyle } from './hooks/useTheme.js';

export { Gauge } from './ui/Gauge.js';
export { Graph, graphCapacity } from './ui/Graph.js';
export { Loading } from './ui/Loading.js';
export { Panel } from './ui/Panel.js';
export { Sparkline } from './ui/Sparkline.js';
export { Table } from './ui/Table.js';
export { Unavailable } from './ui/Unavailable.js';

export { StackBar, allocate } from './ui/StackBar.js';
export type { Segment } from './ui/StackBar.js';

export { CpuPanel, coreLayout } from './panels/CpuPanel.js';
export { DiskPanel } from './panels/DiskPanel.js';
export { MemoryPanel } from './panels/MemoryPanel.js';

export { StoreProvider } from './hooks/useStore.js';

export { resolve, helpSections, ALL_BINDINGS, GLOBAL_BINDINGS, PANEL_BINDINGS } from './state/keymap.js';
export type { Binding, KeyState } from './state/keymap.js';

export { clamp, reduce } from './state/reducer.js';
export { PANEL_ORDER, initialUi } from './state/types.js';
export type { Action, PanelId, UiState } from './state/types.js';

export { computeLayout, isAbsent, presentPanels } from './hooks/useLayout.js';
export type { Layout, Rect } from './hooks/useLayout.js';

export { Footer } from './panels/Footer.js';
export { Header } from './panels/Header.js';
export { HelpOverlay } from './panels/HelpOverlay.js';
