/**
 * The dashboard's own state - everything that is about the view rather than
 * about the machine.
 *
 * Kept apart from SnapshotStore on purpose. Sampled data arrives on a timer and
 * is read by every panel; UI state changes on a keystroke and is mostly read by
 * one. Merging them would mean a keypress in the process table invalidated the
 * memo on the CPU graph.
 */

import type { ProcessSortKey } from 'libsysmon';
import { DEFAULT_SIGNAL } from './signals.js';
import type { SignalName } from './signals.js';
import type { GraphStyle, ThemeName } from '../../types/index.js';


export type PanelId = 'cpu' | 'memory' | 'disk' | 'network' | 'process' | 'container' | 'connection' | 'stack' | 'unit' | 'wifi';

/**
 * The order `w` walks, and the order the number keys map to.
 *
 * Not every PanelId belongs here. This array is the *dashboard's* tile order,
 * so a panel that exists only as a full-height screen - 'connection' is the
 * first - is deliberately absent: adding it would put a connections tile on the
 * dashboard and shift the number keys, neither of which is wanted. A screen
 * registers itself in SCREEN_PANEL below, not here.
 */
export const PANEL_ORDER: PanelId[] = ['cpu', 'memory', 'disk', 'network', 'process', 'container'];


/**
 * A whole-frame view.
 *
 * The axis above panels. 'dash' is the tiled dashboard - every other screen is
 * one list filling the frame, because a list is worthless in a four-row tile
 * and useLayout already drops bands once rows/bands falls under four. Adding
 * units, stacks, connections and wifi as panels would mostly have added things
 * that get dropped.
 */
export type ScreenId = 'dash' | 'proc' | 'units' | 'containers' | 'stacks' | 'conn' | 'wifi';

/** the order Tab walks, and the order the tab bar shows */
export const SCREEN_ORDER: ScreenId[] = ['dash', 'proc', 'units', 'containers', 'stacks', 'conn', 'wifi'];

/** short enough that all seven fit the minimum eighty-column terminal */
export const SCREEN_LABELS: Record<ScreenId, string> = {
    dash: 'dash',
    proc: 'proc',
    units: 'units',
    containers: 'cont',
    stacks: 'stacks',
    conn: 'conn',
    wifi: 'wifi',
};

/**
 * Which panel a screen is showing, when it is showing one.
 *
 * This is what lets a full-screen view reuse a panel's bindings verbatim: the
 * keymap resolves panel bindings against the *active* panel, which on 'dash' is
 * whatever has focus and elsewhere is whatever the screen is about. Without it
 * every process binding would need a duplicate entry for the proc screen, and a
 * help overlay generated from two tables that agree by convention is exactly
 * the thing this codebase refuses to have.
 *
 * The dashboard is absent on purpose - it has no single panel of its own - as
 * are the screens whose collectors do not exist yet.
 */
export const SCREEN_PANEL: Partial<Record<ScreenId, PanelId>> = {
    proc: 'process',
    containers: 'container',
    conn: 'connection',
    stacks: 'stack',
    units: 'unit',
    // deliberately not in LIST_PANELS: the scan list has no cursor, because
    // the only thing a cursor would be for is connecting, and that is an
    // action this screen does not have. See plans/05-wifi-iwd.md.
    wifi: 'wifi',
};


/** where the cursor was on a screen that is not currently showing */
export type Cursor = {
    selected: number;
    scroll: number;
};


export type Overlay = 'none' | 'help' | 'kill';


export type KillTarget = {
    pid: number;
    comm: string;
    threads: number;
};


export type UiState = {
    /** the whole-frame view; Tab walks these */
    screen: ScreenId;
    /**
     * Where the cursor was on each screen that has been left.
     *
     * Selection itself stays a single flat `selected`/`scroll` pair, so no
     * existing action has to learn what a screen is - only the switch saves the
     * outgoing pair and restores the incoming one. Without this, tabbing past a
     * screen with three rows clamps the cursor to two, and coming back to a
     * four-thousand-row process list puts you at the top of it.
     */
    savedCursors: Partial<Record<ScreenId, Cursor>>;

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

    /**
     * Compose projects whose services are hidden, by project name.
     *
     * Collapsed rather than expanded, so the default - an empty object - shows
     * everything. Keyed by name rather than by row index because the list is
     * resampled every few seconds and a project appearing or leaving must not
     * silently fold a different one.
     */
    collapsed: Record<string, true>;

    /**
     * The units screen is showing every unit type, not just the interesting few.
     *
     * Off by default because a real machine has 475 loaded units and 179 of them
     * are .device and .mount entries nobody opened this screen to read.
     */
    allUnitTypes: boolean;

    /** network panel */
    interfaceIndex: number;
    /** show throughput in bits rather than bytes */
    bits: boolean;

    /** disk panel */
    mountIndex: number;

    /** which signal the kill modal has highlighted */
    signal: SignalName;
    /**
     * What the modal is confirming, captured whole when it opened.
     *
     * Pinned rather than re-read from the selection at confirm time, and it
     * carries the name as well as the pid so that the thing on screen and the
     * thing that gets signalled are the same object. The table underneath is
     * still sampling; without this, a row arriving or leaving between opening
     * the modal and pressing y would mean confirming one process and killing
     * another.
     */
    killTarget: KillTarget | null;

    /** the last thing that happened, shown in the footer until the next one */
    message: string | null;
};


export type Action =
    | { type: 'quit' }
    | { type: 'screen'; screen: ScreenId }
    | { type: 'screen-next'; delta: 1 | -1 }
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
    | { type: 'toggle-collapse'; project: string }
    | { type: 'toggle-unit-types' }
    | { type: 'interface'; delta: 1 | -1 }
    | { type: 'toggle-bits' }
    | { type: 'escape' }
    | { type: 'kill-open'; target: KillTarget | null }
    | { type: 'kill-move'; delta: 1 | -1 }
    | { type: 'kill-close' }
    | { type: 'message'; text: string | null }
    /**
     * Bring selection and scroll into range.
     *
     * Dispatched by the process panel, which is the only thing that knows how
     * many rows there are and how many fit. It is an action rather than a
     * correction applied around the reducer so that there is exactly one piece
     * of state: with two, a keypress would act on the unclamped copy while the
     * table rendered the clamped one, and `G` followed by `k` would move from
     * a row that was never displayed.
     */
    | { type: 'clamp'; rowCount: number; windowRows: number };


export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10_000;


export function initialUi(intervalMs: number, theme: ThemeName, graph: GraphStyle): UiState
{
    return {
        screen: 'dash',
        savedCursors: {},
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
        collapsed: {},
        allUnitTypes: false,
        interfaceIndex: 0,
        bits: false,
        mountIndex: 0,
        signal: DEFAULT_SIGNAL,
        killTarget: null,
        message: null,
    };
}
