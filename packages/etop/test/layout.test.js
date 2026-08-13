import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLayout, isAbsent, presentPanels } from '../dist/internal.js';

import { snapshot } from './fixtures/snapshots.js';


const opts = (over = {}) => ({ focus: 'cpu', maximised: false, ...over });

const unavailable = reason => ({ available: false, reason });

const panelsIn = layout => layout.rows.flat().map(rect => rect.panel);


test('a first frame with no snapshot yet drops nothing', () => {
    // every field is undefined before the first tick, and dropping every panel
    // would be the worst possible first impression on a perfectly good machine
    const { present, absent } = presentPanels(null);

    assert.deepEqual(absent, []);
    assert.ok(present.includes('network'));
    assert.ok(present.includes('process'));
});


test('a concept this platform has not got loses its panel entirely', () => {
    // not an empty box - removed, so the rest reflow into the space. This is
    // the rule probeRow() already follows in libsysmon's own renderer.
    const { absent } = presentPanels(snapshot({
        network: unavailable('unsupported-platform'),
        processes: unavailable('unsupported-platform'),
        containers: unavailable('not-applicable'),
    }));

    assert.deepEqual(absent.sort(), ['container', 'network', 'process']);
});


test('an actionable failure keeps its panel', () => {
    // permission denied and a missing file are things a user can do something
    // about; a diagnostic tool that hides diagnostics is worse than useless
    for (const reason of ['permission-denied', 'not-found', 'parse-error']) {
        const { present, absent } = presentPanels(snapshot({ network: unavailable(reason) }));

        assert.ok(present.includes('network'), reason);
        assert.ok(!absent.includes('network'), reason);
    }
});


test('isAbsent separates the two kinds of failure', () => {
    assert.equal(isAbsent(unavailable('not-applicable'), true), true);
    assert.equal(isAbsent(unavailable('unsupported-platform'), true), true);
    assert.equal(isAbsent(unavailable('permission-denied'), true), false);
    assert.equal(isAbsent({ available: true }, true), false);
    // before the first sample, absence means "wait", not "no"
    assert.equal(isAbsent(undefined, false), false);
    assert.equal(isAbsent(unavailable('not-applicable'), false), false);
});


test('a machine running no containers gets no container panel', () => {
    // an available probe with an empty list is not a failure, but it is also
    // not worth a sixth of the screen
    const { absent } = presentPanels(snapshot({
        containers: { available: true, scope: 'host', containers: [] },
    }));

    assert.ok(absent.includes('container'));
});


test('cpu and memory always have a panel', () => {
    // neither is a probe: os.cpus() and the memory collector always answer
    const { present } = presentPanels(snapshot({
        network: unavailable('unsupported-platform'),
        processes: unavailable('unsupported-platform'),
        disk: unavailable('not-applicable'),
        containers: unavailable('not-applicable'),
    }));

    assert.deepEqual(present, ['cpu', 'memory']);
});


test('a macOS-shaped machine gets a full layout of the panels it has', () => {
    const layout = computeLayout(120, 30, snapshot({
        network: unavailable('unsupported-platform'),
        processes: unavailable('unsupported-platform'),
        containers: unavailable('not-applicable'),
    }), opts());

    const panels = panelsIn(layout);

    assert.deepEqual(panels.sort(), ['cpu', 'disk', 'memory']);
    // and the absence is acknowledged once rather than left looking like a bug
    assert.match(layout.note, /\/proc/);
});


test('a linux machine with everything gets every panel', () => {
    const layout = computeLayout(120, 30, snapshot({
        containers: { available: true, scope: 'host', containers: [{ id: 'x' }] },
    }), opts());

    assert.deepEqual(panelsIn(layout).sort(), ['container', 'cpu', 'disk', 'memory', 'network', 'process']);
    assert.equal(layout.note, null);
});


test('a terminal below the minimum says so and lays out nothing', () => {
    for (const [columns, rows] of [[39, 24], [80, 9], [20, 5]]) {
        const layout = computeLayout(columns, rows, snapshot(), opts());

        assert.equal(layout.kind, 'too-small', `${columns}x${rows}`);
        assert.deepEqual(layout.rows, []);
    }
});


test('a small terminal shows one panel at a time rather than six unusable ones', () => {
    const layout = computeLayout(70, 20, snapshot(), opts({ focus: 'memory' }));

    assert.equal(layout.kind, 'single');
    assert.deepEqual(panelsIn(layout), ['memory']);
});


test('maximising gives the focused panel the whole frame', () => {
    const layout = computeLayout(120, 30, snapshot(), opts({ focus: 'disk', maximised: true }));

    assert.equal(layout.kind, 'single');
    assert.deepEqual(layout.rows[0], [{ panel: 'disk', width: 120, height: 30 }]);
});


test('every band is exactly as wide as the terminal', () => {
    // a band a cell short leaves a ragged edge; a cell long shifts the border
    for (let columns = 80; columns <= 200; columns++) {
        const layout = computeLayout(columns, 40, snapshot({
            containers: { available: true, scope: 'host', containers: [{ id: 'x' }] },
        }), opts());

        for (const band of layout.rows) {
            const width = band.reduce((sum, rect) => sum + rect.width, 0);

            assert.equal(width, columns, `at ${columns} columns`);
        }
    }
});


test('the bands together are exactly as tall as the frame', () => {
    for (let rows = 16; rows <= 60; rows++) {
        const layout = computeLayout(120, rows, snapshot({
            containers: { available: true, scope: 'host', containers: [{ id: 'x' }] },
        }), opts());

        if (layout.kind !== 'full') {
            continue;
        }

        const height = layout.rows.reduce((sum, band) => sum + band[0].height, 0);

        assert.equal(height, rows, `at ${rows} rows`);
    }
});


test('panels within a band share its height', () => {
    const layout = computeLayout(120, 40, snapshot(), opts());

    for (const band of layout.rows) {
        for (const rect of band) {
            assert.equal(rect.height, band[0].height);
        }
    }
});


test('no panel is ever given a size it cannot draw in', () => {
    for (let rows = 16; rows <= 40; rows++) {
        const layout = computeLayout(100, rows, snapshot(), opts());

        for (const rect of layout.rows.flat()) {
            assert.ok(rect.height >= 3, `${rect.panel} got ${rect.height} rows at ${rows}`);
            assert.ok(rect.width >= 20, `${rect.panel} got ${rect.width} columns`);
        }
    }
});


test('a short frame gives up whole panels, least valuable first', () => {
    // containers before disk before network; the process table is what most
    // people opened the dashboard for
    const full = snapshot({ containers: { available: true, scope: 'host', containers: [{ id: 'x' }] } });

    const tall = panelsIn(computeLayout(120, 40, full, opts()));
    const short = panelsIn(computeLayout(120, 17, full, opts()));

    assert.ok(tall.length >= short.length);
    assert.ok(short.includes('cpu'), 'cpu is the last thing to go');
});
