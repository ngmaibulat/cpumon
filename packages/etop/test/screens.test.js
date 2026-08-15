/**
 * The screen axis: the tab bar that shows it, and the state that moves it.
 *
 * The fitTabs cases are the ones worth the most. A tab bar that drops the tab
 * you are standing on tells you the screen you are looking at does not exist,
 * and that failure only ever shows up at a width nobody develops at - so it is
 * asserted here at every width from one column upwards rather than eyeballed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MONO_THEME,
    SCREEN_LABELS,
    SCREEN_ORDER,
    SCREEN_PANEL,
    TabBar,
    fitTabs,
    initialUi,
    reduce,
} from '../dist/internal.js';

import { assertFits, cells, draw, h, lines } from './helpers/render.js';


const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), ...over });


/** what the bar will actually print, so a width assertion is about the real row */
function barWidth(layout)
{
    const gaps = Math.max(0, layout.tabs.length - 1) * 2;
    const labels = layout.tabs.reduce((sum, tab) => sum + tab.label.length + (tab.active ? 2 : 0), 0);
    const markers = (layout.moreBefore ? 2 : 0) + (layout.moreAfter ? 2 : 0);

    return gaps + labels + markers;
}


test('every screen has a label, and the panel map only names real panels', () => {
    for (const screen of SCREEN_ORDER) {
        assert.equal(typeof SCREEN_LABELS[screen], 'string', screen);
        assert.ok(SCREEN_LABELS[screen].length > 0, screen);
    }

    assert.equal(SCREEN_ORDER[0], 'dash', 'the dashboard is where the app starts, so it is where Tab starts');
    assert.equal(SCREEN_PANEL.dash, undefined, 'the dashboard has no single panel of its own');
    assert.deepEqual(SCREEN_PANEL, {
        proc: 'process', containers: 'container', conn: 'connection',
        stacks: 'stack', units: 'unit', wifi: 'wifi', tunnels: 'tunnel',
    });
});


test('the whole bar fits at a comfortable width', () => {
    const layout = fitTabs('dash', 120);

    assert.equal(layout.tabs.length, SCREEN_ORDER.length);
    assert.equal(layout.moreBefore, false);
    assert.equal(layout.moreAfter, false);
});


test('the active tab survives every width, and the bar never overruns', () => {
    for (const active of SCREEN_ORDER) {
        for (let width = 1; width <= 120; width++) {
            const layout = fitTabs(active, width);
            const current = layout.tabs.find(tab => tab.active);

            assert.ok(current !== undefined, `${active} at ${width}: the active tab was dropped`);
            assert.equal(current.screen, active, `${active} at ${width}`);

            // the one width where the bar is allowed to overrun is the one
            // where a single label does not fit; ink truncates it there
            if (layout.tabs.length > 1) {
                assert.ok(
                    barWidth(layout) <= width,
                    `${active} at ${width}: bar is ${barWidth(layout)} cells`,
                );
            }
        }
    }
});


test('a truncated bar says which end it cut', () => {
    // whichever screen is last: a narrow bar centred on it has to have cut the
    // left and nothing else. Taken from SCREEN_ORDER rather than named, because
    // naming it is how this test came to assert something about wifi that
    // stopped being true the moment a screen was added after it.
    const last = SCREEN_ORDER.at(-1);
    const narrow = fitTabs(last, 24);

    assert.equal(narrow.moreBefore, true);
    assert.equal(narrow.moreAfter, false);
    assert.equal(narrow.tabs.at(-1).screen, last);

    const start = fitTabs('dash', 24);

    assert.equal(start.moreBefore, false);
    assert.equal(start.moreAfter, true);
    assert.equal(start.tabs[0].screen, 'dash');
});


test('the tabs stay in screen order, without duplicates', () => {
    for (const active of SCREEN_ORDER) {
        const layout = fitTabs(active, 52);
        const order = layout.tabs.map(tab => SCREEN_ORDER.indexOf(tab.screen));

        assert.deepEqual(order, [...order].sort((a, b) => a - b), active);
        assert.equal(new Set(order).size, order.length, active);
        assert.equal(layout.tabs.filter(tab => tab.active).length, 1, active);
    }
});


test('the bar draws one row that fits, and names the screen it is on', () => {
    for (const columns of [40, 52, 80, 120]) {
        const output = draw(h(TabBar, { width: columns, screen: 'stacks' }), { columns });

        assertFits(assert, output, columns, `${columns}: `);
        assert.equal(lines(output).length, 1, `${columns}: the tab bar must be exactly one row`);
        assert.match(lines(output)[0], /stacks/, `${columns}: the active screen must be named`);
    }
});


test('the bar shows the active tab without colour, for a mono terminal', () => {
    // MONO_THEME answers every colour question with undefined, so the highlight
    // has to come from inverse video - the same fallback the selected table row
    // uses. Without it the bar is seven identical words.
    const output = draw(h(TabBar, { width: 80, screen: 'proc' }), { theme: MONO_THEME, columns: 80 });

    assert.match(output, /\[7m/, 'the active tab must invert when the theme has no selection colour');
});


test('the ascii bar uses no character a limited terminal cannot draw', () => {
    const output = draw(h(TabBar, { width: 30, screen: 'wifi' }), { unicode: false, columns: 30 });

    // eslint-disable-next-line no-control-regex
    assert.ok(!/[^\x00-\x7f]/.test(plainOf(output)), `non-ascii in ${JSON.stringify(plainOf(output))}`);
});


function plainOf(output)
{
    return lines(output).join('\n');
}


test('switching screens carries the cursor with it and leaves one behind', () => {
    // walking Tab past a screen with three rows clamps the cursor to two, and
    // coming back to a four-thousand-row process list would put you at the top
    let state = ui({ screen: 'proc', selected: 812, scroll: 800 });

    state = reduce(state, { type: 'screen', screen: 'containers' });

    assert.equal(state.screen, 'containers');
    assert.equal(state.selected, 0, 'a screen never visited starts at the top');
    assert.equal(state.scroll, 0);
    assert.deepEqual(state.savedCursors.proc, { selected: 812, scroll: 800 });

    state = reduce(state, { type: 'move', delta: 3 });
    state = reduce(state, { type: 'screen', screen: 'proc' });

    assert.equal(state.selected, 812, 'the process cursor came back');
    assert.equal(state.scroll, 800);
    assert.deepEqual(state.savedCursors.containers, { selected: 3, scroll: 0 });
});


test('switching screens closes the filter bar but keeps what it committed', () => {
    // the bar owns the keyboard while it is open; carrying it to another screen
    // would put the first keystroke there into a text box about nothing
    const state = reduce(
        ui({ screen: 'proc', filter: 'nginx', filtering: true, filterBefore: '', expanded: true }),
        { type: 'screen-next', delta: 1 },
    );

    assert.equal(state.filtering, false);
    assert.equal(state.expanded, false);
    assert.equal(state.filter, 'nginx', 'a committed filter is the process table\'s, not the bar\'s');
});


test('screen-next wraps in both directions', () => {
    let state = ui({ screen: 'dash' });

    for (const screen of [...SCREEN_ORDER.slice(1), 'dash']) {
        state = reduce(state, { type: 'screen-next', delta: 1 });
        assert.equal(state.screen, screen);
    }

    assert.equal(reduce(ui({ screen: 'dash' }), { type: 'screen-next', delta: -1 }).screen, SCREEN_ORDER.at(-1));
});


test('switching to the screen you are already on changes nothing at all', () => {
    // identity, not just equality: a stray keypress must not invalidate every
    // memo below App
    const state = ui({ screen: 'proc', selected: 4 });

    assert.equal(reduce(state, { type: 'screen', screen: 'proc' }), state);
    assert.equal(reduce(ui(), { type: 'screen-next', delta: 1 }).screen, 'proc');
});


test('Esc backs out to the dashboard once there is nothing else to close', () => {
    const state = reduce(ui({ screen: 'wifi' }), { type: 'escape' });

    assert.equal(state.screen, 'dash');

    // but only as the last rung: an overlay still closes first
    const overlay = reduce(ui({ screen: 'wifi', overlay: 'help' }), { type: 'escape' });

    assert.equal(overlay.overlay, 'none');
    assert.equal(overlay.screen, 'wifi');
});


test('every screen has a panel, so nothing draws a placeholder any more', () => {
    // this replaces the PENDING check: while screens were being built one at a
    // time, each unbuilt one had to say what it was waiting on. All seven have
    // a panel now, Placeholder.tsx is gone, and ScreenFor's default branch is a
    // `never` assertion so adding a screen without one will not compile.
    const withoutPanel = SCREEN_ORDER.filter(screen => screen !== 'dash' && SCREEN_PANEL[screen] === undefined);

    assert.deepEqual(withoutPanel, []);
});


test('a tab bar at a width with no room for tabs still says where you are', () => {
    const layout = fitTabs('stacks', 3);

    assert.equal(layout.tabs.length, 1);
    assert.equal(layout.tabs[0].active, true);
    assert.equal(layout.tabs[0].screen, 'stacks');

    assert.deepEqual(fitTabs('dash', 0), { tabs: [], moreBefore: false, moreAfter: false });
});


test('cells() agrees with the bar about how wide it drew', () => {
    // fitTabs reasons in columns; the component prints strings. This is the
    // join between the two, and it is where an off-by-one in the padding of the
    // active tab would show up
    for (const columns of [41, 47, 53, 61, 71]) {
        const output = draw(h(TabBar, { width: columns, screen: 'containers' }), { columns });

        assert.ok(cells(lines(output)[0]) <= columns, `${columns}: ${JSON.stringify(lines(output)[0])}`);
    }
});
