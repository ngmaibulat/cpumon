/**
 * Colour, as a set of named roles rather than a set of colours.
 *
 * Components ask for `theme.warn` or `theme.cpu`, never for a hex value. That
 * is what makes the mono theme possible at all: it answers every one of those
 * questions with undefined, and `<Text color={undefined}>` is plain text, so a
 * sixteen-colour terminal and a monochrome one run the same components.
 *
 * Every colour is a string ink will hand to chalk, so named ANSI colours and
 * hex both work. Which one a theme uses is a property of the theme.
 */

import type { ThemeName } from '../../types/index.js';

/** four stops, from idle to saturated */
export type Ramp = readonly [string, string, string, string];


export type Theme = {
    name: Exclude<ThemeName, 'auto'>;

    border: string | undefined;
    borderFocus: string | undefined;
    title: string | undefined;
    titleFocus: string | undefined;

    label: string | undefined;
    value: string | undefined;
    muted: string | undefined;

    ok: string | undefined;
    warn: string | undefined;
    danger: string | undefined;

    cpu: Ramp;
    memory: Ramp;
    network: Ramp;
    disk: Ramp;

    /** the composition bar in the memory panel, used/buffers/cached/free */
    used: string | undefined;
    buffers: string | undefined;
    cached: string | undefined;
    free: string | undefined;

    selectionBackground: string | undefined;
    selectionForeground: string | undefined;
    /**
     * Emphasis comes from bold/dim/inverse rather than hue. Set on themes that
     * have few colours or none, so components can tell the difference between
     * "this colour is undefined" and "this theme wants no colour at all".
     */
    useAttributes: boolean;
};


const MONO_RAMP: Ramp = [undefined, undefined, undefined, undefined] as unknown as Ramp;


/**
 * Truecolor. A cool-to-hot ramp per metric, tinted so the four graphs are
 * distinguishable at a glance even when all four are near the same load.
 */
export const DEFAULT_THEME: Theme = {
    name: 'default',

    border: '#3b4252',
    borderFocus: '#88c0d0',
    title: '#81a1c1',
    titleFocus: '#88c0d0',

    label: '#8f9bb0',
    value: '#e5e9f0',
    muted: '#5c6773',

    ok: '#a3be8c',
    warn: '#ebcb8b',
    danger: '#bf616a',

    cpu: ['#5e9c8f', '#a3be8c', '#ebcb8b', '#bf616a'],
    memory: ['#5b7c99', '#81a1c1', '#ebcb8b', '#bf616a'],
    network: ['#6b7f9e', '#88c0d0', '#ebcb8b', '#bf616a'],
    disk: ['#7a6b93', '#b48ead', '#ebcb8b', '#bf616a'],

    used: '#81a1c1',
    buffers: '#b48ead',
    cached: '#5e81ac',
    free: '#3b4252',

    selectionBackground: '#3b4252',
    selectionForeground: '#eceff4',
    useAttributes: false,
};


/** the sixteen named colours, for a terminal that reported nothing better */
export const ANSI16_THEME: Theme = {
    name: 'ansi16',

    border: 'gray',
    borderFocus: 'cyan',
    title: 'blue',
    titleFocus: 'cyan',

    label: 'cyan',
    value: 'white',
    muted: 'gray',

    ok: 'green',
    warn: 'yellow',
    danger: 'red',

    cpu: ['green', 'green', 'yellow', 'red'],
    memory: ['blue', 'blue', 'yellow', 'red'],
    network: ['cyan', 'cyan', 'yellow', 'red'],
    disk: ['magenta', 'magenta', 'yellow', 'red'],

    used: 'blue',
    buffers: 'magenta',
    cached: 'cyan',
    free: 'gray',

    // no background: at sixteen colours a filled row fights the text on it,
    // and inverse reads more clearly on every terminal that has only these
    selectionBackground: undefined,
    selectionForeground: undefined,
    useAttributes: true,
};


/**
 * No colour at all. Not a degraded theme - it is what NO_COLOR asks for, and it
 * has to stay fully legible, so everything that would have been a hue becomes
 * bold, dim or inverse.
 */
export const MONO_THEME: Theme = {
    name: 'mono',

    border: undefined,
    borderFocus: undefined,
    title: undefined,
    titleFocus: undefined,

    label: undefined,
    value: undefined,
    muted: undefined,

    ok: undefined,
    warn: undefined,
    danger: undefined,

    cpu: MONO_RAMP,
    memory: MONO_RAMP,
    network: MONO_RAMP,
    disk: MONO_RAMP,

    used: undefined,
    buffers: undefined,
    cached: undefined,
    free: undefined,

    selectionBackground: undefined,
    selectionForeground: undefined,
    useAttributes: true,
};


const THEMES: Record<Exclude<ThemeName, 'auto'>, Theme> = {
    default: DEFAULT_THEME,
    ansi16: ANSI16_THEME,
    mono: MONO_THEME,
};


/**
 * Resolve a requested theme against what the terminal can show.
 *
 * An explicit choice is honoured up to the point of absurdity: asking for the
 * truecolor theme on a monochrome terminal gets the mono one, because the
 * alternative is escape sequences the terminal will print as text.
 */
export function resolveTheme(requested: ThemeName, colorLevel: 0 | 1 | 2 | 3): Theme
{
    if (colorLevel === 0) {
        return MONO_THEME;
    }

    if (requested !== 'auto') {
        return THEMES[requested];
    }

    return colorLevel >= 2 ? DEFAULT_THEME : ANSI16_THEME;
}


export const THEME_ORDER: ThemeName[] = ['auto', 'default', 'ansi16', 'mono'];


export function nextTheme(current: ThemeName): ThemeName
{
    const index = THEME_ORDER.indexOf(current);

    return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}
