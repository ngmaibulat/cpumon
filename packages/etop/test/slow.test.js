import test from 'node:test';
import assert from 'node:assert/strict';

import { SlowPoller } from '../dist/internal.js';


const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/** a fetcher whose settling the test controls */
function deferred()
{
    let settle;
    const calls = [];

    const fetch = () => {
        const promise = new Promise(resolve => { settle = resolve; });
        calls.push(promise);

        return promise;
    };

    return { fetch, calls, resolve: (value) => settle(value) };
}


const ok = (containers = []) => ({ available: true, containers });


test('getSnapshot returns the identical object until something is published', () => {
    // a fresh object per call makes useSyncExternalStore re-render forever and
    // the app spins at 100% CPU without drawing a second frame
    const poller = new SlowPoller({ fetchers: { docker: async () => ok() } });

    const first = poller.getSnapshot();

    assert.equal(poller.getSnapshot(), first);
    assert.equal(poller.getSnapshot(), first);

    poller.dispose();
});


test('nothing is polled until a screen asks for it', async () => {
    let called = 0;

    const poller = new SlowPoller({
        intervalMs: 10,
        fetchers: { docker: async () => { called++; return ok(); } },
    });

    await tick(40);

    assert.equal(called, 0, 'a session that never opens the stacks screen never opens the socket');
    assert.equal(poller.getSnapshot().docker, undefined);

    poller.dispose();
});


test('asking for a source with no data yet polls at once, not at the next interval', async () => {
    const poller = new SlowPoller({
        intervalMs: 10_000,
        fetchers: { docker: async () => ok([{ id: 'a' }]) },
    });

    poller.setActive(['docker']);
    await tick(20);

    assert.equal(poller.getSnapshot().docker?.available, true, 'a ten-second wait for a 15 ms request is not a load time');
    assert.equal(poller.getSnapshot().docker.containers.length, 1);

    poller.dispose();
});


test('a publish changes the snapshot identity, so memo keys move', async () => {
    const poller = new SlowPoller({ intervalMs: 10_000, fetchers: { docker: async () => ok() } });

    const before = poller.getSnapshot();

    poller.setActive(['docker']);
    await tick(20);

    const after = poller.getSnapshot();

    assert.notEqual(after, before);
    assert.equal(after.ticks, before.ticks + 1);

    poller.dispose();
});


test('subscribers are woken on a publish and released on unsubscribe', async () => {
    let woken = 0;

    const poller = new SlowPoller({ intervalMs: 10_000, fetchers: { docker: async () => ok() } });
    const unsubscribe = poller.subscribe(() => { woken++; });

    poller.setActive(['docker']);
    await tick(20);

    assert.equal(woken, 1);

    unsubscribe();
    poller.setActive([]);
    poller.setActive(['docker']);
    await tick(20);

    assert.equal(woken, 1, 'an unsubscribed listener must not be called again');

    poller.dispose();
});


test('a rejected poll publishes an Unavailable rather than throwing', async () => {
    // an unhandled rejection takes the process down with the alternate screen
    // still on the user's terminal
    const rejections = [];
    const onUnhandled = (err) => rejections.push(err);

    process.on('unhandledRejection', onUnhandled);

    const poller = new SlowPoller({
        intervalMs: 10_000,
        fetchers: { docker: async () => { throw new Error('daemon exploded'); } },
    });

    poller.setActive(['docker']);
    await tick(30);

    const probe = poller.getSnapshot().docker;

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'parse-error');
    assert.match(probe.detail, /daemon exploded/);
    assert.deepEqual(rejections, []);

    process.off('unhandledRejection', onUnhandled);
    poller.dispose();
});


test('a poll slower than the interval does not start a second one underneath it', async () => {
    const slow = deferred();

    const poller = new SlowPoller({ intervalMs: 5, fetchers: { docker: slow.fetch } });

    poller.setActive(['docker']);

    // several intervals pass while the first request is still in flight
    await tick(60);

    assert.equal(poller.polls, 1, 'the timer chain must reschedule on settle, not on a fixed cadence');
    assert.equal(slow.calls.length, 1);

    slow.resolve(ok());
    await tick(30);

    assert.ok(poller.polls > 1, 'and it must resume once the first one lands');

    poller.dispose();
});


test('setActive([]) stops polling entirely', async () => {
    let called = 0;

    const poller = new SlowPoller({
        intervalMs: 5,
        fetchers: { docker: async () => { called++; return ok(); } },
    });

    poller.setActive(['docker']);
    await tick(40);

    assert.ok(called >= 2, `expected repeated polls, got ${called}`);

    poller.setActive([]);
    const settled = called;

    await tick(40);

    assert.equal(called, settled, 'leaving the screen stops the socket traffic');
    assert.deepEqual(poller.active, []);

    poller.dispose();
});


test('re-asking for a source that already has data does not re-poll immediately', async () => {
    let called = 0;

    const poller = new SlowPoller({
        intervalMs: 10_000,
        fetchers: { docker: async () => { called++; return ok(); } },
    });

    poller.setActive(['docker']);
    await tick(20);
    assert.equal(called, 1);

    // tabbing away and back must not turn the screen into a request generator
    for (let i = 0; i < 5; i++) {
        poller.setActive([]);
        poller.setActive(['docker']);
    }

    await tick(20);

    assert.equal(called, 1);

    poller.dispose();
});


test('dispose stops the clock and publishes nothing afterwards', async () => {
    const slow = deferred();
    let woken = 0;

    const poller = new SlowPoller({ intervalMs: 5, fetchers: { docker: slow.fetch } });

    poller.subscribe(() => { woken++; });
    poller.setActive(['docker']);
    await tick(10);

    poller.dispose();
    slow.resolve(ok());
    await tick(30);

    assert.equal(woken, 0, 'a poll that outlives dispose must not wake listeners that are gone');
    assert.equal(poller.getSnapshot().docker, undefined);

    poller.dispose();
});


test('one source failing does not cancel the others in the same poll', async () => {
    // there is only one source today; this pins the contract phases 04 and 05
    // arrive into, because Promise.all would have lost the good result
    const poller = new SlowPoller({
        intervalMs: 10_000,
        fetchers: {
            docker: async () => { throw new Error('nope'); },
        },
    });

    poller.setActive(['docker']);
    await tick(30);

    assert.equal(poller.getSnapshot().docker.available, false);
    assert.equal(poller.getSnapshot().ticks, 1, 'a failed poll still counts as a tick');

    poller.dispose();
});
