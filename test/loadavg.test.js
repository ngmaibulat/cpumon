import test from 'node:test';
import assert from 'node:assert/strict';

import { getLoadAverage, toLoadAverage } from '../bin/collectors/loadavg.js';


test('toLoadAverage divides each figure by the core count', () => {
    const load = toLoadAverage([8, 4, 2], 16);

    assert.equal(load.one, 8);
    assert.equal(load.cores, 16);
    assert.equal(load.onePerCore, 0.5);
    assert.equal(load.fivePerCore, 0.25);
    assert.equal(load.fifteenPerCore, 0.125);
});


test('a load of 1.0 per core means fully committed regardless of size', () => {
    assert.equal(toLoadAverage([2, 2, 2], 2).onePerCore, 1);
    assert.equal(toLoadAverage([64, 64, 64], 64).onePerCore, 1);
});


test('a zero core count reports 0 rather than dividing into Infinity', () => {
    const load = toLoadAverage([1, 1, 1], 0);

    assert.equal(load.onePerCore, 0);
    assert.ok(Number.isFinite(load.fifteenPerCore));
});


test('Windows reports not-applicable rather than a fake idle machine', { skip: process.platform !== 'win32' }, () => {
    // os.loadavg() returns [0, 0, 0] there, which would render as permanently idle
    const probe = getLoadAverage();

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-applicable');
});


test('load average is available on Linux and macOS', { skip: process.platform === 'win32' }, () => {
    const probe = getLoadAverage();

    assert.equal(probe.available, true);
    assert.ok(probe.cores > 0);
    assert.ok(probe.one >= 0);
    assert.equal(probe.onePerCore, probe.one / probe.cores);
});
