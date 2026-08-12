import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { SnapshotStore } from '../dist/internal.js';


/**
 * A stand-in for SystemMonitor that emits when the test says so.
 *
 * The store's contract is about the EventEmitter bridge - what it publishes,
 * when it respawns, what it keeps - and none of that is a question about /proc.
 * Driving it by hand makes every one of those assertions exact instead of
 * timing-dependent.
 */
class FakeMonitor
{
    static spawned = [];

    constructor(options)
    {
        this.options = options;
        this.listeners = { sample: [], error: [] };
        this.stopped = false;
        FakeMonitor.spawned.push(this);
    }

    on(event, listener)
    {
        this.listeners[event].push(listener);

        return this;
    }

    emit(event, payload)
    {
        for (const listener of this.listeners[event]) {
            listener(payload);
        }
    }

    stopMonitor()
    {
        this.stopped = true;
    }

    removeAllListeners()
    {
        this.listeners = { sample: [], error: [] };
    }
}


const makeStore = (over = {}) => {
    FakeMonitor.spawned = [];

    const store = new SnapshotStore({
        intervalMs: 1000,
        collect: ['cpu', 'memory'],
        top: 10,
        sort: 'cpu',
        sortReverse: false,
        createMonitor: options => new FakeMonitor(options),
        ...over,
    });

    return { store, monitor: () => FakeMonitor.spawned.at(-1) };
};


const sample = (over = {}) => ({
    timestamp: 1,
    elapsedMs: 1000,
    cpu: [{ loadPercentage: 40 }, { loadPercentage: 60 }],
    cpuOverall: { loadPercentage: 50 },
    memory: {
        usedPercentage: 70, used: 7, total: 10, available: 3,
        swapTotal: 100, swapUsed: 25, swapFree: 75,
        free: 3, buffers: 0, cached: 0, usedRatio: 0.7, source: 'meminfo',
    },
    ...over,
});


test('the first state is loading, not empty and not an error', () => {
    // an empty layout on the first frame reads as "this machine has nothing",
    // which on a perfectly good box is a lie for a whole second
    const { store } = makeStore();

    assert.equal(store.getSnapshot().snapshot, null);
    assert.equal(store.getSnapshot().error, null);
    assert.equal(store.getSnapshot().ticks, 0);
});


test('the monitor exists before anything subscribes', () => {
    // constructed in runTui() rather than an effect, so no sample can land in
    // the gap between construction and the first listener
    const { monitor } = makeStore();

    assert.ok(monitor());
    assert.equal(monitor().options.unref, true);
});


test('a sample publishes and notifies every subscriber', () => {
    const { store, monitor } = makeStore();
    let notified = 0;

    store.subscribe(() => { notified++; });
    store.subscribe(() => { notified++; });

    monitor().emit('sample', sample());

    assert.equal(notified, 2);
    assert.equal(store.getSnapshot().ticks, 1);
    assert.equal(store.getSnapshot().snapshot.cpuOverall.loadPercentage, 50);
});


test('getSnapshot returns the same object until something changes', () => {
    // useSyncExternalStore compares by reference and re-renders in a loop if
    // this builds a new object each call - the classic way to hang an ink app
    const { store, monitor } = makeStore();

    const before = store.getSnapshot();
    assert.equal(store.getSnapshot(), before);

    monitor().emit('sample', sample());

    const after = store.getSnapshot();
    assert.notEqual(after, before);
    assert.equal(store.getSnapshot(), after);
});


test('unsubscribing actually detaches', () => {
    const { store, monitor } = makeStore();
    let notified = 0;

    const unsubscribe = store.subscribe(() => { notified++; });
    unsubscribe();

    monitor().emit('sample', sample());

    assert.equal(notified, 0);
});


test('history accumulates across samples', () => {
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample());
    monitor().emit('sample', sample({ cpuOverall: { loadPercentage: 80 } }));

    assert.equal(store.rings.cpu.length, 2);
    assert.equal(store.rings.cpu.last, 80);
    assert.equal(store.rings.memory.last, 70);
    // swapUsed 25 of swapTotal 100
    assert.equal(store.rings.swap.last, 25);
});


test('a machine with no swap records zero rather than a division by zero', () => {
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample({
        memory: { ...sample().memory, swapTotal: 0, swapUsed: 0 },
    }));

    assert.equal(store.rings.swap.last, 0);
});


test('per-core rings are created to match the core count', () => {
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample());

    assert.equal(store.cores.length, 2);
    assert.equal(store.cores[0].last, 40);
    assert.equal(store.cores[1].last, 60);
});


test('a change in core count drops per-core history but keeps the aggregate', () => {
    // core 3 before a hotplug and core 3 after are not the same core, so the
    // per-core series cannot be carried across - but the machine-wide one can,
    // and throwing it away would put a hole in the only continuous graph
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample());
    monitor().emit('sample', sample());

    assert.equal(store.cores[0].length, 2);

    monitor().emit('sample', sample({
        cpu: [{ loadPercentage: 10 }],
        cpuOverall: { loadPercentage: 10 },
    }));

    assert.equal(store.cores.length, 1);
    assert.equal(store.cores[0].length, 1);
    assert.equal(store.rings.cpu.length, 3);
});


test('loopback is excluded from the network totals', () => {
    // lo is almost always the loudest interface and almost never the
    // interesting one; summing it in flattens everything else against the top
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample({
        network: {
            available: true,
            elapsedMs: 1000,
            interfaces: [
                { name: 'lo', rxBytesPerSec: 1e9, txBytesPerSec: 1e9 },
                { name: 'eth0', rxBytesPerSec: 100, txBytesPerSec: 200 },
            ],
        },
    }));

    assert.equal(store.rings.rx.last, 100);
    assert.equal(store.rings.tx.last, 200);
});


test('an unavailable network probe records nothing at all', () => {
    // a zero would be a claim about the machine; absence is the truth
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample({ network: { available: false, reason: 'unsupported-platform' } }));

    assert.equal(store.rings.rx.length, 0);
});


test('an error is published instead of taking the process down', () => {
    // EventEmitter rethrows an error event with no listener, which would kill
    // the process with the alternate screen still up
    const { store, monitor } = makeStore();

    monitor().emit('error', new Error('read failed'));

    assert.equal(store.getSnapshot().error.message, 'read failed');
    assert.equal(store.getSnapshot().snapshot, null);
});


test('the next good sample clears a previous error', () => {
    const { store, monitor } = makeStore();

    monitor().emit('error', new Error('transient'));
    monitor().emit('sample', sample());

    assert.equal(store.getSnapshot().error, null);
});


test('a paused view freezes but keeps the baseline advancing', () => {
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample());
    store.setPaused(true);
    monitor().emit('sample', sample({ cpuOverall: { loadPercentage: 99 } }));

    // the frame is unchanged...
    assert.equal(store.getSnapshot().snapshot.cpuOverall.loadPercentage, 50);
    assert.equal(store.rings.cpu.length, 1);

    // ...and resuming shows the present, not a replay of the frozen moment
    store.setPaused(false);
    monitor().emit('sample', sample({ cpuOverall: { loadPercentage: 12 } }));

    assert.equal(store.getSnapshot().snapshot.cpuOverall.loadPercentage, 12);
});


test('changing the interval starts a new monitor and returns to loading', () => {
    // SystemMonitor.ms is readonly and captured by its setInterval, so a new
    // rate means a new monitor. The first window at the new rate has to be
    // measured at the new length rather than straddle the change.
    const { store, monitor } = makeStore();
    const first = monitor();

    monitor().emit('sample', sample());
    store.setIntervalMs(250);

    assert.equal(first.stopped, true);
    assert.equal(store.spawns, 2);
    assert.equal(monitor().options.intervalMs, 250);
    assert.equal(store.getSnapshot().snapshot, null);
    assert.equal(store.getSnapshot().intervalMs, 250);
});


test('setting the interval to what it already is does nothing', () => {
    const { store } = makeStore();

    store.setIntervalMs(1000);

    assert.equal(store.spawns, 1);
});


test('the discarded monitor is detached, not merely stopped', () => {
    // a stopped monitor still holding our listeners would keep publishing if
    // anything else ever called measure() on it
    const { store, monitor } = makeStore();
    const first = monitor();

    store.setIntervalMs(250);
    first.emit('sample', sample({ cpuOverall: { loadPercentage: 99 } }));

    assert.equal(store.getSnapshot().snapshot, null);
});


test('changing the row count respawns, because the cut happens before rss', () => {
    const { store, monitor } = makeStore();

    store.setTop(25);

    assert.equal(store.spawns, 2);
    assert.equal(monitor().options.top, 25);

    // and asking for what it already has costs nothing, which is what makes
    // scroll-without-resize free
    store.setTop(25);
    assert.equal(store.spawns, 2);
});


test('changing the sort respawns, because it decides which rows are collected', () => {
    const { store, monitor } = makeStore();

    store.setSort('mem', false);

    assert.equal(store.spawns, 2);
    assert.equal(monitor().options.sort, 'mem');

    store.setSort('mem', true);
    assert.equal(store.spawns, 3);
    assert.equal(monitor().options.sortReverse, true);

    store.setSort('mem', true);
    assert.equal(store.spawns, 3);
});


test('reset clears history but keeps the live frame', () => {
    const { store, monitor } = makeStore();

    monitor().emit('sample', sample());
    monitor().emit('sample', sample());

    store.reset();

    assert.equal(store.rings.cpu.length, 0);
    assert.equal(store.cores[0].length, 0);
    // the current numbers are still true; only the history was asked about
    assert.ok(store.getSnapshot().snapshot);
});


test('dispose stops the monitor and drops every listener', () => {
    const { store, monitor } = makeStore();
    const live = monitor();
    let notified = 0;

    store.subscribe(() => { notified++; });
    store.dispose();

    assert.equal(live.stopped, true);

    live.emit('sample', sample());
    assert.equal(notified, 0);
});


test('a real monitor samples and leaves nothing holding the loop open', async () => {
    // the fake covers the bridge; this covers the assumption the bridge rests
    // on - that a real SystemMonitor emits what the store expects
    const { SnapshotStore: Store } = await import('../dist/internal.js');

    const store = new Store({
        intervalMs: 60,
        collect: ['cpu', 'memory'],
        top: 5,
        sort: 'cpu',
        sortReverse: false,
    });

    const sampled = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 2000);

        store.subscribe(() => {
            if (store.getSnapshot().snapshot !== null) {
                clearTimeout(timer);
                resolve(true);
            }
        });
    });

    store.dispose();

    assert.equal(sampled, true, 'a real monitor should produce a sample');
    assert.ok(store.rings.cpu.length >= 1);
});


test('a live store never holds the event loop open', () => {
    // the only way to actually assert this is to watch a process exit. A leaked
    // setInterval here would hang the dashboard on quit rather than crash it,
    // which is the kind of bug that gets diagnosed as "ink is slow to tear down"
    const source = `
        import { SnapshotStore } from ${JSON.stringify(new URL('../dist/internal.js', import.meta.url).href)};
        new SnapshotStore({ intervalMs: 50, collect: ['cpu'], top: 5, sort: 'cpu', sortReverse: false });
        // no dispose() on purpose: unref alone must be enough
    `;

    const started = Date.now();

    execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
        timeout: 5000,
        stdio: 'ignore',
    });

    assert.ok(Date.now() - started < 4000, 'the process should exit on its own');
});
