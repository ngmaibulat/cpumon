import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SIGNAL,
    KillModal,
    Ring,
    SIGNALS,
    initialUi,
    reduce,
    resolve,
    sendSignal,
} from '../dist/internal.js';

import { assertFits, draw, h, lines, plain } from './helpers/render.js';


const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), ...over });

const key = (over = {}) => ({
    ctrl: false, shift: false, meta: false,
    escape: false, return: false, tab: false,
    backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false, f1: false,
    ...over,
});

const target = (over = {}) => ({ pid: 4321, comm: 'postgres', threads: 8, ...over });


/** every call is recorded; nothing in this file signals a real process */
const spy = () => {
    const calls = [];
    const fn = (pid, signal) => { calls.push({ pid, signal }); };

    fn.calls = calls;

    return fn;
};


test('the default signal is the recoverable one', () => {
    assert.equal(DEFAULT_SIGNAL, 'SIGTERM');
    assert.equal(SIGNALS[0].name, 'SIGTERM');
});


test('SIGKILL is last, below two recoverable options', () => {
    // a mis-aimed keypress in a list should land on something survivable
    assert.equal(SIGNALS.at(-1).name, 'SIGKILL');

    const kill = SIGNALS.findIndex(s => s.name === 'SIGKILL');
    const cont = SIGNALS.findIndex(s => s.name === 'SIGCONT');

    assert.ok(cont < kill);
});


test('the forceful signals are flagged as such', () => {
    const forceful = SIGNALS.filter(s => s.forceful).map(s => s.name);

    assert.deepEqual(forceful.sort(), ['SIGKILL', 'SIGSTOP']);
});


test('sending a signal calls kill with exactly the pid and signal chosen', () => {
    const kill = spy();
    const result = sendSignal(4321, 'SIGTERM', kill);

    assert.deepEqual(kill.calls, [{ pid: 4321, signal: 'SIGTERM' }]);
    assert.equal(result.ok, true);
    assert.match(result.message, /sent SIGTERM to 4321/);
});


test('a negative pid is refused rather than passed to the syscall', () => {
    // kill(2) reads a negative pid as a process *group*, so this would not
    // fail - it would signal very much more than was asked for
    const kill = spy();

    for (const pid of [-1, 0, -4321, 1.5, NaN]) {
        const result = sendSignal(pid, 'SIGTERM', kill);

        assert.equal(result.ok, false, String(pid));
        assert.match(result.message, /refusing/);
    }

    assert.deepEqual(kill.calls, [], 'nothing should have reached kill');
});


test('a permission failure is reported, not thrown', () => {
    // an exception here would tear down the render tree over something that
    // deserves one line in the footer
    const result = sendSignal(1, 'SIGTERM', () => {
        const err = new Error('operation not permitted');
        err.code = 'EPERM';
        throw err;
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /not permitted/);
    assert.match(result.message, /another user/);
});


test('a process that has already exited is reported plainly', () => {
    const result = sendSignal(999, 'SIGTERM', () => {
        const err = new Error('no such process');
        err.code = 'ESRCH';
        throw err;
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /already gone/);
});


test('an unknown failure still produces a message rather than an exception', () => {
    const result = sendSignal(1, 'SIGTERM', () => { throw new Error('something else'); });

    assert.equal(result.ok, false);
    assert.match(result.message, /something else/);
});


test('opening the modal pins what the user is looking at', () => {
    // not the selection index, and not just the pid: the name is pinned too, so
    // the thing on screen and the thing that gets signalled are one object
    const state = reduce(ui(), { type: 'kill-open', target: target() });

    assert.equal(state.overlay, 'kill');
    assert.deepEqual(state.killTarget, target());
});


test('the modal always opens on the default signal', () => {
    // a SIGKILL chosen for one process must not be sitting pre-selected for the
    // next one
    const chose = reduce(ui(), { type: 'kill-open', target: target() });
    const moved = reduce(chose, { type: 'kill-move', delta: -1 });

    assert.equal(moved.signal, 'SIGKILL');

    const reopened = reduce(reduce(moved, { type: 'kill-close' }), { type: 'kill-open', target: target() });

    assert.equal(reopened.signal, 'SIGTERM');
});


test('the signal list wraps in both directions', () => {
    let state = reduce(ui(), { type: 'kill-open', target: target() });

    for (const expected of [...SIGNALS.slice(1), SIGNALS[0]]) {
        state = reduce(state, { type: 'kill-move', delta: 1 });
        assert.equal(state.signal, expected.name);
    }
});


test('closing the modal forgets the target', () => {
    // so a later `y` cannot reach a process nobody is looking at any more
    const open = reduce(ui(), { type: 'kill-open', target: target() });
    const closed = reduce(open, { type: 'kill-close' });

    assert.equal(closed.overlay, 'none');
    assert.equal(closed.killTarget, null);
    assert.equal(closed.signal, DEFAULT_SIGNAL);
});


test('escape closes the modal and forgets the target', () => {
    const open = reduce(ui(), { type: 'kill-open', target: target() });
    const closed = reduce(open, { type: 'escape' });

    assert.equal(closed.overlay, 'none');
    assert.equal(closed.killTarget, null);
});


test('the keymap hands every key to the modal while it is up', () => {
    // nothing may reach the table underneath and move the selection out from
    // under the pid being confirmed
    const open = ui({ overlay: 'kill', killTarget: target() });

    for (const input of ['q', 'j', 'k', 'y', 'n', '/', 'K', 'm', 'r', 't', ' ']) {
        assert.equal(resolve(input, key(), open), null, input);
    }

    assert.equal(resolve('', key({ escape: true }), open), null);
});


test('the modal names the process and its pid', () => {
    const output = plain(draw(
        h(KillModal, { width: 60, height: 16, target: target(), signal: 'SIGTERM', allowed: true }),
        { columns: 60 }));

    assert.match(output, /postgres/);
    assert.match(output, /pid 4321/);
    assert.match(output, /8 threads/);
});


test('the modal marks the chosen signal and says which key sends it', () => {
    const output = plain(draw(
        h(KillModal, { width: 60, height: 16, target: target(), signal: 'SIGHUP', allowed: true }),
        { columns: 60 }));

    assert.match(output, /▸ SIGHUP/);
    assert.match(output, /y send SIGHUP/);
    assert.match(output, /Esc cancel/);
    // Enter is muscle memory in the list this was opened from, so it must not
    // be offered as the confirmation
    assert.doesNotMatch(output, /Enter/);
});


test('an uncatchable signal warns about what it means', () => {
    const output = plain(draw(
        h(KillModal, { width: 70, height: 16, target: target(), signal: 'SIGKILL', allowed: true }),
        { columns: 70 }));

    assert.match(output, /cannot be caught/);
    assert.match(output, /no cleanup/);
});


test('a recoverable signal carries no warning', () => {
    // the phrase appears in SIGKILL's own list entry too, so this checks for
    // the warning line rather than for the words
    const output = plain(draw(
        h(KillModal, { width: 70, height: 16, target: target(), signal: 'SIGTERM', allowed: true }),
        { columns: 70 }));

    assert.doesNotMatch(output, /no cleanup, no saving/);
    assert.doesNotMatch(output, /the process freezes until SIGCONT/);
});


test('without --allow-kill the modal explains rather than offering to send', () => {
    const output = plain(draw(
        h(KillModal, { width: 60, height: 16, target: target(), signal: 'SIGTERM', allowed: false }),
        { columns: 60 }));

    assert.match(output, /disabled/);
    assert.match(output, /--allow-kill/);
    assert.doesNotMatch(output, /y send/);
});


test('the modal fits every size it might be given', () => {
    for (const width of [30, 50, 80, 120]) {
        for (const height of [6, 12, 20, 30]) {
            const output = draw(
                h(KillModal, { width, height, target: target(), signal: 'SIGKILL', allowed: true }),
                { columns: width });

            assertFits(assert, output, width, `${width}x${height}: `);
            assert.equal(lines(output).length, height, `${width}x${height} height`);
        }
    }
});


test('a modal with nothing selected says so rather than showing a blank form', () => {
    const output = plain(draw(
        h(KillModal, { width: 50, height: 10, target: null, signal: 'SIGTERM', allowed: true }),
        { columns: 50 }));

    assert.match(output, /no process selected/);
});
