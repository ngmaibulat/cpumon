import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getMemoryInfo,
    osMemoryInfo,
    parseMeminfo,
    readMeminfo,
    toMemoryInfo,
    withCgroupLimit,
} from '../bin/collectors/memory.js';
import { fixture } from './helpers/fixtures.js';


const KIB = 1024;
const MIB = 1024 * 1024;

const FIXTURE_ROOT = { procRoot: fixture('proc') };


test('parseMeminfo converts kB values to bytes', () => {
    const fields = parseMeminfo('MemTotal:        8388608 kB\nMemFree:         1048576 kB\n');

    assert.equal(fields.get('MemTotal'), 8388608 * KIB);
    assert.equal(fields.get('MemFree'), 1048576 * KIB);
});


test('parseMeminfo leaves unitless counters alone', () => {
    // the HugePages_* counters are plain counts, not kB - converting them would
    // silently multiply them by 1024
    const fields = parseMeminfo('HugePages_Total:       3\nHugepagesize:       2048 kB\n');

    assert.equal(fields.get('HugePages_Total'), 3);
    assert.equal(fields.get('Hugepagesize'), 2048 * KIB);
});


test('used is total minus available, matching free -h', () => {
    // NOT total - free: that counts the page cache as used and reads high
    const info = toMemoryInfo(parseMeminfo([
        'MemTotal:        8388608 kB',
        'MemFree:         1048576 kB',
        'MemAvailable:    4194304 kB',
        '',
    ].join('\n')), 'meminfo');

    assert.equal(info.total, 8 * 1024 * MIB);
    assert.equal(info.available, 4 * 1024 * MIB);
    assert.equal(info.used, 4 * 1024 * MIB);
    assert.equal(info.usedRatio, 0.5);
    assert.equal(info.usedPercentage, 50);
});


test('MemAvailable falls back to free + buffers + cached on old kernels', () => {
    // MemAvailable arrived in Linux 3.14
    const info = toMemoryInfo(parseMeminfo([
        'MemTotal:        8388608 kB',
        'MemFree:         1048576 kB',
        'Buffers:          131072 kB',
        'Cached:          2097152 kB',
        '',
    ].join('\n')), 'meminfo');

    assert.equal(info.available, (1048576 + 131072 + 2097152) * KIB);
    assert.equal(info.used, info.total - info.available);
});


test('swap used is total minus free', () => {
    const info = toMemoryInfo(parseMeminfo([
        'MemTotal:        8388608 kB',
        'SwapTotal:       2097152 kB',
        'SwapFree:        1572864 kB',
        '',
    ].join('\n')), 'meminfo');

    assert.equal(info.swapTotal, 2 * 1024 * MIB);
    assert.equal(info.swapUsed, 512 * MIB);
});


test('an empty total reports 0 rather than dividing into NaN', () => {
    const info = toMemoryInfo(new Map(), 'os');

    assert.equal(info.usedRatio, 0);
    assert.equal(info.usedPercentage, 0);
    assert.ok(!Number.isNaN(info.used));
});


test('readMeminfo reads the fixture tree end to end', () => {
    // the procRoot seam is what makes the reader - not just the parser -
    // testable on a runner that has no /proc
    const probe = readMeminfo(FIXTURE_ROOT);

    assert.equal(probe.available, true);
    assert.equal(probe.memory.source, 'meminfo');
    assert.equal(probe.memory.total, 8 * 1024 * MIB);
    assert.equal(probe.memory.used, 4 * 1024 * MIB);
    assert.equal(probe.memory.usedPercentage, 50);
    assert.equal(probe.memory.swapUsed, 512 * MIB);
});


test('the payload is wrapped so MemAvailable cannot eat the discriminant', () => {
    // MemoryInfo.available is the kernel's MemAvailable; flattening it into the
    // probe would overwrite `available: true` with a byte count
    const probe = readMeminfo(FIXTURE_ROOT);

    assert.equal(probe.available, true);
    assert.equal(probe.memory.available, 4 * 1024 * MIB);
});


test('readMeminfo reports a missing meminfo instead of throwing', () => {
    const probe = readMeminfo({ procRoot: fixture('does-not-exist') });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
});


test('readMeminfo rejects a file with no MemTotal', () => {
    const probe = readMeminfo({ procRoot: fixture('') });

    assert.equal(probe.available, false);
});


test('getMemoryInfo never fails and never leaks the discriminant', () => {
    // it is not a Probe: os.totalmem()/os.freemem() work everywhere, so there is
    // no failure branch for a caller to handle
    const info = getMemoryInfo({ procRoot: fixture('does-not-exist') });

    assert.equal(info.source, 'os');
    assert.ok(info.total > 0);
    assert.equal(typeof info.available, 'number');

    const fromFixture = getMemoryInfo(FIXTURE_ROOT);

    assert.equal(fromFixture.source, 'meminfo');
    // `available` must be the byte count, not a leftover `true` from the probe
    assert.equal(fromFixture.available, 4 * 1024 * MIB);
    assert.equal(JSON.parse(JSON.stringify(fromFixture)).available, 4 * 1024 * MIB);
});


test('a cgroup ceiling below the machine total rewrites the budget', () => {
    const machine = toMemoryInfo(parseMeminfo('MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n'), 'meminfo');

    const scoped = withCgroupLimit(machine, {
        cpuQuotaUsec: null, cpuPeriodUsec: 100000, cpuLimitCores: null,
        memoryCurrent: 64 * MIB, memoryTotal: 64 * MIB, memoryMax: 512 * MIB,
    });

    assert.equal(scoped.source, 'cgroup');
    assert.equal(scoped.total, 512 * MIB);
    assert.equal(scoped.used, 64 * MIB);
    assert.equal(scoped.available, 448 * MIB);
    assert.equal(scoped.usedPercentage, 12);
});


test('an unlimited or larger cgroup leaves the machine reading alone', () => {
    const machine = toMemoryInfo(parseMeminfo('MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n'), 'meminfo');
    const base = { cpuQuotaUsec: null, cpuPeriodUsec: 100000, cpuLimitCores: null, memoryCurrent: 0, memoryTotal: 0 };

    assert.equal(withCgroupLimit(machine, null).source, 'meminfo');
    assert.equal(withCgroupLimit(machine, { ...base, memoryMax: null }).source, 'meminfo');

    // lxcfs already scopes /proc/meminfo inside a container; without the strict
    // comparison an equal ceiling would correct an already-correct reading
    assert.equal(withCgroupLimit(machine, { ...base, memoryMax: machine.total }).source, 'meminfo');
    assert.equal(withCgroupLimit(machine, { ...base, memoryMax: machine.total * 2 }).source, 'meminfo');
});


test('osMemoryInfo reports plausible figures on every platform', () => {
    const info = osMemoryInfo();

    assert.equal(info.source, 'os');
    assert.ok(info.total > 0);
    assert.ok(info.used >= 0 && info.used <= info.total);
    assert.ok(info.usedPercentage >= 0 && info.usedPercentage <= 100);
});


test('the real system read agrees with itself', { skip: process.platform !== 'linux' }, () => {
    const info = getMemoryInfo();

    assert.equal(info.source, 'meminfo');
    assert.equal(info.used, info.total - info.available);
    assert.ok(info.total > 0);
});
