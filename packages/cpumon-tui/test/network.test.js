import test from 'node:test';
import assert from 'node:assert/strict';

import { NetworkPanel, Ring, orderInterfaces } from '../dist/internal.js';

import { assertFits, draw, h, lines, plain } from './helpers/render.js';
import { fakeStore, snapshot } from './fixtures/snapshots.js';


const nic = (name, rx, tx, over = {}) => ({
    name,
    rxBytesPerSec: rx,
    txBytesPerSec: tx,
    rxBytes: rx * 1000,
    txBytes: tx * 1000,
    rxPackets: 0, txPackets: 0,
    rxErrors: 0, txErrors: 0,
    rxDropped: 0, txDropped: 0,
    ...over,
});


const withNet = (interfaces, over = {}) => snapshot({
    network: { available: true, elapsedMs: 1000, interfaces },
    ...over,
});


const render = (props, options = {}) => draw(
    h(NetworkPanel, { width: 50, height: 10, index: 0, bits: false, ...props }),
    { columns: 50, ...options },
);


test('interfaces are ordered busiest first', () => {
    const ordered = orderInterfaces([nic('eth0', 10, 10), nic('eth1', 100, 100), nic('eth2', 50, 50)]);

    assert.deepEqual(ordered.map(i => i.name), ['eth1', 'eth2', 'eth0']);
});


test('loopback goes last however loud it is', () => {
    // lo is almost always the busiest interface on a machine and almost never
    // the interesting one, so sorting it to the top would make the default
    // selection nearly always wrong
    const ordered = orderInterfaces([nic('lo', 1e9, 1e9), nic('eth0', 1, 1)]);

    assert.deepEqual(ordered.map(i => i.name), ['eth0', 'lo']);
});


test('ordering does not mutate the list it was given', () => {
    const interfaces = [nic('a', 1, 1), nic('b', 2, 2)];

    orderInterfaces(interfaces);

    assert.deepEqual(interfaces.map(i => i.name), ['a', 'b']);
});


test('the panel names the interface it is showing', () => {
    const store = fakeStore(Ring, { snapshot: withNet([nic('eth0', 1000, 500), nic('lo', 5, 5)]) });
    const output = plain(render({}, { store }));

    assert.match(output, /NET/);
    assert.match(output, /eth0/);
    // and how many others there are to cycle through
    assert.match(output, /1\/2/);
});


test('the index selects among the ordered interfaces and wraps', () => {
    const store = fakeStore(Ring, { snapshot: withNet([nic('eth0', 1000, 1), nic('wlan0', 10, 1)]) });

    assert.match(plain(render({ index: 0 }, { store })), /eth0/);
    assert.match(plain(render({ index: 1 }, { store })), /wlan0/);
    // wrapping rather than clamping, so cycling past the end comes back round
    assert.match(plain(render({ index: 2 }, { store })), /eth0/);
});


test('the panel shows throughput both ways', () => {
    const store = fakeStore(Ring, { snapshot: withNet([nic('eth0', 4 * 1024 * 1024, 512 * 1024)]) });
    const output = plain(render({}, { store }));

    assert.match(output, /↓/);
    assert.match(output, /↑/);
    assert.match(output, /4\.0 MiB\/s/);
    assert.match(output, /512\.0 KiB\/s/);
});


test('bits mode restates the same rate eight times larger', () => {
    const store = fakeStore(Ring, { snapshot: withNet([nic('eth0', 1024, 1024)]) });

    const bytes = plain(render({ bits: false }, { store }));
    const bits = plain(render({ bits: true }, { store }));

    assert.match(bytes, /1\.0 KiB\/s/);
    assert.match(bits, /8\.0 Kib\/s/);
});


test('a cramped panel keeps the numbers and drops the graph', () => {
    // a one-row graph split between receive and transmit shows one glyph of
    // each and says nothing; "↓ 4.2 MiB/s" in the same row says the thing
    // someone opened the panel to find out
    const store = fakeStore(Ring, {
        snapshot: withNet([nic('eth0', 4 * 1024 * 1024, 1024)]),
        history: [1000, 2000],
    });

    const output = plain(render({ height: 5 }, { store }));

    assert.match(output, /4\.0 MiB\/s/);
});


test('the panel fits every size it might be given', () => {
    const store = fakeStore(Ring, {
        snapshot: withNet([nic('eth0', 1e6, 1e5), nic('lo', 1, 1)]),
        history: [1e5, 1e6, 5e5],
    });

    for (const width of [20, 30, 50, 80, 120]) {
        for (const height of [3, 4, 6, 10, 20]) {
            const output = draw(
                h(NetworkPanel, { width, height, index: 0, bits: false }),
                { columns: width, store },
            );

            assertFits(assert, output, width, `${width}x${height}: `);
            assert.equal(lines(output).length, height, `${width}x${height} height`);
        }
    }
});


test('an unsupported platform explains itself rather than drawing zeros', () => {
    const store = fakeStore(Ring, {
        snapshot: snapshot({ network: { available: false, reason: 'unsupported-platform' } }),
    });

    const output = plain(render({}, { store }));

    assert.match(output, /unavailable/);
    assert.doesNotMatch(output, /█/);
});


test('an empty interface list on the first tick is loading, not emptiness', () => {
    // the first sample has no baseline to diff, so the collector correctly
    // reports nothing - and a machine with no network is a different claim
    const loading = fakeStore(Ring, { snapshot: withNet([]), ticks: 1 });

    assert.match(plain(render({}, { store: loading })), /waiting/);

    const settled = fakeStore(Ring, { snapshot: withNet([]), ticks: 9 });

    assert.match(plain(render({}, { store: settled })), /no interfaces/);
});


test('the panel graphs the interface it names, not the machine total', () => {
    // graphing the sum under a label naming one NIC is a plain misstatement,
    // and the store keeps a series per interface so it does not have to
    const store = fakeStore(Ring, { snapshot: withNet([nic('eth0', 1000, 500)]) });

    assert.equal(typeof store.seriesFor, 'function');
});
