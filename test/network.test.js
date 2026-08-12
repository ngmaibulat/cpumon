import test from 'node:test';
import assert from 'node:assert/strict';

import { diffNetwork, getNetworkCounters, parseNetDev } from '../bin/collectors/network.js';


const FIXTURE_ROOT = { procRoot: 'test/fixtures/proc' };

const counters = (name, rxBytes, txBytes) => ({
    name,
    rxBytes,
    rxPackets: 0,
    rxErrors: 0,
    rxDropped: 0,
    txBytes,
    txPackets: 0,
    txErrors: 0,
    txDropped: 0,
});


test('parseNetDev skips both header lines', () => {
    const interfaces = parseNetDev([
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets',
        '    lo: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16',
        '',
    ].join('\n'));

    assert.equal(interfaces.length, 1);
    assert.equal(interfaces[0].name, 'lo');
});


test('parseNetDev splits on the colon, not on whitespace', () => {
    // once a counter passes ten digits the kernel stops padding and the row
    // reads "lo:17952586029" with nothing between name and number
    const [lo] = parseNetDev('    lo:17952586029 7007587 0 0 0 0 0 0 17952586029 7007587 0 0 0 0 0 0\n');

    assert.equal(lo.name, 'lo');
    assert.equal(lo.rxBytes, 17952586029);
    assert.equal(lo.txBytes, 17952586029);
});


test('parseNetDev picks the transmit columns from the right offset', () => {
    const [iface] = parseNetDev('  eth0: 100 101 102 103 0 0 0 0 200 201 202 203 0 0 0 0\n');

    assert.equal(iface.rxBytes, 100);
    assert.equal(iface.rxPackets, 101);
    assert.equal(iface.rxErrors, 102);
    assert.equal(iface.rxDropped, 103);
    assert.equal(iface.txBytes, 200);
    assert.equal(iface.txPackets, 201);
    assert.equal(iface.txErrors, 202);
    assert.equal(iface.txDropped, 203);
});


test('parseNetDev accepts names containing digits', () => {
    const names = parseNetDev([
        '  enp1s0: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16',
        '  veth14a11df: 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16',
        '',
    ].join('\n')).map(item => item.name);

    assert.deepEqual(names, ['enp1s0', 'veth14a11df']);
});


test('parseNetDev drops truncated rows rather than inventing zeroes', () => {
    assert.equal(parseNetDev('  eth0: 1 2 3\n').length, 0);
});


test('getNetworkCounters reads the fixture tree end to end', () => {
    const probe = getNetworkCounters(FIXTURE_ROOT);

    assert.equal(probe.available, true);
    assert.deepEqual(probe.interfaces.map(i => i.name), ['lo', 'wlan0', 'enp1s0']);
    assert.equal(probe.interfaces[1].rxErrors, 3);
});


test('getNetworkCounters reports a missing net/dev instead of throwing', () => {
    const probe = getNetworkCounters({ procRoot: 'test/fixtures/nope' });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
});


test('diffNetwork derives per-second rates from the elapsed window', () => {
    const prev = { interfaces: [counters('eth0', 1000, 2000)] };
    const next = { interfaces: [counters('eth0', 3000, 6000)] };

    const [eth0] = diffNetwork(prev, next, 2000).interfaces;

    assert.equal(eth0.rxBytesPerSec, 1000);
    assert.equal(eth0.txBytesPerSec, 2000);
});


test('diffNetwork does not require the two samples to line up', () => {
    // veth and wg interfaces come and go constantly; a length check would make
    // this collector useless on exactly the container hosts it is for
    const prev = { interfaces: [counters('eth0', 0, 0), counters('veth1', 0, 0)] };
    const next = { interfaces: [counters('eth0', 1000, 0), counters('veth2', 500, 0)] };

    const rates = diffNetwork(prev, next, 1000);

    // eth0 has a baseline; veth2 is brand new and waits for the next window
    assert.deepEqual(rates.interfaces.map(i => i.name), ['eth0']);
    assert.equal(rates.interfaces[0].rxBytesPerSec, 1000);
});


test('diffNetwork clamps a counter reset to zero', () => {
    // ip link set down/up resets the counters; a negative delta would render as
    // a negative or absurd rate
    const prev = { interfaces: [counters('eth0', 999999, 999999)] };
    const next = { interfaces: [counters('eth0', 10, 10)] };

    const [eth0] = diffNetwork(prev, next, 1000).interfaces;

    assert.equal(eth0.rxBytesPerSec, 0);
    assert.equal(eth0.txBytesPerSec, 0);
});


test('diffNetwork reports 0 for a zero-length window rather than Infinity', () => {
    const prev = { interfaces: [counters('eth0', 0, 0)] };
    const next = { interfaces: [counters('eth0', 100, 100)] };

    const [eth0] = diffNetwork(prev, next, 0).interfaces;

    assert.equal(eth0.rxBytesPerSec, 0);
    assert.ok(Number.isFinite(eth0.txBytesPerSec));
});


test('the real system read works or says why', { skip: process.platform !== 'linux' }, () => {
    const probe = getNetworkCounters();

    assert.equal(probe.available, true);
    assert.ok(probe.interfaces.length > 0);
});
