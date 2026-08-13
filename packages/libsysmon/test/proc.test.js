import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CLOCK_TICKS,
    clockTicks,
    errnoToUnavailable,
    firstNumber,
    parseKeyValue,
    procRoot,
    readText,
    sysfsRoot,
    toNumber,
} from '../bin/collectors/proc.js';


function errno(code) {
    const err = new Error(code);
    err.code = code;
    return err;
}


test('errnoToUnavailable maps a missing file to not-found', () => {
    const probe = errnoToUnavailable(errno('ENOENT'), '/proc/meminfo');

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
    assert.equal(probe.detail, '/proc/meminfo');
});


test('errnoToUnavailable maps a denied read to permission-denied', () => {
    for (const code of ['EACCES', 'EPERM']) {
        assert.equal(errnoToUnavailable(errno(code), '/x').reason, 'permission-denied');
    }
});


test('errnoToUnavailable treats an unimplemented syscall as unsupported-platform', () => {
    // the kernel not implementing the interface is the same situation as being
    // on the wrong platform, not a missing file
    for (const code of ['ENOSYS', 'EOPNOTSUPP']) {
        assert.equal(errnoToUnavailable(errno(code), '/x').reason, 'unsupported-platform');
    }
});


test('errnoToUnavailable falls back to parse-error and keeps the code', () => {
    const probe = errnoToUnavailable(errno('EIO'), '/proc/stat');

    assert.equal(probe.reason, 'parse-error');
    assert.match(probe.detail, /EIO/);
});


test('readText reports a missing file instead of throwing', () => {
    const result = readText('/proc/definitely-not-a-real-file');

    assert.equal(result.ok, false);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'not-found');
});


test('parseKeyValue splits on the first separator only', () => {
    // a value containing the separator must survive intact
    const fields = parseKeyValue('Name:\tsome:thing\nState:\tR (running)\n');

    assert.equal(fields.get('Name'), 'some:thing');
    assert.equal(fields.get('State'), 'R (running)');
});


test('parseKeyValue accepts a space separator for cgroup stat files', () => {
    const fields = parseKeyValue('usage_usec 190649488982\nnr_throttled 0\n', ' ');

    assert.equal(fields.get('usage_usec'), '190649488982');
    assert.equal(fields.get('nr_throttled'), '0');
});


test('parseKeyValue skips blank and separator-less lines', () => {
    const fields = parseKeyValue('\ngarbage\nMemTotal: 1 kB\n');

    assert.equal(fields.size, 1);
    assert.equal(fields.get('MemTotal'), '1 kB');
});


test('toNumber rejects empty and non-finite input rather than coercing', () => {
    // Number('') is 0 - a pseudo-file that has gone empty must not read as a
    // legitimate zero
    assert.equal(toNumber(''), null);
    assert.equal(toNumber('   '), null);
    assert.equal(toNumber(undefined), null);
    assert.equal(toNumber('max'), null);
    assert.equal(toNumber('12'), 12);
    assert.equal(toNumber(' 12 '), 12);
});


test('firstNumber drops the unit or trailing field', () => {
    assert.equal(firstNumber('17952 kB'), 17952);
    assert.equal(firstNumber('200000 100000'), 200000);
    assert.equal(firstNumber('max 100000'), null);
    assert.equal(firstNumber(undefined), null);
});


test('roots default to the real filesystem and are overridable', () => {
    assert.equal(procRoot(), '/proc');
    assert.equal(sysfsRoot(), '/sys/fs/cgroup');
    assert.equal(clockTicks(), CLOCK_TICKS);

    assert.equal(procRoot({ procRoot: 'test/fixtures/proc' }), 'test/fixtures/proc');
    assert.equal(sysfsRoot({ sysfsRoot: 'test/fixtures/cgroup' }), 'test/fixtures/cgroup');
    assert.equal(clockTicks({ clockTicks: 250 }), 250);
});
