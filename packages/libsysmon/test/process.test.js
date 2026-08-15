import test from 'node:test';
import assert from 'node:assert/strict';

import {
    attachRss,
    diffProcesses,
    getProcessCounters,
    parsePidStat,
    parsePidStatus,
    parseStatTotal,
    selectProcesses,
    sortNeedsRss,
    sortProcesses,
    topProcesses,
} from '../bin/collectors/process.js';
import { fixture } from './helpers/fixtures.js';


const FIXTURE_ROOT = { procRoot: fixture('proc') };

const SIMPLE = '999 (bash) S 1 1 1 0 -1 4194304 100 0 0 0 500 250 0 0 20 0 4 0 12345 6193152 478 0';

const snapshot = (processes, totalJiffies, cores = 2) => ({ processes, totalJiffies, cores });
const proc = (pid, jiffies) => ({
    pid, comm: 'x', state: 'S', ppid: 1,
    utime: jiffies, stime: 0, jiffies, threads: 1,
});


test('parsePidStat reads the fields at their real offsets', () => {
    const counters = parsePidStat(SIMPLE);

    assert.equal(counters.pid, 999);
    assert.equal(counters.comm, 'bash');
    assert.equal(counters.state, 'S');
    assert.equal(counters.ppid, 1);
    assert.equal(counters.utime, 500);
    assert.equal(counters.stime, 250);
    assert.equal(counters.jiffies, 750);
    assert.equal(counters.threads, 4);
});


test('parsePidStat survives a comm containing spaces and a close-paren', () => {
    // splitting the line on whitespace is the classic bug: it shifts every
    // later field, silently corrupting utime and stime rather than failing
    const counters = parsePidStat('123 ((my) app) S 1 1 1 0 -1 4194304 100 0 0 0 500 250 0 0 20 0 4 0 1 2 3 0');

    assert.equal(counters.pid, 123);
    assert.equal(counters.comm, '(my) app');
    // the proof that nothing shifted
    assert.equal(counters.utime, 500);
    assert.equal(counters.stime, 250);
    assert.equal(counters.threads, 4);
});


test('parsePidStat handles a comm that is only parentheses', () => {
    const counters = parsePidStat('7 (())) S 1 1 1 0 -1 0 0 0 0 0 11 22 0 0 20 0 2 0 1 2 3 0');

    assert.equal(counters.comm, '())');
    assert.equal(counters.utime, 11);
    assert.equal(counters.stime, 22);
});


test('parsePidStat rejects a line it cannot make sense of', () => {
    assert.equal(parsePidStat('garbage with no parens'), null);
    assert.equal(parsePidStat(''), null);
});


test('parsePidStatus converts VmRSS from kB to bytes', () => {
    const status = parsePidStatus('Name:\tbash\nVmRSS:\t   65536 kB\nThreads:\t4\n');

    assert.equal(status.name, 'bash');
    assert.equal(status.rss, 65536 * 1024);
});


test('parsePidStatus reports 0 for a kernel thread with no VmRSS', () => {
    assert.equal(parsePidStatus('Name:\tkthreadd\nState:\tS\n').rss, 0);
});


test('parseStatTotal sums every column of the aggregate cpu line', () => {
    assert.equal(parseStatTotal('cpu  1000 100 500 8000 100 0 50 0 0 0\ncpu0 1 2 3\n'), 9750);
});


test('parseStatTotal ignores the per-core lines and rejects a file without the aggregate', () => {
    assert.equal(parseStatTotal('cpu0 500 50 250 4000\nintr 1\n'), null);
});


test('getProcessCounters reads the fixture tree end to end', () => {
    const probe = getProcessCounters(FIXTURE_ROOT);

    assert.equal(probe.available, true);
    assert.equal(probe.totalJiffies, 9750);
    assert.equal(probe.cores, 2);

    const pids = probe.processes.map(p => p.pid).sort((a, b) => a - b);

    assert.deepEqual(pids, [123, 456]);
    // the tricky name survived the round trip through the reader
    assert.equal(probe.processes.find(p => p.pid === 123).comm, '(my) app');
});


test('getProcessCounters reports a missing proc tree instead of throwing', () => {
    const probe = getProcessCounters({ procRoot: fixture('nope') });

    assert.equal(probe.available, false);
});


test('diffProcesses scales one fully-used core to 100 percent', () => {
    // 2 cores, 200 total jiffies elapsed across both, so one core's worth is
    // 100 jiffies - a process that burned exactly that is at 100%
    const before = snapshot([proc(1, 0)], 1000);
    const after = snapshot([proc(1, 100)], 1200);

    const [load] = diffProcesses(before, after);

    assert.equal(load.cpuPercentage, 100);
    assert.equal(load.cpuRatio, 1);
});


test('diffProcesses lets a multithreaded process exceed 100 percent', () => {
    // exactly as top reports it - a four-thread build job is legitimately 400%
    const [load] = diffProcesses(snapshot([proc(1, 0)], 1000), snapshot([proc(1, 400)], 1200));

    assert.equal(load.cpuPercentage, 400);
});


test('diffProcesses skips a process that has no baseline', () => {
    const before = snapshot([proc(1, 0)], 1000);
    const after = snapshot([proc(1, 50), proc(2, 999)], 1200);

    const pids = diffProcesses(before, after).map(load => load.pid);

    assert.deepEqual(pids, [1]);
});


test('diffProcesses clamps a counter that went backwards', () => {
    const [load] = diffProcesses(snapshot([proc(1, 500)], 1000), snapshot([proc(1, 10)], 1200));

    assert.equal(load.cpuPercentage, 0);
});


test('diffProcesses reports 0 for a zero-jiffy window rather than NaN', () => {
    const [load] = diffProcesses(snapshot([proc(1, 0)], 1000), snapshot([proc(1, 10)], 1000));

    assert.equal(load.cpuRatio, 0);
    assert.ok(Number.isFinite(load.cpuPercentage));
});


test('diffProcesses returns busiest first', () => {
    const before = snapshot([proc(1, 0), proc(2, 0), proc(3, 0)], 1000);
    const after = snapshot([proc(1, 10), proc(2, 90), proc(3, 50)], 1200);

    assert.deepEqual(diffProcesses(before, after).map(l => l.pid), [2, 3, 1]);
});


test('topProcesses cuts to the requested count', () => {
    const loads = [1, 2, 3, 4, 5].map(pid => ({ pid }));

    assert.equal(topProcesses(loads, 3).length, 3);
    assert.equal(topProcesses(loads, 99).length, 5);
    assert.equal(topProcesses(loads, 0).length, 0);
});


const load = (pid, over) => ({
    pid, comm: 'x', state: 'S', ppid: 1,
    utime: 0, stime: 0, jiffies: 0, threads: 1,
    cpuRatio: 0, cpuPercentage: 0,
    ...over,
});


test('sortProcesses orders the numeric keys biggest first', () => {
    const loads = [
        load(1, { cpuRatio: 0.1, rss: 300, threads: 2 }),
        load(2, { cpuRatio: 0.9, rss: 100, threads: 8 }),
        load(3, { cpuRatio: 0.5, rss: 200, threads: 4 }),
    ];

    assert.deepEqual(sortProcesses(loads, 'cpu').map(p => p.pid), [2, 3, 1]);
    assert.deepEqual(sortProcesses(loads, 'mem').map(p => p.pid), [1, 3, 2]);
    assert.deepEqual(sortProcesses(loads, 'threads').map(p => p.pid), [2, 3, 1]);
});


test('sortProcesses orders name and pid the way people read them', () => {
    const loads = [load(30, { comm: 'zsh' }), load(10, { comm: 'apt' }), load(20, { comm: 'make' })];

    // nobody asking to sort by name wants to start at z
    assert.deepEqual(sortProcesses(loads, 'name').map(p => p.comm), ['apt', 'make', 'zsh']);
    assert.deepEqual(sortProcesses(loads, 'pid').map(p => p.pid), [10, 20, 30]);
});


test('sortProcesses reverses whichever direction the key defaults to', () => {
    const loads = [load(1, { cpuRatio: 0.1 }), load(2, { cpuRatio: 0.9 })];

    assert.deepEqual(sortProcesses(loads, 'cpu', true).map(p => p.pid), [1, 2]);
    assert.deepEqual(sortProcesses(loads, 'pid', true).map(p => p.pid), [2, 1]);
});


test('sortProcesses breaks ties on pid so rows do not reshuffle every tick', () => {
    const loads = [load(9, { comm: 'worker' }), load(3, { comm: 'worker' }), load(6, { comm: 'worker' })];

    assert.deepEqual(sortProcesses(loads, 'name').map(p => p.pid), [3, 6, 9]);
    // and the tiebreaker stays ascending even when the key is reversed, so a
    // reversal is not also a shuffle of the equal rows
    assert.deepEqual(sortProcesses(loads, 'name', true).map(p => p.pid), [3, 6, 9]);
});


test('sortProcesses does not mutate its input', () => {
    const loads = [load(1, { cpuRatio: 0.1 }), load(2, { cpuRatio: 0.9 })];

    sortProcesses(loads, 'cpu');

    assert.deepEqual(loads.map(p => p.pid), [1, 2]);
});


test('sortProcesses treats a missing rss as zero rather than throwing', () => {
    // rss is undefined until attachRss runs; a memory sort over un-attached
    // rows must degrade quietly, because that is exactly the mistake
    // sortNeedsRss exists to stop the caller making
    const loads = [load(1), load(2, { rss: 100 })];

    assert.deepEqual(sortProcesses(loads, 'mem').map(p => p.pid), [2, 1]);
});


test('sortNeedsRss singles out the one key that must pay for a full pass', () => {
    assert.equal(sortNeedsRss('mem'), true);

    for (const key of ['cpu', 'pid', 'name', 'threads']) {
        assert.equal(sortNeedsRss(key), false, `${key} should sort before the cut`);
    }
});


test('attachRss fills in resident memory for the rows that survived the cut', () => {
    const loads = attachRss([{ pid: 123 }, { pid: 456 }], FIXTURE_ROOT);

    assert.equal(loads[0].rss, 65536 * 1024);
    assert.equal(loads[1].rss, 2048 * 1024);
});


test('attachRss leaves rss unset for a process that has exited', () => {
    // the pid vanished between the scan and this read; that is normal
    const [load] = attachRss([{ pid: 999999999 }], FIXTURE_ROOT);

    assert.equal(load.rss, undefined);
});


// the two fixture pids carry very different resident sizes, which is what makes
// a memory-ordered cut distinguishable from a cpu-ordered one
const RSS_123 = 65536 * 1024;
const RSS_456 = 2048 * 1024;


test('selectProcesses cuts on cpu by default and attaches rss afterwards', () => {
    const loads = [load(456, { cpuRatio: 0.9 }), load(123, { cpuRatio: 0.1 })];

    const rows = selectProcesses(loads, { ...FIXTURE_ROOT, top: 1 });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].pid, 456);
    assert.equal(rows[0].rss, RSS_456);
});


test('selectProcesses reads rss for every process before a memory cut', () => {
    // the row that survives must be the largest by rss, not the busiest. if the
    // cut ran first, every rss would still be undefined, every comparison would
    // tie, and the busiest process would come back labelled as the largest.
    const loads = [load(456, { cpuRatio: 0.9 }), load(123, { cpuRatio: 0.1 })];

    const rows = selectProcesses(loads, { ...FIXTURE_ROOT, top: 1, sort: 'mem' });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].pid, 123);
    assert.equal(rows[0].rss, RSS_123);
});


test('selectProcesses keeps the other end of the range when reversed', () => {
    const loads = [load(123, { cpuRatio: 0.1 }), load(456, { cpuRatio: 0.9 })];

    const rows = selectProcesses(loads, { ...FIXTURE_ROOT, top: 1, sort: 'mem', sortReverse: true });

    assert.equal(rows[0].pid, 456);
    assert.equal(rows[0].rss, RSS_456);
});


test('selectProcesses defaults to ten rows', () => {
    const loads = Array.from({ length: 25 }, (_, i) => load(i + 1, { cpuRatio: i / 25 }));

    assert.equal(selectProcesses(loads, FIXTURE_ROOT).length, 10);
});


test('the real system scan finds this very process', { skip: process.platform !== 'linux' }, () => {
    const probe = getProcessCounters();

    assert.equal(probe.available, true);

    const self = probe.processes.find(p => p.pid === process.pid);

    assert.ok(self, 'the running test process should appear in its own scan');
    assert.ok(self.threads >= 1);
});
