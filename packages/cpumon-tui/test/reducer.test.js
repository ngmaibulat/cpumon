import test from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_ORDER, clamp, initialUi, reduce } from '../dist/internal.js';


const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), ...over });

const run = (state, ...actions) => actions.reduce(reduce, state);


test('focus cycles forwards and wraps', () => {
    let state = ui({ focus: 'cpu' });

    for (const panel of [...PANEL_ORDER.slice(1), 'cpu']) {
        state = reduce(state, { type: 'focus-next', delta: 1 });
        assert.equal(state.focus, panel);
    }
});


test('focus cycles backwards and wraps the other way', () => {
    const state = reduce(ui({ focus: 'cpu' }), { type: 'focus-next', delta: -1 });

    assert.equal(state.focus, PANEL_ORDER.at(-1));
});


test('the interval halves and doubles, and stops at both ends', () => {
    let state = ui({ intervalMs: 1000 });

    state = reduce(state, { type: 'interval', delta: 'faster' });
    assert.equal(state.intervalMs, 500);

    state = reduce(state, { type: 'interval', delta: 'slower' });
    assert.equal(state.intervalMs, 1000);

    // clamped rather than allowed to run away: below ~100ms the cost of
    // sampling starts showing up in the sample
    state = run(state, ...Array(20).fill({ type: 'interval', delta: 'faster' }));
    assert.equal(state.intervalMs, 100);

    state = run(state, ...Array(20).fill({ type: 'interval', delta: 'slower' }));
    assert.equal(state.intervalMs, 10_000);
});


test('hitting the interval limit says so rather than silently doing nothing', () => {
    const state = reduce(ui({ intervalMs: 100 }), { type: 'interval', delta: 'faster' });

    assert.equal(state.intervalMs, 100);
    assert.match(state.message, /fastest/);
});


test('pause toggles', () => {
    const paused = reduce(ui(), { type: 'toggle-pause' });

    assert.equal(paused.paused, true);
    assert.equal(reduce(paused, { type: 'toggle-pause' }).paused, false);
});


test('reset puts everything back, including things left on by accident', () => {
    const messy = ui({
        paused: true,
        filter: 'postgres',
        filtering: true,
        selected: 40,
        scroll: 30,
        expanded: true,
    });

    const state = reduce(messy, { type: 'reset' });

    assert.equal(state.paused, false);
    assert.equal(state.filter, '');
    assert.equal(state.filtering, false);
    assert.equal(state.selected, 0);
    assert.equal(state.scroll, 0);
    assert.equal(state.expanded, false);
});


test('pressing a sort key twice reverses it instead of re-sorting', () => {
    // which is what every table in every tool does
    let state = reduce(ui({ sort: 'cpu' }), { type: 'sort', key: 'mem' });

    assert.equal(state.sort, 'mem');
    assert.equal(state.sortReverse, false);

    state = reduce(state, { type: 'sort', key: 'mem' });
    assert.equal(state.sort, 'mem');
    assert.equal(state.sortReverse, true);
});


test('changing the sort column returns to the top of the list', () => {
    // the row under the cursor is about to become a different process, so
    // keeping the position would be keeping nothing
    const state = reduce(ui({ selected: 30, scroll: 20 }), { type: 'sort', key: 'mem' });

    assert.equal(state.selected, 0);
    assert.equal(state.scroll, 0);
});


test('the sort column can be walked left and right, wrapping', () => {
    const order = ['pid', 'cpu', 'mem', 'threads', 'name'];

    let state = ui({ sort: 'pid' });

    for (const expected of [...order.slice(1), 'pid']) {
        state = reduce(state, { type: 'sort-shift', delta: 1 });
        assert.equal(state.sort, expected);
    }

    state = reduce(ui({ sort: 'pid' }), { type: 'sort-shift', delta: -1 });
    assert.equal(state.sort, 'name');
});


test('opening the filter remembers what was there before', () => {
    const state = reduce(ui({ filter: 'node' }), { type: 'filter-open' });

    assert.equal(state.filtering, true);
    assert.equal(state.filterBefore, 'node');
    // and focus follows, since the filter belongs to one panel
    assert.equal(state.focus, 'process');
});


test('cancelling the filter restores it rather than clearing it', () => {
    // clearing would punish someone for looking at the bar
    const state = run(
        ui({ filter: 'node' }),
        { type: 'filter-open' },
        { type: 'filter-input', text: 'x' },
        { type: 'filter-cancel' },
    );

    assert.equal(state.filter, 'node');
    assert.equal(state.filtering, false);
});


test('committing the filter closes the bar and keeps the filter', () => {
    const state = run(
        ui(),
        { type: 'filter-open' },
        { type: 'filter-input', text: 'pg' },
        { type: 'filter-commit' },
    );

    assert.equal(state.filter, 'pg');
    assert.equal(state.filtering, false);
});


test('typing in the filter returns to the top of the list', () => {
    // the row that was selected has very likely just been filtered out
    const state = reduce(ui({ selected: 12, scroll: 8 }), { type: 'filter-input', text: 'p' });

    assert.equal(state.selected, 0);
    assert.equal(state.scroll, 0);
});


test('backspace shortens the filter and stops at empty', () => {
    let state = ui({ filter: 'ab' });

    state = reduce(state, { type: 'filter-backspace' });
    assert.equal(state.filter, 'a');

    state = run(state, { type: 'filter-backspace' }, { type: 'filter-backspace' });
    assert.equal(state.filter, '');
});


test('escape closes one thing at a time, most recent first', () => {
    // an overlay over a filter over a maximised panel unwinds in that order,
    // which is the only order that does not surprise anyone
    let state = ui({ overlay: 'help', filtering: true, maximised: true });

    state = reduce(state, { type: 'escape' });
    assert.equal(state.overlay, 'none');
    assert.equal(state.filtering, true);

    state = reduce(state, { type: 'escape' });
    assert.equal(state.filtering, false);
    assert.equal(state.maximised, true);

    state = reduce(state, { type: 'escape' });
    assert.equal(state.maximised, false);
});


test('escape with nothing to close clears the message', () => {
    const state = reduce(ui({ message: 'theme mono' }), { type: 'escape' });

    assert.equal(state.message, null);
});


test('the theme and graph cycles visit every option and wrap', () => {
    let state = ui();

    const themes = [];

    for (let i = 0; i < 4; i++) {
        state = reduce(state, { type: 'cycle-theme' });
        themes.push(state.theme);
    }

    assert.deepEqual(themes, ['default', 'ansi16', 'mono', 'auto']);

    state = ui();
    const graphs = [];

    for (let i = 0; i < 4; i++) {
        state = reduce(state, { type: 'cycle-graph' });
        graphs.push(state.graph);
    }

    assert.deepEqual(graphs, ['block', 'braille', 'ascii', 'auto']);
});


test('moving the selection never goes below zero', () => {
    const state = run(ui({ selected: 1 }), { type: 'move', delta: -10 });

    assert.equal(state.selected, 0);
});


test('jumping to the last row leaves the clamping to whoever knows the count', () => {
    // the reducer has no idea how many processes there are, and guessing would
    // put the cursor somewhere real by accident
    const state = reduce(ui(), { type: 'move-to', where: 'last' });

    assert.ok(state.selected > 1_000_000);
    assert.equal(clamp(state, 7, 5).selected, 6);
});


test('clamp keeps the cursor inside the list', () => {
    assert.equal(clamp(ui({ selected: 99 }), 10, 5).selected, 9);
    assert.equal(clamp(ui({ selected: 3 }), 10, 5).selected, 3);
});


test('clamp resets to the top when the list empties', () => {
    const state = clamp(ui({ selected: 5, scroll: 3 }), 0, 5);

    assert.equal(state.selected, 0);
    assert.equal(state.scroll, 0);
});


test('clamp scrolls the window rather than moving the cursor', () => {
    // a keypress that scrolls the list must not also jump the selection
    const down = clamp(ui({ selected: 12, scroll: 0 }), 50, 10);

    assert.equal(down.selected, 12);
    assert.equal(down.scroll, 3);

    const up = clamp(ui({ selected: 2, scroll: 10 }), 50, 10);

    assert.equal(up.selected, 2);
    assert.equal(up.scroll, 2);
});


test('clamp keeps the window full when the list shrinks under it', () => {
    // a process exiting must not leave the table showing blank rows below a
    // list it could have scrolled up to fill
    const state = clamp(ui({ selected: 0, scroll: 40 }), 12, 10);

    assert.equal(state.scroll, 0);
});


test('clamp returns the same object when nothing needs changing', () => {
    // it runs on every render, and a fresh object every time would defeat the
    // memo on the table
    const state = ui({ selected: 3, scroll: 0 });

    assert.equal(clamp(state, 50, 10), state);
});


test('a selection change closes an expanded row', () => {
    // the detail belonged to the row that is no longer selected
    const state = reduce(ui({ expanded: true }), { type: 'move', delta: 1 });

    assert.equal(state.expanded, false);
});


test('every action returns a complete state', () => {
    // a reducer that drops a field turns into undefined somewhere far away
    const keys = Object.keys(ui());

    const actions = [
        { type: 'focus', panel: 'disk' },
        { type: 'focus-next', delta: 1 },
        { type: 'toggle-maximise' },
        { type: 'overlay', overlay: 'help' },
        { type: 'toggle-pause' },
        { type: 'interval', delta: 'faster' },
        { type: 'reset' },
        { type: 'cycle-theme' },
        { type: 'cycle-graph' },
        { type: 'move', delta: 1 },
        { type: 'move-to', where: 'first' },
        { type: 'sort', key: 'mem' },
        { type: 'sort-shift', delta: 1 },
        { type: 'sort-reverse' },
        { type: 'filter-open' },
        { type: 'filter-input', text: 'a' },
        { type: 'filter-backspace' },
        { type: 'filter-commit' },
        { type: 'filter-cancel' },
        { type: 'toggle-expand' },
        { type: 'interface', delta: 1 },
        { type: 'toggle-bits' },
        { type: 'escape' },
        { type: 'message', text: 'hello' },
        { type: 'quit' },
    ];

    for (const action of actions) {
        const state = reduce(ui(), action);

        assert.deepEqual(Object.keys(state).sort(), keys.sort(), action.type);
    }
});
