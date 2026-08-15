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
 * Panel bindings are checked before global ones, and only when that panel is
 * active. That is what lets the process table claim `g` for "first row" while
 * the global graph-style cycle lives on Ctrl-G.
 *
 * "Active" rather than "focused" is what makes screens cheap: see activePanel.
 */

import { SCREEN_PANEL } from './types.js';
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
    /**
     * The panel this belongs to, or the panels it is shared by; absent means
     * global.
     *
     * A list is a list: moving the cursor down a table of processes and down a
     * table of containers is one binding, not two that happen to agree. The
     * alternative was a second copy per panel, which is the same mistake as a
     * second key table - it survives exactly until someone changes one of them.
     */
    panel?: PanelId | PanelId[];
    match: (input: string, key: KeyState) => boolean;
    /** null means "matched, but there is nothing to do in this state" */
    action: (input: string, key: KeyState, state: UiState) => Action | null;
};


function binds(binding: Binding, panel: PanelId | null): boolean
{
    if (binding.panel === undefined || panel === null) {
        return false;
    }

    return Array.isArray(binding.panel) ? binding.panel.includes(panel) : binding.panel === panel;
}


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
        description: 'maximise the focused panel (dashboard only)',
        match: char('f'),
        // every other screen is already one view filling the frame; there is
        // nothing for this to do there and a message saying so would be noise
        action: (_i, _k, state) => (state.screen === 'dash' ? { type: 'toggle-maximise' } : null),
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


/**
 * Moving between screens, and between panels within the dashboard.
 *
 * Tab is the screen key because that is what a tab bar means to anyone who has
 * used a browser, and because the screens are the axis worth walking blind -
 * the panels are all visible at once on the dashboard and can be addressed
 * directly by number. Panel cycling keeps a key of its own anyway, for the
 * narrow terminals where computeLayout falls back to one panel at a time.
 */
export const SCREEN_BINDINGS: Binding[] = [
    {
        keys: 'Tab  S-Tab',
        description: 'go to the next or previous screen',
        match: (_input, key) => key.tab === true,
        action: (_i, key) => ({ type: 'screen-next', delta: key.shift === true ? -1 : 1 }),
    },
    {
        keys: '1 … 6',
        description: 'focus cpu, memory, disk, network, processes, containers (dashboard only)',
        match: (input, key) => plain(input, key, '1', '2', '3', '4', '5', '6'),
        action: (input, _k, state) => (state.screen === 'dash'
            ? { type: 'focus', panel: PANEL_KEYS[Number(input) - 1] }
            : null),
    },
    {
        keys: 'w  W',
        description: 'focus the next or previous panel (dashboard only)',
        match: char('w', 'W'),
        action: (input, _k, state) => (state.screen === 'dash'
            ? { type: 'focus-next', delta: input === 'w' ? 1 : -1 }
            : null),
    },
];


/** every panel that draws a scrollable table and therefore has a cursor */
const LIST_PANELS: PanelId[] = ['process', 'container', 'connection', 'stack', 'unit', 'tunnel'];


/** moving a cursor down a table, wherever the table happens to be */
export const LIST_BINDINGS: Binding[] = [
    {
        keys: 'j k  ↑ ↓',
        description: 'move the selection',
        panel: LIST_PANELS,
        match: (input, key) => plain(input, key, 'j', 'k') || key.upArrow === true || key.downArrow === true,
        action: (input, key) => ({ type: 'move', delta: input === 'j' || key.downArrow === true ? 1 : -1 }),
    },
    {
        keys: 'C-d C-u  PgUp PgDn',
        description: 'page the selection',
        panel: LIST_PANELS,
        match: (input, key) =>
            (key.ctrl === true && (input === 'd' || input === 'u'))
            || key.pageUp === true || key.pageDown === true,
        action: (input, key) => ({ type: 'move', delta: input === 'd' || key.pageDown === true ? 10 : -10 }),
    },
    {
        keys: 'g G  Home End',
        description: 'jump to the first or last row',
        panel: LIST_PANELS,
        match: (input, key) => plain(input, key, 'g', 'G') || key.home === true || key.end === true,
        action: (input, key) => ({
            type: 'move-to',
            where: input === 'g' || key.home === true ? 'first' : 'last',
        }),
    },
];


export const PROCESS_BINDINGS: Binding[] = [
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


export const STACK_BINDINGS: Binding[] = [
    {
        keys: 'Enter',
        description: 'collapse or expand the selected project',
        panel: 'stack',
        match: (_input, key) => key.return === true,
        // the project name is filled in by App, which is the only place that
        // knows which row the cursor has landed on - the same shape the kill
        // modal uses to pin a pid
        action: () => ({ type: 'toggle-collapse', project: '' }),
    },
];


export const UNIT_BINDINGS: Binding[] = [
    {
        keys: 'a',
        description: 'show every unit type, or just services, sockets and timers',
        panel: 'unit',
        match: char('a'),
        action: () => ({ type: 'toggle-unit-types' }),
    },
];


/**
 * The tunnels screen.
 *
 * Every key here is panel-scoped, so none of them shadows a global. The ones
 * that were considered and rejected are worth recording: `s` for "start" reads
 * well but is the process table's sort-by-threads, and teaching a finger to
 * press `s` in a list is a habit that goes wrong on the next screen. `r` and
 * `t` are global (reset, theme). `u`/`d` sit next to Ctrl-U/Ctrl-D in a
 * scrollable list, which is a trap. Enter toggling is the shape a list of
 * things you turn on and off already has.
 */
export const TUNNEL_BINDINGS: Binding[] = [
    {
        keys: 'Enter',
        description: 'start or stop the selected tunnel',
        panel: 'tunnel',
        match: (_input, key) => key.return === true,
        // the name is filled in by App, which is the only place that knows
        // which row the cursor has landed on
        action: () => ({ type: 'tunnel-toggle', name: '' }),
    },
    {
        keys: 'x',
        description: 'stop the selected tunnel',
        panel: 'tunnel',
        match: char('x'),
        action: () => ({ type: 'tunnel-stop', name: '' }),
    },
    {
        keys: 'R',
        description: 'reconnect now, clearing the backoff and any failure',
        panel: 'tunnel',
        match: char('R'),
        action: () => ({ type: 'tunnel-restart', name: '' }),
    },
    {
        keys: 'l',
        description: "show the selected tunnel's last ssh output",
        panel: 'tunnel',
        match: char('l'),
        action: () => ({ type: 'tunnel-detail', name: '' }),
    },
    {
        keys: 'e',
        description: 'edit the tunnel config in $VISUAL or $EDITOR',
        panel: 'tunnel',
        match: char('e'),
        action: () => ({ type: 'tunnel-edit' }),
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


/**
 * Lists first.
 *
 * The shared cursor keys are checked before the panel-specific ones so that a
 * panel cannot accidentally shadow `j` with something of its own without that
 * showing up as a dead binding here, in one place, rather than as a key that
 * works on one screen and not the next.
 */
export const PANEL_BINDINGS: Binding[] = [
    ...LIST_BINDINGS,
    ...PROCESS_BINDINGS,
    ...STACK_BINDINGS,
    ...UNIT_BINDINGS,
    ...TUNNEL_BINDINGS,
    ...NETWORK_BINDINGS,
    ...DISK_BINDINGS,
];

export const ALL_BINDINGS: Binding[] = [...SCREEN_BINDINGS, ...GLOBAL_BINDINGS, ...PANEL_BINDINGS];

/** everything resolve() falls through to once no panel binding matched */
const FALLTHROUGH_BINDINGS: Binding[] = [...SCREEN_BINDINGS, ...GLOBAL_BINDINGS];


/**
 * Which panel's bindings are live.
 *
 * On the dashboard every panel is on screen at once, so the answer is whichever
 * one has focus. On any other screen there is exactly one panel filling the
 * frame, and it is the screen that says which - so the process table's `j`,
 * `/`, `Enter` and `K` all work full-screen without a single duplicated
 * binding, and `ui.focus` is left holding whatever the dashboard last set,
 * untouched and waiting for the way back.
 *
 * null for a screen with no panel yet: nothing matches, and the key falls
 * through to the globals rather than being swallowed.
 */
export function activePanel(state: UiState): PanelId | null
{
    return state.screen === 'dash' ? state.focus : SCREEN_PANEL[state.screen] ?? null;
}


/**
 * Turn a key event into an action.
 *
 * The order is the contract. The filter bar swallows almost everything while
 * it is open - without that, typing "quit" into a filter would quit. Then the
 * active panel's bindings, then the screen and global ones.
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

    const panel = activePanel(state);

    for (const binding of PANEL_BINDINGS) {
        if (binds(binding, panel) && binding.match(input, key)) {
            return binding.action(input, key, state);
        }
    }

    for (const binding of FALLTHROUGH_BINDINGS) {
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
        { title: 'Screens', bindings: SCREEN_BINDINGS },
        { title: 'Anywhere', bindings: GLOBAL_BINDINGS },
        { title: 'Any list', bindings: LIST_BINDINGS },
        { title: 'Processes', bindings: PROCESS_BINDINGS },
        { title: 'Stacks', bindings: STACK_BINDINGS },
        { title: 'Units', bindings: UNIT_BINDINGS },
        { title: 'Tunnels', bindings: TUNNEL_BINDINGS },
        { title: 'Network', bindings: NETWORK_BINDINGS },
    ].filter(section => section.bindings.length > 0);
}
