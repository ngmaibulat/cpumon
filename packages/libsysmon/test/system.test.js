import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { SystemMonitor, sampleSystem } from '../bin/SystemMonitor.js';
import { pkgUrl } from './helpers/fixtures.js';


// see lifecycle.test.js: a --eval child resolves a relative specifier against
// its cwd, so the specifier has to be absolute
const MONITOR = JSON.stringify(pkgUrl('bin/SystemMonitor.js'));


function onceSample(monitor, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            monitor.stopMonitor();
            reject(new Error('no sample within the timeout'));
        }, timeoutMs);

        monitor.once('sample', snapshot => {
            clearTimeout(timer);
            resolve(snapshot);
        });
    });
}


test('sampleSystem returns only what was asked for', () => {
    const snapshot = sampleSystem({ collect: ['memory'] });

    assert.equal(typeof snapshot.memory.total, 'number');
    assert.equal(snapshot.load, undefined);
    assert.equal(snapshot.disk, undefined);
    // no window was measured, so nothing counter-derived can be present
    assert.equal(snapshot.elapsedMs, 0);
    assert.equal(snapshot.network, undefined);
});


test('sampleSystem collects each of the point-in-time metrics', () => {
    const snapshot = sampleSystem({ collect: ['memory', 'load', 'disk'] });

    assert.ok(snapshot.memory);
    assert.equal(typeof snapshot.load.available, 'boolean');
    assert.equal(typeof snapshot.disk.available, 'boolean');
});


test('a monitor emits a sample with a real elapsed window', async () => {
    const mon = new SystemMonitor({ intervalMs: 60, collect: ['cpu'], unref: true });
    const snapshot = await onceSample(mon);

    mon.stopMonitor();

    assert.ok(Array.isArray(snapshot.cpu));
    assert.ok(snapshot.cpu.length > 0);
    assert.equal(typeof snapshot.cpuOverall.loadPercentage, 'number');
    // elapsedMs comes from the clock, not from intervalMs: setInterval drifts
    // and every derived rate would inherit the error
    assert.ok(snapshot.elapsedMs > 0);
    assert.ok(snapshot.timestamp > 0);
});


test('network rates arrive with a window attached', { skip: process.platform !== 'linux' }, async () => {
    const mon = new SystemMonitor({ intervalMs: 60, collect: ['network'], unref: true });
    const snapshot = await onceSample(mon);

    mon.stopMonitor();

    assert.equal(snapshot.network.available, true);
    assert.ok(snapshot.network.interfaces.length > 0);
    assert.equal(snapshot.network.elapsedMs, snapshot.elapsedMs);

    for (const iface of snapshot.network.interfaces) {
        assert.ok(iface.rxBytesPerSec >= 0);
        assert.ok(Number.isFinite(iface.txBytesPerSec));
    }
});


test('stopMonitor keeps listeners attached', async () => {
    const mon = new SystemMonitor({ intervalMs: 40, collect: ['cpu'], unref: true });

    await onceSample(mon);
    mon.stopMonitor();

    assert.equal(mon.running, false);
    // the caller's handlers are theirs; stopping must not detach them
    mon.on('sample', () => {});
    mon.start();

    await onceSample(mon);
    mon.stopMonitor();
});


test('a stopped monitor can be restarted', async () => {
    const mon = new SystemMonitor({ intervalMs: 40, collect: ['cpu'], unref: true });

    await onceSample(mon);
    mon.stopMonitor();
    assert.equal(mon.running, false);

    mon.start();
    assert.equal(mon.running, true);

    await onceSample(mon);
    mon.close();
    assert.equal(mon.running, false);
});


test('start() on a running monitor is a no-op', () => {
    const mon = new SystemMonitor({ intervalMs: 1000, collect: ['cpu'], unref: true });
    const id = mon.intervalId;

    mon.start();

    assert.equal(mon.intervalId, id);
    mon.stopMonitor();
});


test('both constructor forms are accepted', () => {
    const fromNumber = new SystemMonitor(500);
    const fromOptions = new SystemMonitor({ intervalMs: 500 });

    assert.equal(fromNumber.ms, 500);
    assert.equal(fromOptions.ms, 500);

    fromNumber.stopMonitor();
    fromOptions.stopMonitor();
});


test('unref lets the process exit on its own', () => {
    // without unref the sampling timer holds the loop open and this hangs
    const source = `
        import { SystemMonitor } from ${MONITOR};
        new SystemMonitor({ intervalMs: 60000, unref: true });
    `;

    const started = Date.now();

    execFileSync(process.execPath, ['--input-type=module', '-e', source], {
        timeout: 5000,
        stdio: 'ignore',
    });

    assert.ok(Date.now() - started < 5000);
});
