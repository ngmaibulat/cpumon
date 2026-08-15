import test from 'node:test';
import assert from 'node:assert/strict';

import * as render from '../bin/render.js';
import { unavailable } from '../bin/index.js';
import { plainly } from './helpers/ansi.js';

// Every assertion below is about text and layout, so the colour comes off here
// rather than by setting chalk.level - see the note in helpers/ansi.js for why
// that switch is not this file's to throw.
const bytes = plainly(render.bytes);
const probeRow = plainly(render.probeRow);
const rate = plainly(render.rate);
const renderDisk = plainly(render.renderDisk);
const renderFetch = plainly(render.renderFetch);
const renderLoad = plainly(render.renderLoad);
const renderMemory = plainly(render.renderMemory);


const CORE = { model: 'Test CPU', idle: 90, total: 100, load: 10, loadRatio: 0.1, loadPercentage: 10 };


test('bytes auto-scales and keeps whole bytes undecorated', () => {
    assert.equal(bytes(0), '0 B');
    assert.equal(bytes(512), '512 B');
    assert.equal(bytes(1024), '1.0 KiB');
    assert.equal(bytes(1536), '1.5 KiB');
    assert.equal(bytes(1024 ** 2), '1.0 MiB');
    assert.equal(bytes(1024 ** 3), '1.0 GiB');
    assert.equal(bytes(1024 ** 4), '1.0 TiB');
});


test('bytes stops at the largest unit rather than running off the table', () => {
    assert.match(bytes(1024 ** 7), /PiB$/);
});


test('bytes keeps the sign of a negative delta', () => {
    assert.equal(bytes(-2048), '-2.0 KiB');
});


test('rate suffixes a per-second marker', () => {
    assert.equal(rate(1024), '1.0 KiB/s');
});


test('probeRow renders the value when the probe succeeded', () => {
    const line = probeRow('Disk', { available: true, size: 10 }, v => `${v.size} bytes`);

    assert.match(line, /^Disk/);
    assert.match(line, /10 bytes/);
});


test('probeRow greys a failed read rather than hiding it', () => {
    // a silently missing row is indistinguishable from a bug
    const line = probeRow('Disk', unavailable('permission-denied', '/mnt/x'), () => 'unused');

    assert.match(line, /unavailable \(permission-denied\)/);
    assert.match(line, /\/mnt\/x/);
});


test('probeRow omits a not-applicable row entirely', () => {
    // "Loadavg unavailable (not-applicable)" on every Windows run is pure noise
    assert.equal(probeRow('Loadavg', unavailable('not-applicable'), () => 'unused'), null);
});


test('probeRow shows every other reason', () => {
    for (const reason of ['unsupported-platform', 'not-found', 'parse-error']) {
        assert.match(probeRow('X', unavailable(reason), () => 'u'), new RegExp(reason));
    }
});


const MEMORY = {
    source: 'meminfo',
    total: 8 * 1024 ** 3,
    free: 1024 ** 3,
    available: 4 * 1024 ** 3,
    buffers: 0,
    cached: 0,
    used: 4 * 1024 ** 3,
    usedRatio: 0.5,
    usedPercentage: 50,
    swapTotal: 0,
    swapFree: 0,
    swapUsed: 0,
};


test('renderMemory shows usage, availability and provenance', () => {
    const out = renderMemory(MEMORY);

    assert.match(out, /Memory/);
    assert.match(out, /50%/);
    assert.match(out, /4\.0 GiB of 8\.0 GiB/);
    assert.match(out, /Available\s+4\.0 GiB/);
    // source changes what the numbers mean, so it is not hidden
    assert.match(out, /Source\s+meminfo/);
});


test('renderMemory omits swap when none is configured and shows it when there is', () => {
    assert.ok(!renderMemory(MEMORY).includes('Swap'));

    const withSwap = renderMemory({ ...MEMORY, swapTotal: 2 * 1024 ** 3, swapUsed: 1024 ** 3 });

    assert.match(withSwap, /Swap\s+1\.0 GiB of 2\.0 GiB \(50%\)/);
});


test('renderMemory flags the os path as counting cache', () => {
    // the same command means something different when it falls back
    assert.match(renderMemory({ ...MEMORY, source: 'os' }), /cache counted as used/);
});


test('renderLoad shows raw and per-core figures', () => {
    const out = renderLoad({
        available: true,
        one: 8, five: 4, fifteen: 2, cores: 16,
        onePerCore: 0.5, fivePerCore: 0.25, fifteenPerCore: 0.125,
    });

    assert.match(out, /Loadavg\s+8\.00 4\.00 2\.00/);
    assert.match(out, /0\.50 0\.25 0\.13/);
    assert.match(out, /over 16 cores/);
});


test('renderLoad says so plainly where load average does not exist', () => {
    assert.match(renderLoad(unavailable('not-applicable')), /not available on this platform/);
});


test('renderDisk shows the mount it reported on', () => {
    const out = renderDisk({
        available: true,
        disk: {
            mount: '/home', size: 100, free: 40, available: 40,
            used: 60, usedRatio: 0.6, usedPercentage: 60,
        },
    });

    assert.match(out, /Mount\s+\/home/);
    assert.match(out, /60%/);
});


test('renderDisk surfaces a failed read instead of printing nothing', () => {
    assert.match(renderDisk(unavailable('not-found', '/nope')), /unavailable \(not-found\)/);
});


test('renderFetch keeps its documented rows and adds the new ones', () => {
    const panel = renderFetch([CORE, CORE]);

    for (const label of ['CPU', 'Cores', 'Arch', 'Platform', 'Uptime', 'Memory', 'Load', 'Per-core']) {
        assert.ok(panel.includes(label), `${label} row missing`);
    }

    assert.match(panel, /Loadavg|Disk/);
    assert.match(panel, /Cores\s+2/);
    assert.match(panel, /CPU\s+Test CPU/);
});


test('renderFetch reports the mount it was asked for', () => {
    const panel = renderFetch([CORE], { mount: '/definitely/not/a/mount' });

    // an unreadable mount is an answer, shown in place, not a crash
    assert.match(panel, /Disk\s+unavailable \(not-found\)/);
});


test('renderFetch memory row agrees with the collector, not with total - free', () => {
    const panel = renderFetch([CORE]);
    const percent = Number(panel.match(/Memory\s+\S+ \/ \S+ GiB \((\d+)%\)/)[1]);

    assert.ok(percent >= 0 && percent <= 100);
});
