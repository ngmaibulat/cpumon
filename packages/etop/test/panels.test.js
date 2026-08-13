import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CpuPanel,
    DiskPanel,
    MONO_THEME,
    MemoryPanel,
    Ring,
    allocate,
    coreLayout,
} from '../dist/internal.js';

import { assertFits, cells, draw, h, lines, plain } from './helpers/render.js';
import { fakeStore, memory, snapshot } from './fixtures/snapshots.js';


const withStore = (over, options = {}) => ({
    ...options,
    store: fakeStore(Ring, over),
});


const PANELS = [
    ['CPU', CpuPanel],
    ['MEM', MemoryPanel],
    ['DISK', DiskPanel],
];


test('every panel fits its width at every size it might be given', () => {
    // the invariant that matters: a line wider than the panel does not clip,
    // it shifts everything after it, and in the alternate screen that damage
    // persists across frames
    for (const [name, Component] of PANELS) {
        for (const width of [20, 30, 40, 60, 80, 120]) {
            for (const height of [3, 5, 8, 16, 30]) {
                const output = draw(
                    h(Component, { width, height }),
                    withStore({ snapshot: snapshot(), history: [10, 50, 90], cores: [[10], [90]] }, { columns: width }),
                );

                assertFits(assert, output, width, `${name} ${width}x${height}: `);
            }
        }
    }
});


test('every panel is exactly the height it was given', () => {
    // a panel one row too tall pushes every panel below it off the screen
    for (const [name, Component] of PANELS) {
        for (const height of [4, 6, 10, 20]) {
            const output = draw(
                h(Component, { width: 40, height }),
                withStore({ snapshot: snapshot(), history: [10, 50, 90], cores: [[10], [90]] }, { columns: 40 }),
            );

            assert.equal(lines(output).length, height, `${name} at height ${height}`);
        }
    }
});


test('every panel shows a loading state before the first window', () => {
    // and NOT an error, and not an empty layout - a healthy machine must not
    // look broken for the first second of every launch
    for (const [name, Component] of PANELS) {
        const output = plain(draw(
            h(Component, { width: 40, height: 8 }),
            withStore({ snapshot: null }, { columns: 40 }),
        ));

        assert.match(output, /waiting/, name);
        assert.doesNotMatch(output, /unavailable/, name);
    }
});


test('every panel renders in the mono theme without losing its numbers', () => {
    for (const [name, Component] of PANELS) {
        const output = plain(draw(
            h(Component, { width: 50, height: 10 }),
            { ...withStore({ snapshot: snapshot(), history: [50] }, { columns: 50 }), theme: MONO_THEME },
        ));

        assert.match(output, /\d/, `${name} should still show figures`);
        assertFits(assert, output, 50, `${name} mono: `);
    }
});


test('the cpu panel names the core count and the current load', () => {
    const output = plain(draw(
        h(CpuPanel, { width: 50, height: 10 }),
        withStore({ snapshot: snapshot({ cores: [20, 80] }), history: [50], cores: [[20], [80]] }, { columns: 50 }),
    ));

    assert.match(output, /CPU/);
    assert.match(output, /2C/);
    assert.match(output, /50%/);
});


test('a few cores each get their own graph, many get gauges, hundreds get a strip', () => {
    // one display cannot serve a four-core laptop and a 128-core server: eight
    // mini-graphs on 128 cores needs sixteen screens, and a sparkline on four
    // wastes a panel to show four characters
    assert.equal(coreLayout(4, 80, 12).kind, 'graphs');
    assert.equal(coreLayout(16, 80, 12).kind, 'gauges');
    assert.equal(coreLayout(128, 80, 12).kind, 'sparkline');
});


test('the per-core section never squeezes the main graph out', () => {
    // the machine-wide graph is the one worth keeping on a short panel
    for (const count of [1, 4, 16, 64, 256]) {
        for (const height of [3, 4, 6, 10]) {
            const layout = coreLayout(count, 80, height);

            assert.ok(layout.rows <= Math.max(0, height - 2), `${count} cores at height ${height}`);
        }
    }
});


test('a panel with no room for per-core detail shows none', () => {
    assert.equal(coreLayout(8, 80, 3).kind, 'none');
    assert.equal(coreLayout(8, 4, 20).kind, 'none');
    assert.equal(coreLayout(0, 80, 20).kind, 'none');
});


test('per-core gauges keep their bars aligned across the grid', () => {
    // a 100% core has a four-character figure and a 0% core has two, so without
    // a fixed value width the bars beside them differ and the grid looks broken
    const cores = [0, 100, 5, 100, 0, 7, 100, 0, 42, 100, 3, 0];

    assert.equal(coreLayout(cores.length, 38, 12).kind, 'gauges', 'this test is about the gauge grid');

    const output = plain(draw(
        h(CpuPanel, { width: 40, height: 16 }),
        withStore({
            snapshot: snapshot({ cores }),
            history: [50],
            cores: cores.map(v => [v]),
        }, { columns: 40 }),
    ));

    const bars = [...output.matchAll(/\[([^\]]*)\]/g)].map(match => match[1].length);

    assert.ok(bars.length >= 4, 'expected a bar per core');
    assert.equal(new Set(bars).size, 1, `bars differ in width: ${bars.join()}`);
});


test('the memory panel breaks the headline number down', () => {
    // "62% used" is the number people panic about; the breakdown is what shows
    // most of it is reclaimable
    const output = plain(draw(
        h(MemoryPanel, { width: 44, height: 10 }),
        withStore({ snapshot: snapshot(), history: [60] }, { columns: 44 }),
    ));

    assert.match(output, /62%/);
    assert.match(output, /10\.0 GiB \/ 16\.0 GiB/);
    assert.match(output, /used/);
    assert.match(output, /free/);
});


test('swap is shown when there is some and omitted entirely when there is none', () => {
    // a row that always reads zero teaches people to stop reading the panel
    const withSwap = plain(draw(
        h(MemoryPanel, { width: 44, height: 10 }),
        withStore({ snapshot: snapshot(), history: [60] }, { columns: 44 }),
    ));

    const without = plain(draw(
        h(MemoryPanel, { width: 44, height: 10 }),
        withStore({
            snapshot: snapshot({ memory: memory({ swapTotal: 0, swapUsed: 0, swapFree: 0 }) }),
            history: [60],
        }, { columns: 44 }),
    ));

    assert.match(withSwap, /SWAP/);
    assert.doesNotMatch(without, /SWAP/);
});


test('the legend drops whole entries rather than truncating a unit', () => {
    // "free 3.9 G…" is not a shortened gigabyte figure - it reads as some
    // other unit entirely, and a legend that misstates a unit is worse than
    // one that leaves an entry out
    for (let width = 20; width <= 60; width++) {
        const output = plain(draw(
            h(MemoryPanel, { width, height: 10 }),
            withStore({ snapshot: snapshot(), history: [60] }, { columns: width }),
        ));

        assert.doesNotMatch(output, /\d\.\d [KMGTP]…/, `width ${width}`);
        assert.doesNotMatch(output, /(used|cache|free) ?…/, `width ${width}`);
    }
});


test('the os memory source is called out, and meminfo is not', () => {
    // on the os path there is no MemAvailable equivalent, so used counts the
    // page cache and reads high. The same dashboard must not silently mean two
    // different things on two machines.
    const os = plain(draw(
        h(MemoryPanel, { width: 60, height: 8 }),
        withStore({ snapshot: snapshot({ memory: memory({ source: 'os' }) }), history: [60] }, { columns: 60 }),
    ));

    const meminfo = plain(draw(
        h(MemoryPanel, { width: 60, height: 8 }),
        withStore({ snapshot: snapshot(), history: [60] }, { columns: 60 }),
    ));

    assert.match(os, /cache counted as used/);
    assert.doesNotMatch(meminfo, /cache counted as used/);
});


test('the disk panel shows the mount it is reporting on', () => {
    const output = plain(draw(
        h(DiskPanel, { width: 44, height: 8 }),
        withStore({ snapshot: snapshot() }, { columns: 44 }),
    ));

    assert.match(output, /DISK/);
    assert.match(output, /\//);
    assert.match(output, /79%/);
    assert.match(output, /380\.0 GiB \/ 500\.0 GiB/);
});


test('the disk panel says why it has no I/O graph', () => {
    // an empty half-panel invites the reader to wonder what broke
    const output = plain(draw(
        h(DiskPanel, { width: 44, height: 10 }),
        withStore({ snapshot: snapshot() }, { columns: 44 }),
    ));

    assert.match(output, /diskstats/);
});


test('an unavailable disk probe explains itself instead of drawing zeros', () => {
    for (const reason of ['permission-denied', 'not-found', 'parse-error']) {
        const output = plain(draw(
            h(DiskPanel, { width: 44, height: 8 }),
            withStore({
                snapshot: snapshot({ disk: { available: false, reason, detail: '/mnt/data' } }),
            }, { columns: 44 }),
        ));

        assert.match(output, /unavailable/, reason);
        assert.match(output, /\/mnt\/data/, reason);
        // a zeroed bar would be a claim about the filesystem
        assert.doesNotMatch(output, /█/, reason);
    }
});


test('the composition segments always sum to the bar width', () => {
    // rounding each segment independently lets them sum to a cell more or less
    // than the bar, and a bar that is sometimes a cell too long shifts the line
    for (let width = 1; width <= 80; width++) {
        for (const values of [[1, 1, 1, 1], [10, 0, 0, 1], [0, 0, 0, 0], [7, 3, 11, 2], [1, 0, 0, 0]]) {
            const widths = allocate(values, width);
            const sum = widths.reduce((a, b) => a + b, 0);

            if (values.some(v => v > 0)) {
                assert.equal(sum, width, `${values.join()} at ${width}`);
            }

            assert.ok(widths.every(w => w >= 0), `${values.join()} at ${width}`);
        }
    }
});


test('a segment with nothing in it takes no cells', () => {
    assert.deepEqual(allocate([10, 0, 10], 10), [5, 0, 5]);
});


test('an empty composition allocates nothing rather than dividing by zero', () => {
    assert.deepEqual(allocate([0, 0], 10), [0, 0]);
    assert.deepEqual(allocate([1, 1], 0), [0, 0]);
});


test('a very narrow panel still renders something rather than throwing', () => {
    for (const [name, Component] of PANELS) {
        const output = draw(
            h(Component, { width: 12, height: 4 }),
            withStore({ snapshot: snapshot(), history: [50] }, { columns: 12 }),
        );

        assert.ok(cells(lines(output)[0]) <= 12, name);
    }
});
