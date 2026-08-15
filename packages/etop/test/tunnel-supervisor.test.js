/**
 * The tunnel supervisor.
 *
 * Every test here drives a fake child. Nothing in this file - or anywhere in
 * the suite - starts a real ssh, which is the same guarantee `signals.test.js`
 * gets from injecting its killer.
 *
 * Timers are real but tiny: a 1ms base delay and an explicit clock, following
 * the style slow.test.js already uses. That keeps the no-overlap and
 * cancellation properties honest, which a mocked timer would not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { TunnelSupervisor, parseTunnelConfig } from '../dist/internal.js';


const config = (over = {}) => {
    const result = parseTunnelConfig(JSON.stringify({
        tunnels: {
            squid: {
                host: 'h',
                user: 'root',
                forwards: [{ local: '3128:localhost:3128' }],
                ...over,
            },
        },
    }));

    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));

    return result.config;
};


/** a child that does nothing until a test tells it to exit */
function fakeChild(pid = 4242)
{
    const listeners = { exit: [], error: [], data: [] };

    return {
        pid,
        killed: [],
        stderr: { on: (_event, fn) => listeners.data.push(fn) },
        on: (event, fn) => listeners[event].push(fn),
        kill(signal) {
            this.killed.push(signal);

            return true;
        },
        emitExit(code, signal = null) {
            for (const fn of listeners.exit) {
                fn(code, signal);
            }
        },
        emitError(err) {
            for (const fn of listeners.error) {
                fn(err);
            }
        },
        say(text) {
            for (const fn of listeners.data) {
                fn(text);
            }
        },
    };
}


/** a spawner that records every call and hands back controllable children */
function fakeSpawner()
{
    const calls = [];
    const children = [];

    const spawner = (command, args) => {
        const child = fakeChild(4000 + children.length);

        calls.push({ command, args });
        children.push(child);

        return child;
    };

    return { spawner, calls, children, last: () => children.at(-1) };
}


const settle = (ms = 5) => new Promise(resolve => { setTimeout(resolve, ms); });

const statusOf = (supervisor, name = 'squid') =>
    supervisor.getSnapshot().statuses.find(status => status.tunnel.name === name);


/** every supervisor a test builds, so nothing leaks a timer between tests */
const build = (t, options = {}) => {
    const supervisor = new TunnelSupervisor({
        graceMs: 1,
        termGraceMs: 1,
        backoff: { baseMs: 1, capMs: 4, random: () => 1 },
        ...options,
    });

    t.after(() => supervisor.dispose());

    return supervisor;
};


test('getSnapshot returns the same object until something changes', () => {
    // the single most important assertion here. A fresh object per call makes
    // useSyncExternalStore re-render for ever: the app pins a core at 100% and
    // never draws a second frame, and it looks exactly like a slow renderer.
    const supervisor = new TunnelSupervisor({ config: config() });

    assert.equal(supervisor.getSnapshot(), supervisor.getSnapshot());

    supervisor.dispose();
});


test('a configured tunnel starts idle, not running', async t => {
    const { spawner, calls } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    assert.equal(statusOf(supervisor).phase, 'idle');
    assert.equal(calls.length, 0);
});


test('autostart starts only the tunnels that asked for it', async t => {
    const { spawner, calls } = fakeSpawner();
    const quiet = build(t, { config: config(), spawner });

    quiet.startAutostart();
    assert.equal(calls.length, 0);

    const eager = build(t, { config: config({ autostart: true }), spawner });

    eager.startAutostart();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'ssh');
    assert.ok(calls[0].args.includes('-L'));
});


test('a child that survives the grace period is up', async t => {
    const { spawner } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    assert.equal(statusOf(supervisor).phase, 'starting');

    await settle();

    // `ssh -N` prints nothing on success, so surviving is the signal - which is
    // honest only because ExitOnForwardFailure makes a bad forward exit at once
    assert.equal(statusOf(supervisor).phase, 'up');
    assert.equal(statusOf(supervisor).pid, 4000);
});


test('a retryable exit backs off and then respawns', async t => {
    const { spawner, calls, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    last().say('ssh: connect to host h port 22: Connection refused');
    last().emitExit(255);

    assert.equal(statusOf(supervisor).phase, 'backoff');
    assert.match(statusOf(supervisor).message, /refused/);

    await settle(20);

    assert.equal(calls.length, 2, 'expected a second spawn after the backoff');
});


test('a fatal exit stops for good and never spawns again', async t => {
    const { spawner, calls, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    last().say('root@h: Permission denied (publickey).');
    last().emitExit(255);

    assert.equal(statusOf(supervisor).phase, 'failed');
    assert.match(statusOf(supervisor).message, /ssh-add/);

    // the hot-loop guard: a key that is not in the agent fails identically for
    // ever, and retrying it every second is a busy loop with a misleading
    // "retrying" on screen
    await settle(30);

    assert.equal(calls.length, 1);
    assert.equal(supervisor.spawns, 1);
});


test('consecutive failures back off further each time', async t => {
    const delays = [];
    const { spawner, children } = fakeSpawner();

    const supervisor = build(t, {
        config: config(),
        spawner,
        // random: () => 1 is the top of the jitter range, so the delay is the
        // full ceiling and the growth is the thing under test rather than luck
        backoff: { baseMs: 4, capMs: 10_000, random: () => 1 },
        now: () => 0,
    });

    supervisor.command('start', 'squid');

    // let each retry actually fire rather than forcing it: an explicit
    // stop/start would reset the attempt counter, which is deliberate
    // ("I asked for this one, start from scratch") and would measure nothing
    for (let i = 0; i < 3; i++) {
        children.at(-1).emitExit(255);
        delays.push(statusOf(supervisor).retryAt);

        await settle(30);
    }

    assert.deepEqual(delays, [4, 8, 16], `expected doubling, got ${delays.join(', ')}`);
});


test('a connection that held resets the backoff', async t => {
    // without this, a tunnel that dies after three seconds looks like a first
    // failure every time and retries at one-second intervals for ever
    let clock = 0;
    const { spawner, last } = fakeSpawner();

    const supervisor = build(t, {
        config: config(),
        spawner,
        graceMs: 1,
        backoff: { baseMs: 4, capMs: 10_000, random: () => 1 },
        now: () => clock,
    });

    supervisor.command('start', 'squid');
    await settle();

    assert.equal(statusOf(supervisor).phase, 'up');

    // two minutes of uptime, comfortably past STABLE_MS
    clock = 120_000;
    last().emitExit(255);

    assert.equal(statusOf(supervisor).attempt, 1, 'the first retry after a stable run');
    assert.equal(statusOf(supervisor).retryAt - clock, 4);
});


test('stop means stop: the exit that follows does not respawn', async t => {
    // the reconnect loop you cannot escape, and the reason intent is tracked
    // separately from the phase
    const { spawner, calls, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');

    const child = last();

    supervisor.command('stop', 'squid');

    assert.equal(statusOf(supervisor).phase, 'stopping');
    assert.deepEqual(child.killed, ['SIGTERM']);

    child.emitExit(null, 'SIGTERM');

    assert.equal(statusOf(supervisor).phase, 'stopped');

    await settle(20);

    assert.equal(calls.length, 1, 'a stopped tunnel must not come back');
});


test('a child that ignores SIGTERM is escalated to SIGKILL', async t => {
    const { spawner, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');

    const child = last();

    supervisor.command('stop', 'squid');

    await settle(20);

    // otherwise it holds its ports for ever and the next start cannot bind
    assert.deepEqual(child.killed, ['SIGTERM', 'SIGKILL']);
});


test('stop during a backoff cancels the pending retry', async t => {
    const { spawner, calls, last } = fakeSpawner();

    const supervisor = build(t, {
        config: config(),
        spawner,
        backoff: { baseMs: 30, capMs: 30, random: () => 1 },
    });

    supervisor.command('start', 'squid');
    last().emitExit(255);

    assert.equal(statusOf(supervisor).phase, 'backoff');

    supervisor.command('stop', 'squid');

    await settle(60);

    assert.equal(calls.length, 1, 'the cancelled timer still fired');
    assert.equal(statusOf(supervisor).phase, 'stopped');
});


test('restart clears a failed state and tries again', async t => {
    const { spawner, calls, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    last().say('Host key verification failed.');
    last().emitExit(255);

    assert.equal(statusOf(supervisor).phase, 'failed');

    // "I have fixed it, try now" is the whole point of the key
    const result = supervisor.command('restart', 'squid');

    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(statusOf(supervisor).attempt, 0);
});


test('toggle starts what is stopped and stops what is running', async t => {
    const { spawner } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('toggle', 'squid');
    assert.equal(statusOf(supervisor).phase, 'starting');

    supervisor.command('toggle', 'squid');
    assert.equal(statusOf(supervisor).phase, 'stopping');
});


test('a command for a tunnel that is not there is a message, not a throw', async t => {
    const supervisor = build(t, { config: config() });

    assert.doesNotThrow(() => supervisor.command('start', 'nope'));

    assert.deepEqual(supervisor.command('start', 'nope'), {
        ok: false,
        message: 'no tunnel named nope',
    });

    // the empty name is what the keymap emits when no row is selected
    assert.match(supervisor.command('start', '').message, /no tunnel selected/);
});


test('a spawner that throws is a failure, not a crash', async t => {
    const supervisor = build(t, {
        config: config(),
        spawner: () => { throw Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }); },
    });

    assert.doesNotThrow(() => supervisor.command('start', 'squid'));

    assert.equal(statusOf(supervisor).phase, 'failed');
    assert.match(statusOf(supervisor).message, /could not run ssh/);
});


test('stderr is kept as a bounded tail, not a transcript', async t => {
    const { spawner, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');

    for (let i = 0; i < 50; i++) {
        last().say(`line ${i}\n`);
    }

    const { output } = statusOf(supervisor);

    // a tunnel failing every second all night must not grow an array until the
    // process dies of it
    assert.ok(output.length <= 8, `kept ${output.length} lines`);
    assert.equal(output.at(-1), 'line 49');
});


test('reload keeps a tunnel whose command did not change', async t => {
    const { spawner, calls } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    await settle();

    const before = statusOf(supervisor).upSince;

    // saving the file after fixing an unrelated typo must not drop every
    // connection you had
    supervisor.adopt(config());

    assert.equal(calls.length, 1);
    assert.equal(statusOf(supervisor).phase, 'up');
    assert.equal(statusOf(supervisor).upSince, before);
});


test('reload restarts a tunnel whose command changed, once the old one is gone', async t => {
    const { spawner, calls, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');
    await settle();

    const old = last();

    supervisor.adopt(config({ forwards: [{ local: '9999:localhost:80' }] }));

    // SIGTERM is asynchronous, so the replacement cannot spawn yet: two ssh
    // processes fighting over the same local port is exactly the state
    // ExitOnForwardFailure would then turn into a failure
    assert.deepEqual(old.killed, ['SIGTERM']);
    assert.equal(calls.length, 1);

    old.emitExit(null, 'SIGTERM');

    assert.equal(calls.length, 2);
    assert.ok(calls[1].args.includes('9999:localhost:80'));
    assert.equal(statusOf(supervisor).phase, 'starting');
});


test('reload stops a tunnel that left the config', async t => {
    const { spawner, last } = fakeSpawner();
    const supervisor = build(t, { config: config(), spawner });

    supervisor.command('start', 'squid');

    const child = last();

    supervisor.adopt({ version: 1, tunnels: [] });

    assert.deepEqual(child.killed, ['SIGTERM']);
    assert.equal(supervisor.getSnapshot().statuses.length, 0);
});


test('dispose kills every live child', async t => {
    const { spawner, last } = fakeSpawner();
    const supervisor = new TunnelSupervisor({ config: config(), spawner, graceMs: 1 });

    supervisor.command('start', 'squid');

    const child = last();

    // `kill <etop-pid>` from outside the terminal does not reach the children,
    // so leaving this implicit would orphan them holding their ports
    supervisor.dispose();

    assert.deepEqual(child.killed, ['SIGTERM']);
});


test('a disposed supervisor refuses further commands', async () => {
    const supervisor = new TunnelSupervisor({ config: config() });

    supervisor.dispose();

    assert.equal(supervisor.command('start', 'squid').ok, false);
});
