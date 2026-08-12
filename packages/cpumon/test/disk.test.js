import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { defaultMount, getDiskUsage, toDiskInfo } from '../bin/collectors/disk.js';


test('toDiskInfo scales every figure by the block size', () => {
    const info = toDiskInfo('/', { bsize: 4096, blocks: 1000, bfree: 400, bavail: 400 });

    assert.equal(info.size, 4096 * 1000);
    assert.equal(info.free, 4096 * 400);
    assert.equal(info.available, 4096 * 400);
    assert.equal(info.used, 4096 * 600);
});


test('the root reserve is not counted as free, matching df', () => {
    // 1000 blocks, 400 free, but only 350 available to a normal user: the 50
    // block reserve must not be presented as usable space
    const info = toDiskInfo('/', { bsize: 1, blocks: 1000, bfree: 400, bavail: 350 });

    assert.equal(info.used, 600);
    assert.equal(info.available, 350);
    // 600 / (600 + 350), not 600 / 1000
    assert.equal(info.usedRatio, 600 / 950);
    assert.equal(info.usedPercentage, 63);
});


test('an empty filesystem reports 0 rather than dividing into NaN', () => {
    const info = toDiskInfo('/', { bsize: 4096, blocks: 0, bfree: 0, bavail: 0 });

    assert.equal(info.usedRatio, 0);
    assert.equal(info.usedPercentage, 0);
});


test('defaultMount is the current filesystem root, not a hardcoded slash', () => {
    // '/' on Linux and macOS, 'C:\' on Windows
    assert.equal(defaultMount(), path.parse(process.cwd()).root);
});


test('a real filesystem reports plausible usage', () => {
    const probe = getDiskUsage();

    if (!probe.available) {
        // only legitimate on a Node older than 18.15
        assert.equal(probe.reason, 'unsupported-platform');
        return;
    }

    assert.ok(probe.disk.size > 0);
    assert.ok(probe.disk.used <= probe.disk.size);
    assert.ok(probe.disk.usedPercentage >= 0 && probe.disk.usedPercentage <= 100);
});


test('a mistyped path is an unavailable answer, not a thrown error', () => {
    const probe = getDiskUsage('/definitely/not/a/mount/point');

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
});


test('the payload is wrapped so the usable byte count cannot eat the discriminant', () => {
    const probe = getDiskUsage();

    if (probe.available) {
        assert.equal(probe.available, true);
        assert.equal(typeof probe.disk.available, 'number');
    }
});
