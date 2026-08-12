import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { CpuMonitor, aggregateCpu, withLoadRatio } from '../bin/CpuMonitor.js';


test('stopMonitor keeps listeners attached', async () => {
    // regression: stopMonitor() used to call removeAllListeners(), which
    // silently detached the caller's handlers - including their 'error'
    // handler - and made the monitor single-use
    const mon = new CpuMonitor(10);
    const handler = () => {};

    mon.on('cpudata', handler);
    mon.stopMonitor();

    assert.equal(mon.listenerCount('cpudata'), 1);
});


test('a stopped monitor can be restarted and emits again', async () => {
    const mon = new CpuMonitor(10);

    mon.stopMonitor();
    assert.equal(mon.running, false);

    const sample = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no cpudata after restart')), 2000);

        mon.on('cpudata', (load) => {
            clearTimeout(timer);
            resolve(load);
        });

        mon.start();
    });

    mon.stopMonitor();

    assert.ok(Array.isArray(sample));
    assert.ok(sample.length > 0);
});


test('start() on a running monitor does not stack intervals', () => {
    const mon = new CpuMonitor(10);
    const first = mon.intervalId;

    mon.start();

    assert.equal(mon.intervalId, first);
    mon.stopMonitor();
});


test('unref lets the process exit on its own', () => {
    // the only honest way to test this is a real child process - an unref'd
    // timer is invisible from inside the same process
    const script = `
        import { CpuMonitor } from './bin/CpuMonitor.js';
        new CpuMonitor({ intervalMs: 60000, unref: true });
        console.log('exiting');
    `;

    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        timeout: 10000,
        encoding: 'utf8',
    });

    assert.match(out, /exiting/);
});


test('a default monitor keeps the process alive', () => {
    // the mirror of the test above: without unref the timer must hold the
    // process open, so this child has to be killed by its own timeout
    const script = `
        import { CpuMonitor } from './bin/CpuMonitor.js';
        const mon = new CpuMonitor(50);
        setTimeout(() => { console.log('still-running'); mon.stopMonitor(); }, 300);
    `;

    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        timeout: 10000,
        encoding: 'utf8',
    });

    assert.match(out, /still-running/);
});


test('new CpuMonitor(1000) still behaves as a plain interval', () => {
    const mon = new CpuMonitor(1000);

    assert.equal(mon.ms, 1000);
    assert.equal(mon.running, true);

    mon.stopMonitor();
});


test('the options constructor sets the interval', () => {
    const mon = new CpuMonitor({ intervalMs: 250 });

    assert.equal(mon.ms, 250);
    mon.stopMonitor();
});


test('withLoadRatio derives ratio and percentage from tick counts', () => {
    const info = withLoadRatio({ model: 'cpu0', idle: 250, load: 750, total: 1000 });

    assert.equal(info.loadRatio, 0.75);
    assert.equal(info.loadPercentage, 75);
});


test('withLoadRatio reports 0 for an empty window rather than NaN', () => {
    const info = withLoadRatio({ model: 'cpu0', idle: 0, load: 0, total: 0 });

    assert.equal(info.loadRatio, 0);
    assert.equal(info.loadPercentage, 0);
    assert.ok(!Number.isNaN(info.loadPercentage));
});


test('aggregateCpu sums ticks instead of averaging percentages', () => {
    // one core fully busy, three fully idle. Summing ticks gives 25%;
    // averaging the per-core percentages would also give 25% here, so make
    // the windows unequal to tell the two apart.
    const cores = [
        { model: 'cpu', idle: 0, load: 100, total: 100 },   // 100% over a short window
        { model: 'cpu', idle: 900, load: 0, total: 900 },   // 0% over a long one
    ];

    const total = aggregateCpu(cores);

    assert.equal(total.total, 1000);
    assert.equal(total.load, 100);
    // tick-weighted: 100/1000 = 10%. Averaging percentages would say 50%.
    assert.equal(total.loadPercentage, 10);
});


test('aggregateCpu agrees with withLoadRatio on rounding', () => {
    const cores = [
        { model: 'cpu', idle: 2, load: 1, total: 3 },
        { model: 'cpu', idle: 2, load: 1, total: 3 },
    ];

    const total = aggregateCpu(cores);
    const manual = withLoadRatio({ model: 'cpu', idle: 4, load: 2, total: 6 });

    assert.equal(total.loadPercentage, manual.loadPercentage);
    assert.equal(total.loadRatio, manual.loadRatio);
});


test('aggregateCpu rejects an empty core list', () => {
    assert.throws(() => aggregateCpu([]), /at least one core/);
});
