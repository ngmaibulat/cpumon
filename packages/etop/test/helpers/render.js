/**
 * Rendering components to a string, for assertions.
 *
 * Tests stay plain .js with React.createElement rather than .tsx, which keeps
 * the flow identical to libsysmon's own - build, then `node --test` against the
 * built output - with no extra transpile step for the test files themselves.
 *
 * ink 7's renderToString needs no terminal and no event listeners, so there is
 * nothing to tear down and no reason for a fake-stdout harness at this level.
 */

// the suite renders without a terminal, so colour has to be asked for
import './force-color.js';

import React from 'react';
import { renderToString } from 'ink';

import { DEFAULT_THEME, MONO_THEME, SlowProvider, StoreProvider, StyleProvider, glyphsFor } from '../../dist/internal.js';


export const h = React.createElement;

export { DEFAULT_THEME, MONO_THEME };


/** strip SGR sequences, so assertions are about text and layout, not colour */
export function plain(text)
{
    return text.replace(/\[[0-9;]*m/g, '');
}


export function lines(output)
{
    return plain(output).split('\n');
}


/** the visible width of a line, in terminal cells */
export function cells(line)
{
    return [...plain(line)].length;
}


/** render a node inside a style context, since every component reads one */
export function draw(node, options = {})
{
    const {
        columns = 80,
        theme = DEFAULT_THEME,
        graph = 'block',
        unicode = true,
        continuousColor = theme === DEFAULT_THEME,
    } = options;

    const style = { theme, graph, unicode, continuousColor, glyphs: glyphsFor(unicode) };

    const stored = options.store === undefined
        ? node
        : h(StoreProvider, { value: options.store }, node);

    // the slow poller is optional in a way the store is not: a panel that never
    // reads it renders identically without a provider, which is what keeps
    // every pre-existing panel test unchanged
    const tree = options.slow === undefined
        ? stored
        : h(SlowProvider, { value: options.slow }, stored);

    return renderToString(h(StyleProvider, { value: style }, tree), { columns });
}


/**
 * A SlowPoller that only ever holds the state it was given.
 *
 * getSnapshot hands back one object by reference, for the reason fakeStore
 * documents: useSyncExternalStore compares it by identity, and a fixture that
 * rebuilt it per call would re-render forever and present as "Maximum update
 * depth exceeded" from somewhere entirely unrelated.
 */
export function fakeSlow(state = {})
{
    const frozen = { ticks: 1, ...state };

    return {
        getSnapshot: () => frozen,
        subscribe: () => () => {},
        setActive: () => {},
        dispose: () => {},
        get active() { return []; },
    };
}


/**
 * The single most valuable assertion in the suite.
 *
 * A line wider than its panel does not clip - it pushes everything after it
 * sideways, and in the alternate screen that damage persists across frames. A
 * component that respects its width cannot corrupt the frame, whatever else it
 * gets wrong.
 */
export function assertFits(assert, output, columns, label = '')
{
    for (const [i, line] of lines(output).entries()) {
        assert.ok(
            cells(line) <= columns,
            `${label}line ${i} is ${cells(line)} cells, limit ${columns}: ${JSON.stringify(line)}`,
        );
    }
}
