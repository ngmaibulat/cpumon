import test from 'node:test';
import assert from 'node:assert/strict';

import { getCpuDiff, getCpuInfo, toCpuInfo } from '../bin/CpuMonitor.js';


test('toCpuInfo counts nice and irq towards load and total', () => {
    // 100 ticks of niced work and 10 of irq are real load, not idle time
    const info = toCpuInfo('test cpu', {
        user: 200,
        nice: 100,
        sys: 90,
        idle: 600,
        irq: 10,
    });

    assert.equal(info.model, 'test cpu');
    assert.equal(info.total, 1000);
    assert.equal(info.idle, 600);
    assert.equal(info.load, 400);
});


test('toCpuInfo reports pure nice load as busy, not idle', () => {
    // regression: load used to be user + sys, so niced work reported 0%
    const prev = toCpuInfo('nice cpu', { user: 0, nice: 0, sys: 0, idle: 100, irq: 0 });
    const next = toCpuInfo('nice cpu', { user: 0, nice: 100, sys: 0, idle: 100, irq: 0 });

    const [diff] = getCpuDiff([prev], [next]);

    assert.equal(diff.loadRatio, 1);
    assert.equal(diff.loadPercentage, 100);
});


test('getCpuDiff computes the ratio over the sampling window', () => {
    const prev = [{ model: 'cpu0', idle: 100, load: 100, total: 200 }];
    const next = [{ model: 'cpu0', idle: 150, load: 150, total: 300 }];

    const [diff] = getCpuDiff(prev, next);

    assert.equal(diff.model, 'cpu0');
    assert.equal(diff.idle, 50);
    assert.equal(diff.load, 50);
    assert.equal(diff.total, 100);
    assert.equal(diff.loadRatio, 0.5);
    assert.equal(diff.loadPercentage, 50);
});


test('getCpuDiff reports 0 for an empty window instead of NaN', () => {
    // a sampling interval shorter than one clock tick gives total === 0
    const sample = [{ model: 'cpu0', idle: 100, load: 100, total: 200 }];

    const [diff] = getCpuDiff(sample, sample);

    assert.equal(diff.total, 0);
    assert.equal(diff.loadRatio, 0);
    assert.equal(diff.loadPercentage, 0);
    assert.ok(!Number.isNaN(diff.loadPercentage));
});


test('getCpuDiff throws when the core counts differ', () => {
    const prev = [{ model: 'cpu0', idle: 1, load: 1, total: 2 }];
    const next = [
        { model: 'cpu0', idle: 1, load: 1, total: 2 },
        { model: 'cpu1', idle: 1, load: 1, total: 2 },
    ];

    assert.throws(() => getCpuDiff(prev, next), /same lengths/);
});


test('getCpuInfo returns a consistent sample per core', () => {
    const cores = getCpuInfo();

    assert.ok(cores.length > 0);

    for (const core of cores) {
        assert.equal(typeof core.model, 'string');
        assert.equal(core.total, core.load + core.idle);
        assert.ok(Number.isFinite(core.total));
        assert.ok(core.load >= 0);
        assert.ok(core.idle >= 0);
    }
});
