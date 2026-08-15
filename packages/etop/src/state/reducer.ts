/**
 * The UI state machine.
 *
 * Pure: no ink, no terminal, no timers, no store. Every interaction the
 * dashboard has is a value in and a value out, which is what makes the
 * keyboard testable without a pty.
 *
 * The reducer does not know how many rows the process table has - that depends
 * on data and on the panel's height, neither of which belongs in here. It
 * clamps what it can (never below zero) and the panel dispatches 'clamp' with
 * the real figures once it knows them. Selection is therefore briefly out of
 * range between a keypress and the next render, which is why 'move-to last'
 * can set an index no list could contain.
 */

import { PANEL_ORDER, SCREEN_ORDER, SCREEN_PANEL } from './types.js';
import { MAX_INTERVAL_MS, MIN_INTERVAL_MS } from './types.js';
import { nextTheme } from '../theme/index.js';
import { DEFAULT_SIGNAL, SIGNALS } from './signals.js';
import type { Action, PanelId, ScreenId, UiState } from './types.js';
import type { GraphStyle } from '../../types/index.js';


const GRAPH_ORDER: GraphStyle[] = ['auto', 'block', 'braille', 'ascii'];

/** the columns `<` and `>` walk, in the order the table shows them */
const SORT_ORDER = ['pid', 'cpu', 'mem', 'threads', 'name'] as const;


export function reduce(state: UiState, action: Action): UiState
{
    switch (action.type) {
        case 'screen':
            return toScreen(state, action.screen);

        case 'screen-next': {
            const index = SCREEN_ORDER.indexOf(state.screen);
            const next = SCREEN_ORDER[(index + action.delta + SCREEN_ORDER.length) % SCREEN_ORDER.length];

            return toScreen(state, next);
        }

        case 'focus':
            return { ...state, focus: action.panel, message: null };

        case 'focus-next': {
            const index = PANEL_ORDER.indexOf(state.focus);
            const next = PANEL_ORDER[(index + action.delta + PANEL_ORDER.length) % PANEL_ORDER.length];

            return { ...state, focus: next, message: null };
        }

        case 'toggle-maximise':
            return { ...state, maximised: !state.maximised };

        case 'overlay':
            return { ...state, overlay: action.overlay };

        case 'toggle-pause':
            return { ...state, paused: !state.paused, message: null };

        case 'interval': {
            // doubling rather than stepping: the useful range spans two orders
            // of magnitude, and a linear step would need thirty presses to
            // cross it
            const raw = action.delta === 'faster'
                ? Math.round(state.intervalMs / 2)
                : state.intervalMs * 2;

            const intervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, raw));

            return {
                ...state,
                intervalMs,
                message: intervalMs === state.intervalMs
                    ? `interval is already at its ${action.delta === 'faster' ? 'fastest' : 'slowest'}`
                    : `interval ${intervalMs}ms`,
            };
        }

        case 'reset':
            // "put it back how it was", which includes un-pausing and dropping
            // a filter someone forgot they had left on
            return {
                ...state,
                paused: false,
                filter: '',
                filtering: false,
                filterBefore: '',
                selected: 0,
                scroll: 0,
                expanded: false,
                message: 'history cleared',
            };

        case 'cycle-theme': {
            const theme = nextTheme(state.theme);

            return { ...state, theme, message: `theme ${theme}` };
        }

        case 'cycle-graph': {
            const index = GRAPH_ORDER.indexOf(state.graph);
            const graph = GRAPH_ORDER[(index + 1) % GRAPH_ORDER.length];

            return { ...state, graph, message: `graphs ${graph}` };
        }

        case 'move':
            return {
                ...state,
                // the lower bound is real; the upper one belongs to whoever
                // knows how many rows there are
                selected: Math.max(0, state.selected + action.delta),
                expanded: false,
            };

        case 'move-to':
            return action.where === 'first'
                ? { ...state, selected: 0, scroll: 0, expanded: false }
                // a deliberately unreachable index, clamped by the panel to the
                // real last row - the reducer must not guess at the row count
                : { ...state, selected: Number.MAX_SAFE_INTEGER, expanded: false };

        case 'sort':
            // pressing the current column's key reverses it, which is what
            // every table in every tool does
            return state.sort === action.key
                ? { ...state, sortReverse: !state.sortReverse, message: null }
                : { ...state, sort: action.key, sortReverse: false, selected: 0, scroll: 0, message: null };

        case 'sort-shift': {
            const index = SORT_ORDER.indexOf(state.sort as (typeof SORT_ORDER)[number]);
            const next = SORT_ORDER[(index + action.delta + SORT_ORDER.length) % SORT_ORDER.length];

            return { ...state, sort: next, sortReverse: false, selected: 0, scroll: 0, message: null };
        }

        case 'sort-reverse':
            return { ...state, sortReverse: !state.sortReverse };

        case 'filter-open':
            return {
                ...state,
                filtering: true,
                // remembered so Esc can put it back rather than clearing it,
                // which would punish someone for looking at the bar
                filterBefore: state.filter,
                // the panel the filter belongs to, not always the process one.
                // On the dashboard that is whatever has focus already, so this
                // is only ever a change on a full-screen list - which is the
                // case that was wrong: opening the filter on the units screen
                // used to move the dashboard's focus to the process table.
                focus: SCREEN_PANEL[state.screen] ?? state.focus,
                message: null,
            };

        case 'filter-input':
            return { ...state, filter: state.filter + action.text, selected: 0, scroll: 0 };

        case 'filter-backspace':
            return { ...state, filter: state.filter.slice(0, -1), selected: 0, scroll: 0 };

        case 'filter-commit':
            // the bar closes and the filter stays applied
            return { ...state, filtering: false, filterBefore: '' };

        case 'filter-cancel':
            return { ...state, filtering: false, filter: state.filterBefore, filterBefore: '', selected: 0, scroll: 0 };

        case 'toggle-expand':
            return { ...state, expanded: !state.expanded };

        case 'toggle-collapse': {
            // an empty project is the panel saying the cursor is on no row it
            // owns - nothing to fold, and folding "" would create a phantom key
            if (action.project === '') {
                return state;
            }

            const collapsed = { ...state.collapsed };

            if (collapsed[action.project] === true) {
                delete collapsed[action.project];
            }
            else {
                collapsed[action.project] = true;
            }

            return { ...state, collapsed };
        }

        /**
         * The three that do nothing here.
         *
         * Starting, stopping and reconnecting a tunnel are effects on the
         * machine, not on the view, and App performs them against the
         * supervisor before it dispatches - the same interception the kill
         * modal already uses to pin a pid. They are listed rather than swept
         * into a default so that the exhaustiveness check still covers the
         * Action union: a new action must be handled or explicitly waved
         * through, never quietly ignored.
         */
        case 'tunnel-toggle':
        case 'tunnel-stop':
        case 'tunnel-restart':
        case 'tunnel-edit':
            return state;

        case 'tunnel-detail':
            // an empty name is the placeholder the binding emits when no row is
            // selected; toggling on it would open a detail for nothing
            if (action.name === '') {
                return state;
            }

            return {
                ...state,
                tunnelDetail: state.tunnelDetail === action.name ? null : action.name,
            };

        case 'toggle-unit-types':
            return {
                ...state,
                allUnitTypes: !state.allUnitTypes,
                // the list length changes under the cursor, so start from the
                // top rather than leaving it somewhere arbitrary
                selected: 0,
                scroll: 0,
                message: state.allUnitTypes ? 'showing service, socket and timer units' : 'showing all unit types',
            };

        case 'interface':
            return { ...state, interfaceIndex: Math.max(0, state.interfaceIndex + action.delta) };

        case 'toggle-bits':
            return { ...state, bits: !state.bits, message: `throughput in ${state.bits ? 'bytes' : 'bits'}` };

        case 'escape':
            // one key, in priority order: whatever is most "on top" closes
            if (state.overlay === 'kill') {
                return reduce(state, { type: 'kill-close' });
            }

            if (state.overlay !== 'none') {
                return { ...state, overlay: 'none' };
            }

            if (state.filtering) {
                return reduce(state, { type: 'filter-cancel' });
            }

            if (state.maximised) {
                return { ...state, maximised: false };
            }

            // the last rung: a screen is the outermost thing you can be "in",
            // so Esc backs all the way out to the dashboard rather than needing
            // up to three Tab presses to walk there. toScreen clears the message
            // on the way, which is what the final rung did before this one
            // existed
            if (state.screen !== 'dash') {
                return toScreen(state, 'dash');
            }

            return { ...state, message: null };

        case 'kill-open':
            return {
                ...state,
                overlay: 'kill',
                // pinned now, not re-read from the selection at confirm time
                killTarget: action.target,
                // always back to the safe default: a SIGKILL chosen for one
                // process must not be waiting, pre-selected, for the next
                signal: DEFAULT_SIGNAL,
                message: null,
            };

        case 'kill-move': {
            const index = SIGNALS.findIndex(item => item.name === state.signal);
            const next = SIGNALS[(index + action.delta + SIGNALS.length) % SIGNALS.length];

            return { ...state, signal: next.name };
        }

        case 'kill-close':
            return { ...state, overlay: 'none', killTarget: null, signal: DEFAULT_SIGNAL };

        case 'message':
            return { ...state, message: action.text };

        case 'clamp':
            return clamp(state, action.rowCount, action.windowRows);

        case 'quit':
            return state;
    }
}


/**
 * Move to another screen, taking the cursor with you and leaving one behind.
 *
 * The filter bar closes rather than following: it is a modal that owns the
 * keyboard, and carrying it across a screen switch would mean the first
 * keystroke on the new screen lands in a text box that is no longer visibly
 * about anything. The committed filter itself is left alone, since only the
 * process table reads it.
 *
 * Returning `state` unchanged for a same-screen switch keeps the identity
 * stable, so a stray keypress does not invalidate every memo below App.
 */
function toScreen(state: UiState, screen: ScreenId): UiState
{
    if (screen === state.screen) {
        return state;
    }

    const restored = state.savedCursors[screen] ?? { selected: 0, scroll: 0 };

    return {
        ...state,
        screen,
        savedCursors: {
            ...state.savedCursors,
            [state.screen]: { selected: state.selected, scroll: state.scroll },
        },
        selected: restored.selected,
        scroll: restored.scroll,
        // the detail line belongs to the row it was opened on, and that row is
        // not on screen any more
        expanded: false,
        tunnelDetail: null,
        filtering: false,
        filterBefore: '',
        message: null,
    };
}


/**
 * Bring selection and scroll into range once the row count and window height
 * are known.
 *
 * Separate from the reducer because it needs facts the reducer does not have,
 * and because it runs on every render rather than on every action - a list that
 * shrinks under a stationary cursor has to move the cursor without a keypress.
 */
export function clamp(state: UiState, rowCount: number, windowRows: number): UiState
{
    if (rowCount === 0) {
        return state.selected === 0 && state.scroll === 0
            ? state
            : { ...state, selected: 0, scroll: 0 };
    }

    const selected = Math.max(0, Math.min(rowCount - 1, state.selected));
    const rows = Math.max(1, windowRows);

    // keep the cursor inside the window, moving the window rather than the
    // cursor - a keypress that scrolls the list should not also jump the
    // selection somewhere else
    let scroll = Math.max(0, Math.min(state.scroll, Math.max(0, rowCount - rows)));

    if (selected < scroll) {
        scroll = selected;
    }
    else if (selected >= scroll + rows) {
        scroll = selected - rows + 1;
    }

    if (selected === state.selected && scroll === state.scroll) {
        return state;
    }

    return { ...state, selected, scroll };
}


export function panelIndex(panel: PanelId): number
{
    return PANEL_ORDER.indexOf(panel);
}
