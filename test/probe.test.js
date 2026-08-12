import test from 'node:test';
import assert from 'node:assert/strict';

import { isAvailable, unavailable } from '../bin/index.js';


test('unavailable omits detail when none is given', () => {
    const probe = unavailable('unsupported-platform');

    assert.deepEqual(probe, { available: false, reason: 'unsupported-platform' });
    // absent, not present-and-undefined - it has to survive a JSON round trip
    assert.ok(!('detail' in probe));
});


test('unavailable carries detail when given', () => {
    assert.deepEqual(unavailable('not-found', '/proc/meminfo'), {
        available: false,
        reason: 'not-found',
        detail: '/proc/meminfo',
    });
});


test('isAvailable discriminates both branches', () => {
    assert.equal(isAvailable(unavailable('parse-error')), false);
    assert.equal(isAvailable({ available: true, usedRatio: 0.5 }), true);
});


test('a probe survives a JSON round trip with its discriminant intact', () => {
    // --json consumers branch on `available`, so it must not be lost in transit
    const probe = { available: true, usedRatio: 0.5 };
    const back = JSON.parse(JSON.stringify(probe));

    assert.equal(isAvailable(back), true);
    assert.equal(back.usedRatio, 0.5);

    const failed = JSON.parse(JSON.stringify(unavailable('permission-denied', '/x')));

    assert.equal(isAvailable(failed), false);
    assert.equal(failed.reason, 'permission-denied');
});


test('the flattened success branch does not survive being an array', () => {
    // this is why every list-returning collector wraps its list in an object -
    // JSON.stringify drops non-index properties, taking the discriminant with it
    const asArray = Object.assign([{ pid: 1 }], { available: true });
    const back = JSON.parse(JSON.stringify(asArray));

    assert.equal(back.available, undefined);

    const wrapped = JSON.parse(JSON.stringify({ available: true, processes: [{ pid: 1 }] }));

    assert.equal(wrapped.available, true);
    assert.equal(wrapped.processes.length, 1);
});
