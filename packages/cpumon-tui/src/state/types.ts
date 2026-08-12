/**
 * The dashboard's own state - everything that is about the view rather than
 * about the machine.
 *
 * Kept apart from SnapshotStore on purpose. Sampled data arrives on a timer and
 * is read by every panel; UI state changes on a keystroke and is mostly read by
 * one. Merging them would mean a keypress in the process table invalidated the
 * memo on the CPU graph.
 */

import type { ProcessSortKey } from 'cpumon';
import type { GraphStyle, ThemeName } from '../../types/index.js';


export type PanelId = 'cpu' | 'memory' | 'disk' | 'network' | 'process' | 'container';

/** the order Tab walks, and the order the number keys map to */
export const PANEL_ORDER: PanelId[] = ['cpu', 'memory', 'disk', 'network', 'process', 'container'];


export type Overlay = 'none' | 'help' | 'kill';


export type UiState = {
    focus: PanelId;
    /** the focused panel fills the frame */
    maximised: boolean;
    overlay: Overlay;

    /** the view is frozen; the store keeps sampling underneath */
    paused: boolean;
    intervalMs: number;

    theme: ThemeName;
    graph: GraphStyle;

    /** process table */
    selected: number;
    scroll: number;
    sort: ProcessSortKey;
    sortReverse: boolean;
    /** the committed filter; empty means none */
    filter: string;
    /** the filter bar is open and taking keys */
    filtering: boolean;
    /** what the filter was before the bar opened, so Esc can restore it */
    filterBefore: string;
    /** the selected row's detail line is open */
    expanded: boolean;

    /** network panel */
    interfaceIndex: number;
    /** show throughput in bits rather than bytes */
    bits: boolean;

    /** disk panel */
    mountIndex: number;

    /** the last thing that happened, shown in the footer until the next one */
    message: string | null;
};


export type Action =
    | { type: 'quit' }
    | { type: 'focus'; panel: PanelId }
    | { type: 'focus-next'; delta: 1 | -1 }
    | { type: 'toggle-maximise' }
    | { type: 'overlay'; overlay: Overlay }
    | { type: 'toggle-pause' }
    | { type: 'interval'; delta: 'faster' | 'slower' }
    | { type: 'reset' }
    | { type: 'cycle-theme' }
    | { type: 'cycle-graph' }
    | { type: 'move'; delta: number }
    | { type: 'move-to'; where: 'first' | 'last' }
    | { type: 'sort'; key: ProcessSortKey }
    | { type: 'sort-shift'; delta: 1 | -1 }
    | { type: 'sort-reverse' }
    | { type: 'filter-open' }
    | { type: 'filter-input'; text: string }
    | { type: 'filter-backspace' }
    | { type: 'filter-commit' }
    | { type: 'filter-cancel' }
    | { type: 'toggle-expand' }
    | { type: 'interface'; delta: 1 | -1 }
    | { type: 'toggle-bits' }
    | { type: 'escape' }
    | { type: 'message'; text: string | null };


export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10_000;


export function initialUi(intervalMs: number, theme: ThemeName, graph: GraphStyle): UiState
{
    return {
        focus: 'process',
        maximised: false,
        overlay: 'none',
        paused: false,
        intervalMs,
        theme,
        graph,
        selected: 0,
        scroll: 0,
        sort: 'cpu',
        sortReverse: false,
        filter: '',
        filtering: false,
        filterBefore: '',
        expanded: false,
        interfaceIndex: 0,
        bits: false,
        mountIndex: 0,
        message: null,
    };
}
