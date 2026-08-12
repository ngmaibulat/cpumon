/**
 * Keys to actions.
 *
 * One table drives both dispatch and the help overlay. Not two that agree by
 * convention - a help screen documenting a key that does nothing is worse than
 * no help screen, and that is what a second table decays into.
 *
 * `resolve` is pure: (input, key, state) in, Action or null out. No ink, no
 * terminal, no timers. With the reducer that makes the whole keyboard testable
 * as a table of values, which is the highest-leverage decision in the
 * dashboard.
 *
 * Panel bindings are checked before global ones, and only when that panel has
 * focus. That is what lets the process table claim `g` for "first row" while
 * the global graph-style cycle lives on Ctrl-G.
 */

import type { Action, PanelId, UiState } from './types.js';


/** the subset of ink's Key that any binding looks at */
export type KeyState = {
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    escape?: boolean;
    return?: boolean;
    tab?: boolean;
    backspace?: boolean;
    delete?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    pageUp?: boolean;
    pageDown?: boolean;
    f1?: boolean;
    home?: boolean;
    end?: boolean;
};


export type Binding = {
    /** how the key is written in the help overlay */
    keys: string;
    description: string;
    /** the panel this belongs to; absent means global */
    panel?: PanelId;
    match: (input: string, key: KeyState) => boolean;
    /** null means "matched, but there is nothing to do in this state" */
    action: (input: string, key: KeyState, state: UiState) => Action | null;
};


/**
 * A modifier-free keypress.
 *
 * Every bare-character binding has to go through this. Ink reports Ctrl-C as
 * input 'c' with key.ctrl set, so a matcher that only looks at the character
 * claims the chord too - and since panel bindings are checked first, the
 * process table's `c` (sort by cpu) would swallow Ctrl-C and the dashboard
 * could not be quit from its own default panel. Ctrl-G was the same story
 * against `g`.
 */
export function plain(input: string, key: KeyState, ...chars: string[]): boolean
{
    if (key.ctrl === true || key.meta === true) {
        return false;
    }

    return chars.includes(input);
}


const char = (...chars: string[]) => (input: string, key: KeyState) => plain(input, key, ...chars);

const ctrl = (letter: string) => (input: string, key: KeyState) => key.ctrl === true && input === letter;


const PANEL_KEYS: PanelId[] = ['cpu', 'memory', 'disk', 'network', 'process', 'container'];

const SORT_KEYS = { c: 'cpu', m: 'mem', p: 'pid', n: 'name', s: 'threads' } as const;


export const GLOBAL_BINDINGS: Binding[] = [
    {
        keys: 'q  C-c',
        description: 'quit',
        match: (input, key) => plain(input, key, 'q') || (key.ctrl === true && input === 'c'),
        action: () => ({ type: 'quit' }),
    },
    {
        keys: '?  F1',
        description: 'show or hide this help',
        match: (input, key) => plain(input, key, '?') || key.f1 === true,
        action: (_i, _k, state) => ({ type: 'overlay', overlay: state.overlay === 'help' ? 'none' : 'help' }),
    },
    {
        keys: 'Esc',
        description: 'close an overlay, cancel a filter, unmaximise',
        match: (_input, key) => key.escape === true,
        action: () => ({ type: 'escape' }),
    },
    {
        keys: 'Tab  S-Tab',
        description: 'focus the next or previous panel',
        match: (_input, key) => key.tab === true,
        action: (_i, key) => ({ type: 'focus-next', delta: key.shift === true ? -1 : 1 }),
    },
    {
        keys: '1 … 6',
        description: 'focus cpu, memory, disk, network, processes, containers',
        match: (input, key) => plain(input, key, '1', '2', '3', '4', '5', '6'),
        action: input => ({ type: 'focus', panel: PANEL_KEYS[Number(input) - 1] }),
    },
    {
        keys: 'Space',
        description: 'freeze the view; sampling continues underneath',
        match: char(' '),
        action: () => ({ type: 'toggle-pause' }),
    },
    {
        keys: '+  -',
        description: 'halve or double the sampling interval',
        match: char('+', '=', '-'),
        action: input => ({ type: 'interval', delta: input === '-' ? 'slower' : 'faster' }),
    },
    {
        keys: 'f',
        description: 'maximise the focused panel',
        match: char('f'),
        action: () => ({ type: 'toggle-maximise' }),
    },
    {
        keys: 'r',
        description: 'clear history, unpause, drop the filter',
        match: char('r'),
        action: () => ({ type: 'reset' }),
    },
    {
        keys: 't',
        description: 'cycle the colour theme',
        match: char('t'),
        action: () => ({ type: 'cycle-theme' }),
    },
    {
        keys: 'C-g',
        description: 'cycle the graph style: block, braille, ascii',
        match: ctrl('g'),
        action: () => ({ type: 'cycle-graph' }),
    },
];


export const PROCESS_BINDINGS: Binding[] = [
    {
        keys: 'j k  ↑ ↓',
        description: 'move the selection',
        panel: 'process',
        match: (input, key) => plain(input, key, 'j', 'k') || key.upArrow === true || key.downArrow === true,
        action: (input, key) => ({ type: 'move', delta: input === 'j' || key.downArrow === true ? 1 : -1 }),
    },
    {
        keys: 'C-d C-u  PgUp PgDn',
        description: 'page the selection',
        panel: 'process',
        match: (input, key) =>
            (key.ctrl === true && (input === 'd' || input === 'u'))
            || key.pageUp === true || key.pageDown === true,
        action: (input, key) => ({ type: 'move', delta: input === 'd' || key.pageDown === true ? 10 : -10 }),
    },
    {
        keys: 'g G  Home End',
        description: 'jump to the first or last row',
        panel: 'process',
        match: (input, key) => plain(input, key, 'g', 'G') || key.home === true || key.end === true,
        action: (input, key) => ({
            type: 'move-to',
            where: input === 'g' || key.home === true ? 'first' : 'last',
        }),
    },
    {
        keys: 'c m p n s',
        description: 'sort by cpu, memory, pid, name, threads',
        panel: 'process',
        match: (input, key) => plain(input, key, ...Object.keys(SORT_KEYS)),
        action: input => ({ type: 'sort', key: SORT_KEYS[input as keyof typeof SORT_KEYS] }),
    },
    {
        keys: '< >',
        description: 'move the sort one column left or right',
        panel: 'process',
        match: char('<', '>'),
        action: input => ({ type: 'sort-shift', delta: input === '<' ? -1 : 1 }),
    },
    {
        keys: 'R',
        description: 'reverse the sort',
        panel: 'process',
        match: char('R'),
        action: () => ({ type: 'sort-reverse' }),
    },
    {
        keys: '/',
        description: 'filter by name',
        panel: 'process',
        match: char('/'),
        action: () => ({ type: 'filter-open' }),
    },
    {
        keys: 'Enter',
        description: 'expand the selected row',
        panel: 'process',
        match: (_input, key) => key.return === true,
        action: () => ({ type: 'toggle-expand' }),
    },
    {
        keys: 'K',
        description: 'send a signal to the selected process',
        panel: 'process',
        // shift, not plain k: k is vim-up, and a mis-held modifier must not be
        // catastrophic
        match: char('K'),
        action: () => ({ type: 'overlay', overlay: 'kill' }),
    },
];


export const NETWORK_BINDINGS: Binding[] = [
    {
        keys: '← →',
        description: 'cycle the interface',
        panel: 'network',
        match: (_input, key) => key.leftArrow === true || key.rightArrow === true,
        action: (_input, key) => ({ type: 'interface', delta: key.rightArrow === true ? 1 : -1 }),
    },
    {
        keys: 'u',
        description: 'show throughput in bits or bytes',
        panel: 'network',
        match: char('u'),
        action: () => ({ type: 'toggle-bits' }),
    },
];


export const DISK_BINDINGS: Binding[] = [];


export const PANEL_BINDINGS: Binding[] = [...PROCESS_BINDINGS, ...NETWORK_BINDINGS, ...DISK_BINDINGS];

export const ALL_BINDINGS: Binding[] = [...GLOBAL_BINDINGS, ...PANEL_BINDINGS];


/**
 * Turn a key event into an action.
 *
 * The order is the contract. The filter bar swallows almost everything while
 * it is open - without that, typing "quit" into a filter would quit. Then the
 * focused panel's bindings, then the globals.
 */
export function resolve(input: string, key: KeyState, state: UiState): Action | null
{
    if (state.overlay === 'kill') {
        // the modal owns every key while it is up; see KillModal
        return null;
    }

    if (state.filtering) {
        return resolveFiltering(input, key);
    }

    if (state.overlay !== 'none') {
        return resolveOverlay(input, key, state);
    }

    for (const binding of PANEL_BINDINGS) {
        if (binding.panel === state.focus && binding.match(input, key)) {
            return binding.action(input, key, state);
        }
    }

    for (const binding of GLOBAL_BINDINGS) {
        if (binding.match(input, key)) {
            return binding.action(input, key, state);
        }
    }

    return null;
}


/**
 * While the filter bar has the keyboard, nearly everything is text.
 *
 * Ctrl-C is the exception: an input that can trap someone with no way out is
 * not an input, it is a hostage situation.
 */
function resolveFiltering(input: string, key: KeyState): Action | null
{
    if (key.escape === true) {
        return { type: 'filter-cancel' };
    }

    if (key.return === true) {
        return { type: 'filter-commit' };
    }

    if (key.backspace === true || key.delete === true) {
        return { type: 'filter-backspace' };
    }

    if (key.ctrl === true && input === 'c') {
        return { type: 'quit' };
    }

    if (input.length > 0 && key.ctrl !== true && key.meta !== true) {
        return { type: 'filter-input', text: input };
    }

    return null;
}


/** an overlay is modal for everything but closing it and quitting */
function resolveOverlay(input: string, key: KeyState, state: UiState): Action | null
{
    if (key.escape === true) {
        return { type: 'escape' };
    }

    if (input === 'q' || (key.ctrl === true && input === 'c')) {
        return { type: 'quit' };
    }

    if (input === '?' || key.f1 === true) {
        return { type: 'overlay', overlay: 'none' };
    }

    void state;

    return null;
}


/** the help overlay's contents, grouped the way it displays them */
export function helpSections(): { title: string; bindings: Binding[] }[]
{
    return [
        { title: 'Anywhere', bindings: GLOBAL_BINDINGS },
        { title: 'Processes', bindings: PROCESS_BINDINGS },
        { title: 'Network', bindings: NETWORK_BINDINGS },
    ].filter(section => section.bindings.length > 0);
}
