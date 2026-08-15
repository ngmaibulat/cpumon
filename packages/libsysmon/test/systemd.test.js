import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getSystemdUnits, parseListUnits, unitType } from '../bin/collectors/systemd.js';


/**
 * Rows in the shape ListUnits actually returns, copied from this machine.
 *
 * The device name is the interesting one: systemd escapes a `-` in a device
 * path as `\x2d`, which leaves the unit name carrying several dots that are not
 * the type separator.
 */
const ROWS = [
    ['sshd.service', 'OpenSSH Daemon', 'loaded', 'active', 'running', '',
        '/org/freedesktop/systemd1/unit/sshd_2eservice', 0, '', '/'],
    ['aidecheck.service', 'Aide Check', 'loaded', 'failed', 'failed', '',
        '/org/freedesktop/systemd1/unit/aidecheck_2eservice', 0, '', '/'],
    ['dev-disk-by\\x2did-nvme\\x2deui.e8238fa6bf530001001b448b4a6f22b2\\x2dpart1.device',
        'WD PC SN740 primary', 'loaded', 'active', 'plugged',
        'sys-devices-pci0000:00.device', '/org/freedesktop/systemd1/unit/dev_2ddisk.device', 0, '', '/'],
    ['docker.socket', 'Docker Socket for the API', 'loaded', 'active', 'listening', '',
        '/org/freedesktop/systemd1/unit/docker_2esocket', 0, '', '/'],
    ['man-db.timer', 'Daily man-db regeneration', 'loaded', 'active', 'waiting', '',
        '/org/freedesktop/systemd1/unit/man_2ddb_2etimer', 0, '', '/'],
    ['restarting.service', 'Something mid-job', 'loaded', 'activating', 'start', '',
        '/org/freedesktop/systemd1/unit/restarting_2eservice', 42, 'start', '/job/42'],
];


test('the ten fields land in the right places', () => {
    const [sshd] = parseListUnits(ROWS);

    assert.deepEqual(sshd, {
        name: 'sshd.service',
        description: 'OpenSSH Daemon',
        loadState: 'loaded',
        activeState: 'active',
        subState: 'running',
        type: 'service',
    });
});


test('the type is the suffix, even when the name is full of dots', () => {
    const units = parseListUnits(ROWS);
    const device = units.find(unit => unit.name.startsWith('dev-disk'));

    assert.equal(device.type, 'device', 'splitting on the first dot would give "e8238fa6bf530001001b448b4a6f22b2\\\\x2dpart1"');

    assert.deepEqual(units.map(unit => unit.type), ['service', 'service', 'device', 'socket', 'timer', 'service']);
});


test('unitType takes the last dot and nothing else', () => {
    assert.equal(unitType('sshd.service'), 'service');
    assert.equal(unitType('a.b.c.mount'), 'mount');
    assert.equal(unitType('dev-disk-by\\x2did-nvme\\x2deui.abc\\x2dpart1.device'), 'device');
    assert.equal(unitType('-.mount'), 'mount');
    assert.equal(unitType('nodots'), '', 'a name with no suffix has no type to claim');
});


test('a queued job is carried, and its absence is absence rather than an empty string', () => {
    const units = parseListUnits(ROWS);

    assert.equal(units.find(unit => unit.name === 'restarting.service').jobType, 'start');
    assert.equal(units.find(unit => unit.name === 'sshd.service').jobType, undefined);
});


test('a failed unit keeps every state it reported', () => {
    const failed = parseListUnits(ROWS).find(unit => unit.activeState === 'failed');

    assert.equal(failed.name, 'aidecheck.service');
    assert.equal(failed.loadState, 'loaded', 'loaded and failed at once is the normal shape of a broken unit');
    assert.equal(failed.subState, 'failed');
});


test('a row of the wrong arity is skipped rather than half-read', () => {
    // systemd has returned ten fields since the interface existed; some other
    // number means this is not the reply it was taken for
    assert.deepEqual(parseListUnits([['too', 'short']]), []);
    assert.deepEqual(parseListUnits(['not a row', null, 7]), []);
    assert.deepEqual(parseListUnits([]), []);

    // a nameless row cannot be shown or keyed on
    assert.deepEqual(parseListUnits([['', 'd', 'l', 'a', 's', '', '/p', 0, '', '/']]), []);
});


test('extra trailing fields are tolerated, in case the interface grows one', () => {
    const rows = [[...ROWS[0], 'something-new']];

    assert.equal(parseListUnits(rows)[0].name, 'sshd.service');
});


test('no bus at all is not-found, because this machine does not run systemd', async () => {
    const probe = await getSystemdUnits({ address: '/nonexistent/system_bus_socket', timeoutMs: 500 });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
    assert.match(probe.detail, /no system bus/);
});


test('a bus socket we may not open is permission-denied, not not-found', { skip: process.getuid?.() === 0 ? 'running as root' : false }, async () => {
    // a real socket that refuses us, which is a different problem from a
    // machine that has no bus at all - and sends the reader somewhere else
    const dir = mkdtempSync(join(tmpdir(), 'etop-bus-'));
    const path = join(dir, 'system_bus_socket');
    const server = createServer(() => {});

    await new Promise(resolve => server.listen(path, resolve));
    chmodSync(path, 0o000);

    try {
        const probe = await getSystemdUnits({ address: path, timeoutMs: 500 });

        assert.equal(probe.available, false);
        assert.equal(probe.reason, 'permission-denied');
    }
    finally {
        await new Promise(resolve => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
    }
});


test('a path that is not a socket is not-found rather than a confusing error', async () => {
    const probe = await getSystemdUnits({ address: '/etc/hostname', timeoutMs: 500 });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
    assert.match(probe.detail, /not a socket/);
});


test('getSystemdUnits resolves an Unavailable and never rejects', async () => {
    // it runs inside a poller; an unhandled rejection there takes the process
    // down with the alternate screen still on the user's terminal
    const results = await Promise.all([
        getSystemdUnits({ address: '/nonexistent/a', timeoutMs: 300 }),
        getSystemdUnits({ address: '/nonexistent/b', timeoutMs: 300 }),
    ]);

    for (const probe of results) {
        assert.equal(probe.available, false);
        assert.equal(typeof probe.reason, 'string');
    }
});


test('the real bus answers with loaded units', {
    skip: process.platform !== 'linux' || !existsSync('/run/dbus/system_bus_socket')
        ? 'no system bus here'
        : false,
}, async () => {
    const probe = await getSystemdUnits({ timeoutMs: 5000 });

    // a machine with dbus but no systemd answers the call with an error, which
    // is a legitimate outcome rather than a test failure
    if (!probe.available) {
        assert.equal(probe.reason, 'parse-error');

        return;
    }

    assert.ok(probe.units.length > 0);

    for (const unit of probe.units) {
        assert.equal(typeof unit.name, 'string');
        assert.ok(unit.name.length > 0);
        assert.equal(unit.type, unitType(unit.name));
        assert.equal(typeof unit.activeState, 'string');
    }

    // every real machine has these, and they exercise the two commonest types
    assert.ok(probe.units.some(unit => unit.type === 'service'), 'no .service units at all?');
    assert.ok(probe.units.some(unit => unit.name === '-.mount'), 'the root mount unit is always loaded');
});
