import test from 'node:test';
import assert from 'node:assert/strict';

import { ProcessPanel, Ring, matches } from '../dist/internal.js';

import { assertFits, draw, h, lines, plain } from './helpers/render.js';
import { fakeStore, snapshot } from './fixtures/snapshots.js';


const proc = (over = {}) => ({
    pid: 1234,
    comm: 'postgres',
    state: 'S',
    ppid: 1,
    utime: 100, stime: 50, jiffies: 150,
    threads: 4,
    cpuRatio: 0.25,
    cpuPercentage: 25,
    rss: 128 * 1024 ** 2,
    ...over,
});


const withProcs = (processes, over = {}) => snapshot({
    processes: { available: true, processes },
    ...over,
});


const PROCS = [
    proc({ pid: 1, comm: 'postgres', cpuPercentage: 90, rss: 512 * 1024 ** 2 }),
    proc({ pid: 22, comm: 'node', cpuPercentage: 40, rss: 256 * 1024 ** 2 }),
    proc({ pid: 333, comm: 'sshd', cpuPercentage: 1, rss: 8 * 1024 ** 2, state: 'R' }),
];


const render = (props, options = {}) => draw(
    h(ProcessPanel, {
        width: 60,
        height: 12,
        selected: 0,
        scroll: 0,
        sort: 'cpu',
        sortReverse: false,
        filter: '',
        expanded: false,
        onView: () => {},
        ...props,
    }),
    { columns: 60, ...options },
);


test('the filter matches on command name, case-insensitively', () => {
    assert.equal(matches(proc({ comm: 'postgres' }), 'post'), true);
    assert.equal(matches(proc({ comm: 'postgres' }), 'POST'), true);
    assert.equal(matches(proc({ comm: 'postgres' }), 'gres'), true);
    assert.equal(matches(proc({ comm: 'postgres' }), 'mysql'), false);
});


test('the filter also matches on pid, so a known number finds its process', () => {
    assert.equal(matches(proc({ pid: 1234 }), '1234'), true);
    assert.equal(matches(proc({ pid: 1234 }), '23'), true);
    assert.equal(matches(proc({ pid: 1234 }), '9999'), false);
});


test('an empty filter matches everything', () => {
    assert.equal(matches(proc(), ''), true);
});


test('the table shows the columns and the data', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const output = plain(render({}, { store }));

    assert.match(output, /PID/);
    assert.match(output, /%CPU/);
    assert.match(output, /COMMAND/);
    assert.match(output, /postgres/);
    assert.match(output, /512\.0 MiB/);
    assert.match(output, /90\.0/);
});


test('the sorted column is marked, and the direction with it', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });

    assert.match(plain(render({ sort: 'cpu' }, { store })), /%CPU▼/);
    assert.match(plain(render({ sort: 'cpu', sortReverse: true }, { store })), /%CPU▲/);
    assert.match(plain(render({ sort: 'mem' }, { store })), /MEM▼/);
    // sorting by name marks the command column, which is what the user pressed
    assert.match(plain(render({ sort: 'name' }, { store })), /COMMAND▼/);
});


test('the panel counts what it is showing', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });

    assert.match(plain(render({}, { store })), /PROC 3/);
    assert.match(plain(render({ filter: 'post' }, { store })), /1 matching "post"/);
});


test('a filter that matches nothing says so, naming the filter', () => {
    // and does not look like a machine running no processes
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const output = plain(render({ filter: 'zzz' }, { store }));

    assert.match(output, /nothing matches "zzz"/);
});


test('an empty list on the first tick is loading, not an empty machine', () => {
    const loading = fakeStore(Ring, { snapshot: withProcs([]), ticks: 1 });

    assert.match(plain(render({}, { store: loading })), /waiting/);

    const settled = fakeStore(Ring, { snapshot: withProcs([]), ticks: 9 });

    assert.match(plain(render({}, { store: settled })), /no processes with a full window/);
});


test('an unsupported platform explains itself', () => {
    const store = fakeStore(Ring, {
        snapshot: snapshot({ processes: { available: false, reason: 'unsupported-platform' } }),
    });

    const output = plain(render({}, { store }));

    assert.match(output, /unavailable/);
    assert.match(output, /\/proc/);
});


test('a permission failure names the detail so it can be acted on', () => {
    const store = fakeStore(Ring, {
        snapshot: snapshot({
            processes: { available: false, reason: 'permission-denied', detail: '/proc/9/stat' },
        }),
    });

    assert.match(plain(render({}, { store })), /\/proc\/9\/stat/);
});


test('a process with no resident memory reads as unknown, not as zero', () => {
    // rss is undefined when the second read failed - the process exited, or the
    // read was denied - and "0 B" would be a claim the collector never made
    const store = fakeStore(Ring, { snapshot: withProcs([proc({ rss: undefined })]) });

    assert.match(plain(render({}, { store })), /\s-\s/);
});


test('expanding a row adds a detail line without changing the panel height', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });

    const collapsed = render({ expanded: false }, { store });
    const expanded = render({ expanded: true }, { store });

    assert.equal(lines(collapsed).length, lines(expanded).length);
    assert.match(plain(expanded), /ppid/);
    assert.doesNotMatch(plain(collapsed), /ppid/);
});


test('scrolling shows a later window without changing the panel height', () => {
    const many = Array.from({ length: 100 }, (_unused, i) =>
        proc({ pid: i + 1, comm: `proc-${i}`, cpuPercentage: 100 - i }));

    const store = fakeStore(Ring, { snapshot: withProcs(many) });

    const top = plain(render({ scroll: 0 }, { store }));
    const down = plain(render({ scroll: 40, selected: 40 }, { store }));

    assert.match(top, /proc-0\b/);
    assert.doesNotMatch(down, /proc-0\b/);
    assert.match(down, /proc-40/);
});


test('the panel reports its row count and window size', () => {
    // the reducer cannot know either, and clamps itself from what it is told
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const seen = [];

    render({ onView: view => seen.push(view) }, { store });

    assert.ok(seen.length > 0, 'onView should have been called');
    assert.equal(seen[0].rowCount, 3);
    assert.ok(seen[0].windowRows > 0);
});


test('the panel reports which process the selection landed on', () => {
    // the kill modal cannot work this out for itself: it depends on the sort,
    // the filter and the scroll position, all of which live here
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const seen = [];

    render({ selected: 1, onView: view => seen.push(view) }, { store });

    assert.equal(seen[0].selected.pid, 22);
    assert.equal(seen[0].selected.comm, 'node');
});


test('an empty list reports no selection rather than a phantom one', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const seen = [];

    render({ filter: 'zzz', onView: view => seen.push(view) }, { store });

    assert.equal(seen[0].rowCount, 0);
    assert.equal(seen[0].selected, null);
});


test('the reported row count is what survives the filter', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const seen = [];

    render({ filter: 'post', onView: view => seen.push(view.rowCount) }, { store });

    assert.equal(seen[0], 1);
});


test('the panel asks for enough rows to fill itself, plus headroom', () => {
    // each extra row is one /proc read per tick; a restart costs a whole
    // sampling window, so scrolling must never cross the boundary
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const asked = [];

    store.setTop = value => asked.push(value);

    render({ height: 12 }, { store });

    assert.ok(asked.length > 0, 'setTop should have been called');
    assert.ok(asked[0] > 12, `asked for ${asked[0]}, which leaves no headroom`);
});


test('a filter makes the panel collect far more than it can show', () => {
    // the filter narrows what has been sampled, and what has been sampled is
    // the busiest N - so filtering for an idle process would find nothing and
    // report it as "no matches", which is a different and false statement
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const asked = [];

    store.setTop = value => asked.push(value);

    render({ filter: 'post' }, { store });

    assert.ok(asked[0] >= 1000, `asked for only ${asked[0]} rows while filtering`);
});


test('the panel fits every size it might be given', () => {
    const many = Array.from({ length: 60 }, (_unused, i) =>
        proc({ pid: i + 1, comm: `a-rather-long-process-name-${i}`, cpuPercentage: 60 - i }));

    const store = fakeStore(Ring, { snapshot: withProcs(many) });

    for (const width of [20, 30, 45, 60, 100, 160]) {
        for (const height of [4, 6, 12, 30]) {
            const output = draw(
                h(ProcessPanel, {
                    width, height,
                    selected: 2, scroll: 0, sort: 'cpu', sortReverse: false,
                    filter: '', expanded: false, onView: () => {},
                }),
                { columns: width, store },
            );

            assertFits(assert, output, width, `${width}x${height}: `);
            assert.equal(lines(output).length, height, `${width}x${height} height`);
        }
    }
});


test('a narrow panel keeps the identifying columns and drops the rest', () => {
    const store = fakeStore(Ring, { snapshot: withProcs(PROCS) });
    const output = plain(render({ width: 28 }, { store }));

    assert.match(output, /PID/);
    assert.match(output, /%CPU/);
    // THR at the lowest priority is the first to go
    assert.doesNotMatch(output, /THR/);
});
