import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_THEME,
    Gauge,
    Graph,
    MONO_THEME,
    Panel,
    Ring,
    Sparkline,
    Table,
    Unavailable,
    graphCapacity,
} from '../dist/internal.js';

import { assertFits, cells, draw, h, lines, plain } from './helpers/render.js';


const RAMP = DEFAULT_THEME.cpu;

const ring = values => {
    const r = new Ring(512);

    for (const value of values) {
        r.push(value);
    }

    return r;
};


const COLUMNS = [
    { key: 'pid', header: 'PID', align: 'right', min: 5, priority: 90 },
    { key: 'cpu', header: '%CPU', align: 'right', min: 5, priority: 100 },
    { key: 'comm', header: 'COMMAND', align: 'left', min: 8, flex: true, priority: 80 },
];

const ROWS = [
    ['1234', '99.9', 'postgres'],
    ['5678', '12.0', 'node'],
    ['9012', '0.4', 'sshd'],
];


test('a panel draws its border, title and interior', () => {
    const output = draw(h(Panel, {
        title: 'CPU',
        subtitle: '16 cores',
        width: 30,
        height: 6,
        children: () => h(Graph, { series: ring([50, 100]), width: 28, height: 3, max: 100, ramp: RAMP, tick: 1 }),
    }), { columns: 30 });

    assert.match(plain(output), /CPU/);
    assert.match(plain(output), /16 cores/);
    assertFits(assert, output, 30);
});


test('a panel is exactly the height it was given', () => {
    // a panel one row too tall pushes every panel below it off the screen
    for (const height of [3, 6, 12, 24]) {
        const output = draw(h(Panel, {
            title: 'T', width: 40, height,
            children: ({ width, height: inner }) =>
                h(Graph, { series: ring([1, 2, 3]), width, height: inner, max: 100, ramp: RAMP, tick: 1 }),
        }), { columns: 40 });

        assert.equal(lines(output).length, height, `height ${height}`);
    }
});


test('a panel clips content that does not fit rather than growing', () => {
    // the interior asks for more rows than the panel has; overflow hidden is
    // what turns that into a missing row instead of a shifted layout
    const output = draw(h(Panel, {
        title: 'T', width: 30, height: 5,
        children: () => h(Graph, { series: ring([100]), width: 28, height: 40, max: 100, ramp: RAMP, tick: 1 }),
    }), { columns: 30 });

    assert.equal(lines(output).length, 5);
    assertFits(assert, output, 30);
});


test('a graph is exactly as tall and wide as it was asked for', () => {
    for (const width of [1, 8, 40, 79]) {
        for (const height of [1, 3, 8]) {
            const output = draw(
                h(Graph, { series: ring([10, 50, 90]), width, height, max: 100, ramp: RAMP, tick: 1 }),
                { columns: 80 });

            const drawn = lines(output);

            assert.equal(drawn.length, height, `${width}x${height} height`);

            for (const line of drawn) {
                assert.ok(cells(line) <= width, `${width}x${height}: "${line}"`);
            }
        }
    }
});


test('a graph with no history yet draws blank, not a baseline', () => {
    // a flat line at the bottom claims the machine was idle; blank says the
    // dashboard has not measured it yet, which is the truth
    const output = draw(h(Graph, { series: new Ring(64), width: 10, height: 2, max: 100, ramp: RAMP, tick: 0 }),
        { columns: 20 });

    assert.equal(plain(output).trim(), '');
});


test('a graph renders in every style without overflowing', () => {
    for (const graph of ['block', 'braille', 'ascii']) {
        const output = draw(
            h(Graph, { series: ring([0, 25, 50, 75, 100, 60]), width: 20, height: 4, max: 100, ramp: RAMP, tick: 1 }),
            { columns: 20, graph });

        assert.equal(lines(output).length, 4, graph);
        assertFits(assert, output, 20, `${graph}: `);
    }
});


test('the ascii style emits nothing outside ascii', () => {
    // mojibake from a stray multi-byte character breaks alignment for the whole
    // frame, not just this panel
    const output = draw(
        h(Graph, { series: ring([0, 40, 100]), width: 12, height: 3, max: 100, ramp: RAMP, tick: 1 }),
        { columns: 12, graph: 'ascii', unicode: false });

    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(plain(output).replace(/\n/g, ''), /[^\x20-\x7e]/);
});


test('braille shows twice the history in the same width', () => {
    assert.equal(graphCapacity('braille', 20), 40);
    assert.equal(graphCapacity('block', 20), 20);
    assert.equal(graphCapacity('ascii', 20), 20);
});


test('an inverted graph is the mirror of an upright one', () => {
    const series = ring([100, 20]);
    const props = { series, width: 4, height: 3, max: 100, ramp: RAMP, tick: 1 };

    const up = lines(draw(h(Graph, props), { columns: 10 }));
    const down = lines(draw(h(Graph, { ...props, inverted: true }), { columns: 10 }));

    assert.deepEqual(down, [...up].reverse());
});


test('a gauge fits the width it was given, at every width', () => {
    for (let width = 6; width <= 60; width++) {
        const output = draw(h(Gauge, { label: 'MEM', ratio: 0.615, width, ramp: RAMP }), { columns: 60 });

        assert.equal(lines(output).length, 1, `width ${width}`);
        assert.ok(cells(output) <= width, `width ${width}: "${plain(output)}"`);
    }
});


test('a gauge too narrow for a bar keeps the number', () => {
    // the figure is the part worth having; a two-cell bar is decoration
    const output = draw(h(Gauge, { label: 'MEM', ratio: 0.62, width: 9, ramp: RAMP }), { columns: 20 });

    assert.match(plain(output), /62%/);
});


test('a gauge shows the value it was given rather than recomputing one', () => {
    const output = draw(
        h(Gauge, { label: 'MEM', ratio: 0.5, width: 40, ramp: RAMP, value: '9.4 GiB / 15.5 GiB' }),
        { columns: 40 });

    assert.match(plain(output), /9\.4 GiB \/ 15\.5 GiB/);
});


test('a table shows its header and rows', () => {
    const output = draw(h(Table, { columns: COLUMNS, rows: ROWS, width: 40, height: 4 }), { columns: 40 });

    assert.match(plain(output), /PID/);
    assert.match(plain(output), /postgres/);
    assert.match(plain(output), /sshd/);
});


test('no table row ever exceeds the table width', () => {
    // The exact-width guarantee is tested on row() in columns.test.js. It
    // cannot be asserted here because ink trims trailing whitespace off each
    // rendered line, so a row whose last column is left-aligned and short comes
    // back narrower - which is fine, and only overflow can corrupt the frame.
    for (let width = 12; width <= 100; width++) {
        const output = draw(h(Table, { columns: COLUMNS, rows: ROWS, width, height: 4 }), { columns: 100 });

        for (const line of lines(output)) {
            assert.ok(cells(line) <= width, `width ${width}: "${line}"`);
        }
    }
});


test('a table never draws more rows than its height allows', () => {
    const many = Array.from({ length: 50 }, (_, i) => [String(i), '1.0', `proc-${i}`]);

    for (const height of [1, 2, 5, 10]) {
        const output = draw(h(Table, { columns: COLUMNS, rows: many, width: 40, height }), { columns: 40 });

        assert.equal(lines(output).length, height, `height ${height}`);
    }
});


test('a table scrolls by offset without changing size', () => {
    const many = Array.from({ length: 50 }, (_, i) => [String(i), '1.0', `proc-${i}`]);

    const output = draw(h(Table, { columns: COLUMNS, rows: many, width: 40, height: 4, offset: 20 }), { columns: 40 });

    assert.match(plain(output), /proc-20/);
    assert.doesNotMatch(plain(output), /proc-0\b/);
    assert.equal(lines(output).length, 4);
});


test('the sorted column is marked in the header', () => {
    const down = plain(draw(h(Table, { columns: COLUMNS, rows: ROWS, width: 40, height: 2, sortKey: 'cpu' }), { columns: 40 }));
    const up = plain(draw(h(Table, { columns: COLUMNS, rows: ROWS, width: 40, height: 2, sortKey: 'cpu', sortReverse: true }), { columns: 40 }));

    assert.match(down, /▼/);
    assert.match(up, /▲/);
});


test('a selected row is marked without changing the row width', () => {
    const output = draw(h(Table, { columns: COLUMNS, rows: ROWS, width: 40, height: 4, selected: 1 }), { columns: 40 });

    assert.match(output, /\[4[0-9]|\[48;/, 'expected a background fill on the selected row');

    for (const line of lines(output)) {
        assert.ok(cells(line) <= 40);
    }
});


test('a table on a theme with no selection colour still marks the selection', () => {
    // mono has no background to fill, so it must invert instead - a dashboard
    // where you cannot see which row is selected is not usable
    const output = draw(
        h(Table, { columns: COLUMNS, rows: ROWS, width: 40, height: 4, selected: 1 }),
        { columns: 40, theme: MONO_THEME });

    assert.match(output, /\[7m/, 'expected an inverse sequence for the selected row');
});


test('a sparkline is one line and never wider than asked', () => {
    const values = Array.from({ length: 128 }, (_, i) => i);

    for (const width of [4, 16, 64, 128]) {
        const output = draw(h(Sparkline, { values, max: 128, ramp: RAMP, width }), { columns: 128 });

        assert.equal(lines(output).length, 1, `width ${width}`);
        assert.ok(cells(output) <= width, `width ${width}`);
    }
});


test('a sparkline shows fewer cores than it has room for without padding', () => {
    const output = draw(h(Sparkline, { values: [10, 90], max: 100, ramp: RAMP, width: 20 }), { columns: 20 });

    assert.equal(plain(output).trimEnd().length, 2);
});


test('an unavailable probe explains itself and draws no graph', () => {
    // a zeroed graph would be a claim about the machine; this is the truth
    const output = draw(h(Unavailable, { reason: 'permission-denied', width: 40, height: 3 }), { columns: 40 });

    assert.match(plain(output), /unavailable/);
    assert.match(plain(output), /not readable by this user/);
    assert.doesNotMatch(plain(output), /[█▁▂▃▄▅▆▇]/);
});


test('every unavailable reason has something to say', () => {
    for (const reason of ['permission-denied', 'not-found', 'parse-error', 'unsupported-platform', 'not-applicable']) {
        const output = plain(draw(h(Unavailable, { reason, width: 50, height: 2 }), { columns: 50 }));

        assert.match(output, /unavailable — \S/, reason);
        assert.doesNotMatch(output, /undefined/, reason);
    }
});


test('a detail is shown when the probe carried one', () => {
    const output = plain(draw(
        h(Unavailable, { reason: 'not-found', detail: '/proc/net/dev', width: 40, height: 3 }),
        { columns: 40 }));

    assert.match(output, /\/proc\/net\/dev/);
});
