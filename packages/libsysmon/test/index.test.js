import test from 'node:test';
import assert from 'node:assert/strict';


// This file exists for one reason: esbuild transpiles each source file alone,
// so it cannot tell a re-exported type from a re-exported value. A barrel
// written as `export { CpuInfo } from './CpuMonitor.js'` builds clean - esbuild
// reports success - and then throws at the first import a user attempts.
// Nothing but actually importing the built barrel catches that.
test('the built barrel imports without throwing', async () => {
    const mod = await import('../bin/index.js');

    assert.ok(mod, 'importing bin/index.js must not throw');
});


test('the barrel re-exports every documented value', async () => {
    const mod = await import('../bin/index.js');

    // this list has to stay exhaustive: it is the runtime guard against the
    // hazard described above, and it only catches a missing `export type` for
    // names it actually knows about
    const expected = [
        // cpu
        'CpuMonitor',
        'getCpuInfo',
        'getCpuDiff',
        'toCpuInfo',
        'withLoadRatio',
        'aggregateCpu',
        // probes
        'unavailable',
        'isAvailable',
        // system
        'SystemMonitor',
        'sampleSystem',
        // memory
        'getMemoryInfo',
        'osMemoryInfo',
        'parseMeminfo',
        'readMeminfo',
        'toMemoryInfo',
        'withCgroupLimit',
        // load average
        'getLoadAverage',
        'toLoadAverage',
        // disk
        'defaultMount',
        'getDiskUsage',
        'toDiskInfo',
        // network
        'diffNetwork',
        'getNetworkCounters',
        'parseNetDev',
        // processes
        'attachRss',
        'diffProcesses',
        'getProcessCounters',
        'parsePidStat',
        'parsePidStatus',
        'parseStatTotal',
        'selectProcesses',
        'sortNeedsRss',
        'sortProcesses',
        'topProcesses',
        // formatting
        'bytes',
        'duration',
        'formatUptime',
        'gib',
        'percent',
        'rate',
        'shortId',
        // cgroups
        'detectCgroupVersion',
        'parseCgroupCpuStat',
        'parseCpuMax',
        'parseMemoryMax',
        'parseSelfCgroup',
        'readCgroupCpu',
        'readCgroupLimits',
        'readSelfCgroup',
        'readSelfLimits',
        // containers
        'detectContainer',
        'diffContainerCpu',
        'getContainerInfo',
        'listContainers',
    ];

    for (const name of expected) {
        assert.equal(typeof mod[name], 'function', `${name} should be exported`);
    }
});


test('the barrel stays free of the colour library', async () => {
    const mod = await import('../bin/index.js');

    // renderers are deliberately excluded so a consumer who only wants the
    // numbers does not pay for chalk
    for (const name of Object.keys(mod)) {
        assert.ok(!name.startsWith('render'), `${name} should not be in the barrel`);
    }
});


test('the barrel exposes the same formatters as the ./format subpath', async () => {
    const barrel = await import('../bin/index.js');
    const direct = await import('../bin/format.js');

    assert.equal(barrel.bytes, direct.bytes);
    assert.equal(barrel.rate, direct.rate);
});


test('the format module pulls in nothing at all', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../bin/format.js', import.meta.url), 'utf8');

    // the whole reason format.ts exists is that etop can import it
    // without dragging chalk or a collector along. an import statement here
    // would quietly undo that.
    assert.ok(!/^\s*import\s/m.test(source), 'bin/format.js must have no imports');
});


test('the barrel exposes the same SystemMonitor as the ./system subpath', async () => {
    const barrel = await import('../bin/index.js');
    const direct = await import('../bin/SystemMonitor.js');

    assert.equal(barrel.SystemMonitor, direct.SystemMonitor);
});


test('the barrel exposes the same CpuMonitor as the ./cpu subpath', async () => {
    const barrel = await import('../bin/index.js');
    const direct = await import('../bin/CpuMonitor.js');

    // per-file emit, so both specifiers resolve to one module instance -
    // an instanceof check across the two entry points must hold
    assert.equal(barrel.CpuMonitor, direct.CpuMonitor);
});
