/**
 * The UI state machine.
 *
 * Pure: no ink, no terminal, no timers, no store. Every interaction the
 * dashboard has is a value in and a value out, which is what makes the
 * keyboard testable without a pty.
 *
 * The reducer does not know how many rows the process table has - that depends
 * on data and on the panel's height, neither of which belongs in here. Instead
 * it clamps optimistically and the panel corrects it via `clamp()` once it
 * knows. Selection therefore cannot be trusted to be in range mid-reduce, only
 * after the panel has seen it.
 */

import { PANEL_ORDER } from './types.js';
import { MAX_INTERVAL_MS, MIN_INTERVAL_MS } from './types.js';
import { nextTheme } from '../theme/index.js';
import type { Action, PanelId, UiState } from './types.js';
import type { GraphStyle } from '../../types/index.js';


const GRAPH_ORDER: GraphStyle[] = ['auto', 'block', 'braille', 'ascii'];

/** the columns `<` and `>` walk, in the order the table shows them */
const SORT_ORDER = ['pid', 'cpu', 'mem', 'threads', 'name'] as const;


export function reduce(state: UiState, action: Action): UiState
{
    switch (action.type) {
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
                focus: 'process',
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

        case 'interface':
            return { ...state, interfaceIndex: Math.max(0, state.interfaceIndex + action.delta) };

        case 'toggle-bits':
            return { ...state, bits: !state.bits, message: `throughput in ${state.bits ? 'bytes' : 'bits'}` };

        case 'escape':
            // one key, in priority order: whatever is most "on top" closes
            if (state.overlay !== 'none') {
                return { ...state, overlay: 'none' };
            }

            if (state.filtering) {
                return reduce(state, { type: 'filter-cancel' });
            }

            if (state.maximised) {
                return { ...state, maximised: false };
            }

            return { ...state, message: null };

        case 'message':
            return { ...state, message: action.text };

        case 'quit':
            return state;
    }
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
