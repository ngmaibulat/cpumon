import test from 'node:test';
import assert from 'node:assert/strict';

import { GAP, cell, fit, row } from '../dist/internal.js';


const COLUMNS = [
    { key: 'pid', header: 'PID', align: 'right', min: 5, priority: 90 },
    { key: 'cpu', header: '%CPU', align: 'right', min: 5, priority: 100 },
    { key: 'mem', header: 'MEM', align: 'right', min: 7, priority: 60 },
    { key: 'thr', header: 'THR', align: 'right', min: 3, priority: 20 },
    { key: 'comm', header: 'COMMAND', align: 'left', min: 8, flex: true, priority: 80 },
];


const total = fitted => fitted.widths.reduce((sum, w) => sum + w, 0)
    + Math.max(0, fitted.columns.length - 1) * GAP;


test('the widths fill the available space exactly, at every width', () => {
    // this is the invariant that keeps a table from being the thing that
    // overflows and shifts every line below it
    for (let width = 1; width <= 200; width++) {
        const fitted = fit(COLUMNS, width);

        if (fitted.columns.length === 0) {
            continue;
        }

        assert.equal(total(fitted), width, `width ${width}`);
    }
});


test('a wide terminal shows every column', () => {
    const fitted = fit(COLUMNS, 120);

    assert.equal(fitted.columns.length, COLUMNS.length);
    assert.deepEqual(fitted.dropped, []);
});


test('the flexible column absorbs the slack', () => {
    const narrow = fit(COLUMNS, 60);
    const wide = fit(COLUMNS, 120);

    const commAt = wide.columns.findIndex(column => column.key === 'comm');

    assert.equal(wide.widths[commAt] - narrow.widths[commAt], 60);

    // and every other column is unchanged, so the numbers do not drift about
    // as the terminal is resized
    for (let i = 0; i < wide.columns.length; i++) {
        if (i !== commAt) {
            assert.equal(wide.widths[i], narrow.widths[i], wide.columns[i].key);
        }
    }
});


test('columns are dropped cheapest first', () => {
    // THR at priority 20 goes before MEM at 60, which goes before COMMAND at 80
    const dropped = width => fit(COLUMNS, width).dropped.map(column => column.key);

    assert.deepEqual(dropped(60), []);
    assert.deepEqual(dropped(30), ['thr']);
    assert.deepEqual(dropped(24), ['mem', 'thr']);
});


test('the last column standing is the most valuable one', () => {
    // %CPU at 100 is the headline number; a one-column table showing THR would
    // be worse than no table
    const fitted = fit(COLUMNS, 6);

    assert.equal(fitted.columns.length, 1);
    assert.equal(fitted.columns[0].key, 'cpu');
});


test('surviving columns keep their original order', () => {
    // dropping is by priority, but the layout is by declaration - a table whose
    // columns reorder themselves as it narrows is unreadable
    const fitted = fit(COLUMNS, 30);

    assert.deepEqual(fitted.columns.map(c => c.key), ['pid', 'cpu', 'mem', 'comm']);
});


test('a width below even one minimum clamps rather than showing nothing', () => {
    // a truncated %CPU is still the number someone opened the panel for, and
    // the width invariant has to hold either way
    const fitted = fit(COLUMNS, 3);

    assert.deepEqual(fitted.columns.map(c => c.key), ['cpu']);
    assert.deepEqual(fitted.widths, [3]);
    assert.equal(fitted.dropped.length, COLUMNS.length - 1);
    assert.equal([...row(['99.9'], fitted)].length, 3);
});


test('nothing to fit is not an error', () => {
    assert.deepEqual(fit([], 80).columns, []);
    assert.deepEqual(fit(COLUMNS, 0).columns, []);
    assert.deepEqual(fit(COLUMNS, -5).columns, []);
});


test('columns grow to fit their content, up to what is available', () => {
    const rows = [['1', '1', '1', '1', 'a-very-long-command-name-indeed']];

    const narrow = fit(COLUMNS, 60, []);
    const withData = fit(COLUMNS, 60, rows);

    // the flexible column already took the slack, so content cannot make it
    // wider - but it must not make it narrower either
    assert.equal(total(withData), 60);
    assert.equal(withData.columns.length, narrow.columns.length);
});


test('spare width is shared out rather than taken by whichever column is first', () => {
    // the greedy version starved later columns: with two cells spare the first
    // column took both, and a memory figure four columns along stayed one short
    // and rendered as "…9.6 MiB" - which does not read as an approximation, it
    // reads as a different number
    const columns = [
        { key: 'a', header: 'A', align: 'left', min: 4, priority: 50 },
        { key: 'b', header: 'B', align: 'right', min: 4, priority: 50 },
        { key: 'c', header: 'C', align: 'left', min: 4, flex: true, priority: 50 },
    ];

    // every column wants two more than its minimum, and there are two to give
    const rows = [['aaaaaa', 'bbbbbb', 'cccccc']];
    const fitted = fit(columns, 4 + 4 + 4 + 2 + 2, rows);

    assert.deepEqual(fitted.widths.slice(0, 2), [5, 5], 'the spare should be split');
});


test('a column never grows past what its content needs', () => {
    const columns = [
        { key: 'a', header: 'A', align: 'left', min: 2, priority: 50 },
        { key: 'b', header: 'B', align: 'left', min: 2, flex: true, priority: 50 },
    ];

    const fitted = fit(columns, 40, [['ab', 'x']]);

    assert.equal(fitted.widths[0], 2, 'the fixed column had all it wanted at 2');
    assert.equal(fitted.widths[1], 37, 'the flexible column takes the rest');
});


test('a wide cell widens its own column rather than overflowing', () => {
    const columns = [
        { key: 'a', header: 'A', align: 'left', min: 2, priority: 10 },
        { key: 'b', header: 'B', align: 'left', min: 2, flex: true, priority: 20 },
    ];

    const fitted = fit(columns, 40, [['aaaaaaaa', 'b']]);

    assert.ok(fitted.widths[0] >= 8, 'the wide cell should get its width');
    assert.equal(total(fitted), 40);
});


test('with no flexible column the slack still goes somewhere', () => {
    // otherwise the row is short of the panel and the border does not meet it
    const columns = [
        { key: 'a', header: 'A', align: 'left', min: 3, priority: 10 },
        { key: 'b', header: 'B', align: 'left', min: 3, priority: 20 },
    ];

    assert.equal(total(fit(columns, 40)), 40);
});


test('cell pads to its width on the correct side', () => {
    assert.equal(cell('ab', 5, 'left'), 'ab   ');
    assert.equal(cell('ab', 5, 'right'), '   ab');
    assert.equal(cell('', 3, 'left'), '   ');
});


test('an overlong cell is truncated at the end it can afford to lose', () => {
    // a command keeps its name, a number keeps its magnitude
    assert.equal(cell('systemd-journald', 8, 'left'), 'systemd…');
    assert.equal(cell('1234567890', 6, 'right'), '…67890');
});


test('a one-cell column truncates to an ellipsis rather than a stray character', () => {
    assert.equal(cell('abc', 1, 'left'), '…');
    assert.equal(cell('abc', 1, 'right'), '…');
    assert.equal(cell('', 0, 'left'), '');
});


test('cell never returns anything but exactly its width', () => {
    for (let width = 1; width <= 20; width++) {
        for (const text of ['', 'a', 'abcdefghijklmnopqrstuvwxyz']) {
            for (const align of ['left', 'right']) {
                assert.equal([...cell(text, width, align)].length, width, `${text}@${width}`);
            }
        }
    }
});


test('a built row is exactly as wide as the space it was fitted to', () => {
    for (let width = 10; width <= 150; width++) {
        const fitted = fit(COLUMNS, width);

        if (fitted.columns.length === 0) {
            continue;
        }

        const line = row(['12345', '99.9', '1.5 GiB', '128', 'some-long-process-name'], fitted);

        assert.equal([...line].length, width, `width ${width}`);
    }
});


test('a row with missing cells is still the full width', () => {
    // a process that vanished mid-frame leaves holes; the row must not collapse
    const fitted = fit(COLUMNS, 80);

    assert.equal([...row(['123'], fitted)].length, 80);
    assert.equal([...row([], fitted)].length, 80);
});
