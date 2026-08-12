/**
 * Theme and draw-style delivery.
 *
 * Both travel by context rather than by prop, because every leaf needs them and
 * threading them through would put two extra props on the signature of every
 * component - which in turn would defeat React.memo, since the memo comparison
 * is on primitives.
 *
 * The context value is a plain object, so a test can render a component against
 * a fake theme without touching capability detection.
 */

import { createContext, useContext } from 'react';

import { DEFAULT_THEME } from '../theme/index.js';
import type { Theme } from '../theme/index.js';
import type { GraphStyle } from '../../types/index.js';


export type DrawStyle = {
    theme: Theme;
    graph: Exclude<GraphStyle, 'auto'>;
    /** truecolor, so graph rows can be blended rather than stepped */
    continuousColor: boolean;
    /** the terminal can render box-drawing and block characters */
    unicode: boolean;
};


const DEFAULT_STYLE: DrawStyle = {
    theme: DEFAULT_THEME,
    graph: 'block',
    continuousColor: true,
    unicode: true,
};


const StyleContext = createContext<DrawStyle>(DEFAULT_STYLE);

export const StyleProvider = StyleContext.Provider;


export function useStyle(): DrawStyle
{
    return useContext(StyleContext);
}


export function useTheme(): Theme
{
    return useContext(StyleContext).theme;
}
