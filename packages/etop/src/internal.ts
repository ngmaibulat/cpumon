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

export {
    resolve,
    activePanel,
    helpSections,
    ALL_BINDINGS,
    GLOBAL_BINDINGS,
    LIST_BINDINGS,
    NETWORK_BINDINGS,
    PANEL_BINDINGS,
    PROCESS_BINDINGS,
    SCREEN_BINDINGS,
    STACK_BINDINGS,
    TUNNEL_BINDINGS,
    UNIT_BINDINGS,
} from './state/keymap.js';
export type { Binding, KeyState } from './state/keymap.js';

export { clamp, reduce } from './state/reducer.js';
export { DEFAULT_SLOW_INTERVAL, SlowPoller } from './state/slow.js';
export type { SlowSource, SlowState } from './state/slow.js';
export { SlowProvider, useSlow, useSlowState } from './hooks/useSlow.js';
export { PANEL_ORDER, SCREEN_LABELS, SCREEN_ORDER, SCREEN_PANEL, initialUi } from './state/types.js';
export type { Action, Cursor, PanelId, ScreenId, UiState } from './state/types.js';

export { TAB_GAP, fitTabs } from './render/tabs.js';
export type { Tab, TabLayout } from './render/tabs.js';

export { TabBar } from './panels/TabBar.js';

export { CHROME_ROWS, MIN_COLUMNS, MIN_ROWS, computeLayout, isAbsent, presentPanels } from './hooks/useLayout.js';
export type { Layout, Rect } from './hooks/useLayout.js';

export { Footer } from './panels/Footer.js';
export { Header } from './panels/Header.js';
export { HelpOverlay } from './panels/HelpOverlay.js';

export { NetworkPanel, orderInterfaces } from './panels/NetworkPanel.js';
export { ProcessPanel, matches } from './panels/ProcessPanel.js';
export { FilterInput } from './ui/FilterInput.js';

export { App } from './app.js';

export { KillModal } from './panels/KillModal.js';
export { DEFAULT_SIGNAL, SIGNALS, sendSignal } from './state/signals.js';
export type { KillResult, Killer, SignalChoice, SignalName } from './state/signals.js';
export type { KillTarget } from './state/types.js';
export type { ProcessView } from './panels/ProcessPanel.js';

export { ContainerPanel, dockerIdOf, dockerIndex, pressure } from './panels/ContainerPanel.js';
export {
    StackPanel,
    buildStackRows,
    shortPath,
    toRow as stackRow,
} from './panels/StackPanel.js';
export type { StackRow } from './panels/StackPanel.js';
export {
    BEST_DBM,
    WORST_DBM,
    WifiPanel,
    detailLine,
    signalRamp,
    signalRatio,
    toRow as wifiRow,
} from './panels/WifiPanel.js';
export {
    DEFAULT_TYPES,
    UnitPanel,
    compareUnits,
    matchesUnit,
    selectUnits,
    toRow as unitRow,
} from './panels/UnitPanel.js';
export {
    ConnectionPanel,
    compareConnections,
    ownerCell,
    toRow as connectionRow,
} from './panels/ConnectionPanel.js';

export { glyphsFor } from './hooks/useTheme.js';
export type { Glyphs } from './hooks/useTheme.js';

export {
    CONFIG_VERSION,
    TEMPLATE as TUNNEL_TEMPLATE,
    configPath as tunnelConfigPath,
    parseTunnelConfig,
} from './tunnels/config.js';
export type { Forward, ParseResult, Tunnel, TunnelConfig } from './tunnels/config.js';

export {
    DEFAULT_OPTIONS as SSH_DEFAULT_OPTIONS,
    buildSshArgs,
    classifyExit,
    describeCommand,
    forwardSpec,
} from './tunnels/ssh.js';
export type { ExitVerdict } from './tunnels/ssh.js';

export {
    DEFAULT_BASE_MS,
    DEFAULT_CAP_MS,
    STABLE_MS,
    nextDelay,
} from './tunnels/backoff.js';
export type { BackoffOptions } from './tunnels/backoff.js';

export {
    DEFAULT_GRACE_MS,
    DEFAULT_TERM_GRACE_MS,
    TunnelSupervisor,
} from './tunnels/supervisor.js';
export type {
    Child,
    CommandResult,
    Spawner,
    SupervisorOptions,
    TunnelPhase,
    TunnelStatus,
    TunnelsState,
} from './tunnels/supervisor.js';

export { loadTunnelConfig, writeTemplate } from './tunnels/load.js';
export type { ConfigProbe, WriteResult } from './tunnels/load.js';

export { TunnelProvider, useTunnels, useTunnelsState } from './hooks/useTunnels.js';
export {
    TunnelPanel,
    stateColor,
    targetOf,
    toRow as tunnelRow,
} from './panels/TunnelPanel.js';

export { localPorts, ownerText, probeTunnels } from './tunnels/status.js';
export type { PortStatus, TunnelProbe } from './tunnels/status.js';

export { EDITOR_FALLBACKS, resolveEditor, runEditor } from './term/editor.js';
export type { Editor, EditorResult } from './term/editor.js';

export { buildTunnelHelp, parseCli, parseTunnelArgs } from './cli-args.js';
export type { Cli, TunnelCommand } from './cli-args.js';
