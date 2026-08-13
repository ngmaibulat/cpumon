import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';

import { installLifecycle } from '../dist/internal.js';


/** a stand-in for process, so a test can fire signals without receiving them */
function fakeProcess()
{
    const emitter = new EventEmitter();

    const proc = {
        once: (event, handler) => emitter.once(event, handler),
        off: (event, handler) => emitter.off(event, handler),
        emit: (event, payload) => emitter.emit(event, payload),
        exits: [],
        exit: code => { proc.exits.push(code); },
        listenerCount: event => emitter.listenerCount(event),
    };

    return proc;
}


/** an ink instance that records the order things happened in */
function fakeInstance(log)
{
    return {
        unmount: () => log.push('unmount'),
        waitUntilExit: async () => { log.push('restored'); },
    };
}


const settle = () => new Promise(resolve => { setImmediate(resolve); });


test('a signal restores the terminal before the process exits', () => {
    const log = [];
    const proc = fakeProcess();

    installLifecycle(fakeInstance(log), () => log.push('dispose'), proc);

    proc.emit('SIGINT');

    return settle().then(() => {
        assert.deepEqual(log, ['dispose', 'unmount', 'restored']);
        // the shell convention: killed by signal N means exit 128 + N
        assert.deepEqual(proc.exits, [130]);
    });
});


test('each signal reports its own exit code', async () => {
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
        const proc = fakeProcess();

        installLifecycle(fakeInstance([]), () => {}, proc);
        proc.emit(signal);

        await settle();

        assert.deepEqual(proc.exits, [code], signal);
    }
});


test('a crash restores the terminal before printing the stack', async () => {
    // Ink treats alternate-screen teardown output as disposable, so a handler
    // that prints and then unmounts writes the trace onto a screen the terminal
    // is about to throw away - and the process dies silently.
    const log = [];
    const proc = fakeProcess();
    const errors = [];
    const original = console.error;

    console.error = message => errors.push(String(message));

    try {
        installLifecycle(fakeInstance(log), () => log.push('dispose'), proc);
        proc.emit('uncaughtException', new Error('boom'));

        await settle();
    }
    finally {
        console.error = original;
    }

    assert.deepEqual(log, ['dispose', 'unmount', 'restored']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /boom/);
    assert.deepEqual(proc.exits, [1]);
});


test('a rejection is handled the same way as a throw', async () => {
    const proc = fakeProcess();
    const errors = [];
    const original = console.error;

    console.error = message => errors.push(String(message));

    try {
        installLifecycle(fakeInstance([]), () => {}, proc);
        proc.emit('unhandledRejection', new Error('rejected'));

        await settle();
    }
    finally {
        console.error = original;
    }

    assert.match(errors[0], /rejected/);
    assert.deepEqual(proc.exits, [1]);
});


test('a second signal during teardown does not start a second one', async () => {
    // Ctrl-C twice in quick succession is the normal way to meet this
    const log = [];
    const proc = fakeProcess();

    const lifecycle = installLifecycle(fakeInstance(log), () => log.push('dispose'), proc);

    await lifecycle.restore();
    await lifecycle.restore();

    assert.deepEqual(log, ['dispose', 'unmount', 'restored']);
});


test('a failing unmount still lets the process exit', async () => {
    // the terminal may already be gone; hanging on the way out is worse than
    // an untidy exit
    const proc = fakeProcess();

    installLifecycle({
        unmount: () => {},
        waitUntilExit: async () => { throw new Error('stream closed'); },
    }, () => {}, proc);

    proc.emit('SIGTERM');

    await settle();

    assert.deepEqual(proc.exits, [143]);
});


test('dispose detaches every handler it installed', () => {
    // the handlers hold the store and the ink instance; leaving them attached
    // after a normal quit keeps both alive
    const proc = fakeProcess();

    const lifecycle = installLifecycle(fakeInstance([]), () => {}, proc);

    assert.ok(proc.listenerCount('SIGINT') > 0);

    lifecycle.dispose();

    for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection']) {
        assert.equal(proc.listenerCount(event), 0, event);
    }
});


test('the binary refuses every environment it cannot draw in, and says why', () => {
    const bin = new URL('../dist/cli.js', import.meta.url).pathname;

    const run = env => {
        try {
            execFileSync(process.execPath, [bin], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...env },
            });

            return { status: 0, stdout: '', stderr: '' };
        }
        catch (err) {
            return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
        }
    };

    for (const env of [{}, { CI: 'true' }, { TERM: 'dumb' }, { NO_COLOR: '1' }]) {
        const result = run(env);

        assert.equal(result.status, 1, JSON.stringify(env));
        // never on stdout: whatever is reading that pipe wants data, and a
        // friendly message is still garbage to it
        assert.equal(result.stdout, '', JSON.stringify(env));
        assert.match(result.stderr, /etop:/, JSON.stringify(env));
        // and always with somewhere else to go
        assert.match(result.stderr, /cpumon/, JSON.stringify(env));
    }
});
