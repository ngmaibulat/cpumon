import test from 'node:test';
import assert from 'node:assert/strict';

import {
    detectCgroupVersion,
    parseCgroupCpuStat,
    parseCpuMax,
    parseMemoryMax,
    parseSelfCgroup,
    readCgroupCpu,
    readCgroupLimits,
} from '../bin/collectors/cgroup.js';
import { diffContainerCpu, listContainers } from '../bin/collectors/container.js';


const V2_SCOPE = 'test/fixtures/cgroup2/system.slice/'
    + 'docker-abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890.scope';

const MIB = 1024 * 1024;


test('parseSelfCgroup reads the v2 single line', () => {
    const parsed = parseSelfCgroup('0::/user.slice/user-1000.slice/app.slice/thing.scope\n');

    assert.equal(parsed.version, 2);
    assert.equal(parsed.path, '/user.slice/user-1000.slice/app.slice/thing.scope');
});


test('parseSelfCgroup picks the cpu controller out of a v1 block', () => {
    // v1 writes one line per controller and they can be mounted at different
    // paths, so the cpu one is the one that matters here
    const parsed = parseSelfCgroup([
        '11:blkio:/docker/abc',
        '5:cpu,cpuacct:/docker/deadbeef',
        '2:memory:/docker/somewhere-else',
        '',
    ].join('\n'));

    assert.equal(parsed.version, 1);
    assert.equal(parsed.path, '/docker/deadbeef');
});


test('parseSelfCgroup prefers v2 when both shapes are present', () => {
    const parsed = parseSelfCgroup('5:cpu,cpuacct:/legacy\n0::/unified\n');

    assert.equal(parsed.version, 2);
    assert.equal(parsed.path, '/unified');
});


test('parseSelfCgroup returns null for a file it cannot use', () => {
    assert.equal(parseSelfCgroup(''), null);
    assert.equal(parseSelfCgroup('7:blkio:/only-blkio\n'), null);
});


test('parseCpuMax reads a quota and spells unlimited as null', () => {
    assert.deepEqual(parseCpuMax('200000 100000\n'), { quotaUsec: 200000, periodUsec: 100000 });
    assert.deepEqual(parseCpuMax('max 100000\n'), { quotaUsec: null, periodUsec: 100000 });
});


test('parseMemoryMax handles both spellings of unlimited', () => {
    assert.equal(parseMemoryMax('max\n'), null);
    // v1's PAGE_COUNTER_MAX - not an 8 exabyte container
    assert.equal(parseMemoryMax('9223372036854771712\n'), null);
    assert.equal(parseMemoryMax('536870912\n'), 536870912);
});


test('parseCgroupCpuStat reads the microsecond counters', () => {
    const stat = parseCgroupCpuStat('usage_usec 5000000\nuser_usec 3000000\nnr_throttled 2\n');

    assert.equal(stat.usageUsec, 5000000);
    assert.equal(stat.userUsec, 3000000);
    assert.equal(stat.nrThrottled, 2);
    // absent keys are 0, not NaN
    assert.equal(stat.throttledUsec, 0);
});


test('detectCgroupVersion keys off the unified controllers file', () => {
    assert.equal(detectCgroupVersion({ sysfsRoot: 'test/fixtures/cgroup2' }), 2);
    assert.equal(detectCgroupVersion({ sysfsRoot: 'test/fixtures/cgroup1' }), 1);
});


test('v2 limits come back normalised', () => {
    const limits = readCgroupLimits(V2_SCOPE, 2);

    assert.equal(limits.available, true);
    assert.equal(limits.cpuQuotaUsec, 200000);
    assert.equal(limits.cpuLimitCores, 2);
    assert.equal(limits.memoryMax, 1024 * MIB);
    // working set: memory.current less the reclaimable cache, as docker reports
    assert.equal(limits.memoryTotal, 512 * MIB);
    assert.equal(limits.memoryCurrent, 512 * MIB - 128 * MIB);
});


test('v1 limits come back in the same shape and units', () => {
    const limits = readCgroupLimits('test/fixtures/cgroup1', 1);

    assert.equal(limits.available, true);
    // -1 is v1's "no quota"
    assert.equal(limits.cpuQuotaUsec, null);
    assert.equal(limits.cpuLimitCores, null);
    assert.equal(limits.memoryMax, null);
    assert.equal(limits.memoryTotal, 104857600);
    assert.equal(limits.memoryCurrent, 104857600 - 4857600);
});


test('v1 cpu usage is converted from nanoseconds to microseconds', () => {
    const cpu = readCgroupCpu('test/fixtures/cgroup1', 1);

    assert.equal(cpu.available, true);
    // 7000000000 ns is 7000000 us
    assert.equal(cpu.usageUsec, 7000000);
});


test('v2 cpu usage is read straight from cpu.stat', () => {
    const cpu = readCgroupCpu(V2_SCOPE, 2);

    assert.equal(cpu.available, true);
    assert.equal(cpu.usageUsec, 5000000);
    assert.equal(cpu.nrThrottled, 2);
});


test('a missing cgroup directory is reported, not thrown', () => {
    assert.equal(readCgroupCpu('test/fixtures/nope', 2).available, false);
});


test('diffContainerCpu puts one fully-used core at 100 percent', () => {
    // one second of CPU time over a one second window
    const stat = usec => ({ usageUsec: usec, userUsec: 0, systemUsec: 0, nrPeriods: 0, nrThrottled: 0, throttledUsec: 0 });

    assert.equal(diffContainerCpu(stat(0), stat(1000000), 1000).cpuPercentage, 100);
    assert.equal(diffContainerCpu(stat(0), stat(2000000), 1000).cpuPercentage, 200);
    // a counter that went backwards, and a zero-length window
    assert.equal(diffContainerCpu(stat(500), stat(0), 1000).cpuPercentage, 0);
    assert.equal(diffContainerCpu(stat(0), stat(1000), 0).cpuPercentage, 0);
});


test('listContainers finds container cgroups under a fixture root', { skip: process.platform !== 'linux' }, () => {
    const probe = listContainers({ sysfsRoot: 'test/fixtures/cgroup2' });

    assert.equal(probe.available, true);
    assert.equal(probe.containers.length, 1);
    assert.equal(probe.containers[0].runtime, 'docker');
    assert.equal(probe.containers[0].limits.cpuLimitCores, 2);
});


test('listContainers says containers are not a concept off Linux', { skip: process.platform === 'linux' }, () => {
    const probe = listContainers();

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'unsupported-platform');
});
