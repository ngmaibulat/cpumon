/**
 * The wifi collector.
 *
 * The fixture is structurally identical to a real GetManagedObjects reply from
 * this machine - same interfaces, same property names, same object-path shape,
 * including the SSID-as-hex path segments. The SSIDs and MAC addresses are
 * synthesised: a committed scan of whoever happens to live next door is
 * location-identifying data and has no place in a published repository.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    bitrateMbps,
    centiDbm,
    getWifi,
    parseManagedObjects,
    parseProcWireless,
} from '../bin/collectors/wifi.js';


const FIXTURE = JSON.parse(readFileSync('test/fixtures/iwd-objects.json', 'utf8'));

const state = () => parseManagedObjects(FIXTURE.objects, FIXTURE.ordered, FIXTURE.diagnostics);

const bySsid = (ssid) => state().networks.find(network => network.ssid === ssid);


/** the three-line sample from a real /proc/net/wireless */
const PROC_WIRELESS = [
    'Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE',
    ' face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22',
    ' wlan0: 0000   55.  -55.  -256        0      0      0      0      0        0',
    '',
].join('\n');


test('a scan signal is hundredths of a dBm and is divided by a hundred', () => {
    // this is the bug most likely to ship: -5600 rendered as dBm is a plausible
    // looking number that is two orders of magnitude wrong
    assert.equal(centiDbm(-5600), -56);
    assert.equal(centiDbm(-5100), -51);
    assert.equal(centiDbm(0), 0);
    assert.equal(centiDbm(undefined), undefined);

    assert.equal(bySsid('HOMENET_5G').signalDbm, -56);
    assert.equal(bySsid('GUEST_OPEN').signalDbm, -63);
});


test('diagnostics RSSI is already dBm and passes through unscaled', () => {
    // deliberately asserted next to the conversion above. Both come from iwd,
    // for the same network, at the same moment, in different units - so a future
    // edit cannot quietly make the two agree in the wrong direction.
    const { connection } = state();

    assert.equal(FIXTURE.diagnostics.RSSI, -55, 'the fixture really does carry plain dBm here');
    assert.equal(connection.signalDbm, -55, 'unscaled');

    assert.equal(FIXTURE.ordered[0][1], -5600, 'and hundredths there');
    assert.equal(bySsid('HOMENET_5G').signalDbm, -56, 'scaled');

    assert.notEqual(connection.signalDbm, centiDbm(FIXTURE.diagnostics.RSSI));
});


test('a bitrate is in units of 100 kbit/s', () => {
    assert.equal(bitrateMbps(7206), 720.6);
    assert.equal(bitrateMbps(10206), 1020.6);
    assert.equal(bitrateMbps(undefined), undefined);

    const { connection } = state();

    assert.equal(connection.txBitrateMbps, 720.6);
    assert.equal(connection.rxBitrateMbps, 1020.6);
});


test('the connection carries what diagnostics knows and the SSID the tree knows', () => {
    const { connection } = state();

    // GetDiagnostics has no SSID in it at all - only a BSSID - so the name has
    // to come from whichever Network object says Connected
    assert.equal(connection.ssid, 'HOMENET_5G');
    assert.equal(connection.bssid, '00:11:22:33:44:55');
    assert.equal(connection.frequencyMhz, 5560);
    assert.equal(connection.channel, 112);
    assert.equal(connection.security, 'WPA2-Personal');
    assert.equal(connection.averageSignalDbm, -54);
    assert.equal(connection.connectedSeconds, 10754);
});


test('the device joins its adapter for a model name', () => {
    const { devices } = state();

    assert.equal(devices.length, 1);
    assert.deepEqual(devices[0], {
        name: 'wlan0',
        address: 'aa:bb:cc:dd:ee:ff',
        powered: true,
        mode: 'station',
        adapterModel: 'MT7921 802.11ax PCIe Wireless Network Adapter [Filogic 330]',
        state: 'connected',
        scanning: false,
    });
});


test('known is set only where a KnownNetwork object actually exists', () => {
    // the property can outlive the object for a moment after a Forget, and a
    // network shown as saved that is not saved is a lie the user acts on
    assert.equal(bySsid('HOMENET_5G').known, true);
    assert.equal(bySsid('HOMENET').known, true);
    assert.equal(bySsid('NEIGHBOUR_2G').known, false);
    assert.equal(bySsid('GUEST_OPEN').known, false);

    const stale = parseManagedObjects({
        '/dev/net': {
            'net.connman.iwd.Network': { Name: 'GHOST', Type: 'psk', KnownNetwork: '/gone' },
        },
    });

    assert.equal(stale.networks[0].known, false, 'a path pointing at nothing is not "known"');
});


test('a network in the tree but not in the scan has no signal rather than a zero', () => {
    // CORP_NET is in the object list and absent from GetOrderedNetworks
    const corp = bySsid('CORP_NET');

    assert.equal(corp.security, '8021x');
    assert.equal(corp.signalDbm, undefined, 'zero would render as a very strong signal');
    assert.ok(!('signalDbm' in corp), 'absent, not undefined-valued, so JSON drops it');
});


test('a scan entry with no matching network object is ignored', () => {
    // iwd can return a path mid-scan for a network that has just gone
    const names = state().networks.map(network => network.ssid);

    assert.ok(!names.includes('VANISHED'));
    assert.equal(names.length, 5);
});


test('networks sort strongest first, with the unseen ones last', () => {
    const { networks } = state();

    assert.deepEqual(networks.map(n => n.ssid), [
        'HOMENET_5G', 'HOMENET', 'NEIGHBOUR_2G', 'GUEST_OPEN', 'CORP_NET',
    ]);

    assert.equal(networks.at(-1).signalDbm, undefined, 'the one the scan missed sinks to the bottom');
});


test('an empty or unusable reply yields an empty state rather than throwing', () => {
    assert.deepEqual(parseManagedObjects({}), { source: 'iwd', devices: [], networks: [] });
    assert.deepEqual(parseManagedObjects(null), { source: 'iwd', devices: [], networks: [] });
    assert.deepEqual(parseManagedObjects([]), { source: 'iwd', devices: [], networks: [] });
});


test('no diagnostics means no connection, not a connection full of zeroes', () => {
    // GetDiagnostics fails outright when nothing is connected
    const scanning = parseManagedObjects(FIXTURE.objects, FIXTURE.ordered, undefined);

    assert.equal(scanning.connection, undefined);
    assert.equal(scanning.networks.length, 5, 'the rest of the tree still arrived');
});


test('/proc/net/wireless gives an interface and its level, and nothing it does not know', () => {
    const parsed = parseProcWireless(PROC_WIRELESS);

    assert.equal(parsed.source, 'proc');
    assert.equal(parsed.devices.length, 1);
    assert.equal(parsed.devices[0].name, 'wlan0');
    assert.equal(parsed.devices[0].signalDbm, -55, 'the trailing dot is format, not a decimal point');
    assert.equal(parsed.devices[0].linkQuality, 55);

    // it has no SSID, no security and no scan; claiming otherwise is the whole
    // reason this is a degraded mode rather than a second source
    assert.deepEqual(parsed.networks, []);
    assert.equal(parsed.connection, undefined);
});


test('a header-only /proc/net/wireless lists no interfaces', () => {
    const headerOnly = PROC_WIRELESS.split('\n').slice(0, 2).join('\n');

    assert.deepEqual(parseProcWireless(headerOnly).devices, []);
    assert.deepEqual(parseProcWireless('').devices, []);
});


test('two interfaces both come back', () => {
    const two = [
        ...PROC_WIRELESS.split('\n').slice(0, 3),
        ' wlan1: 0000   40.  -70.  -256        0      0      0      0      0        0',
    ].join('\n');

    assert.deepEqual(parseProcWireless(two).devices.map(d => [d.name, d.signalDbm]), [
        ['wlan0', -55], ['wlan1', -70],
    ]);
});


test('no iwd falls back to the file, and says which source answered', async () => {
    const probe = await getWifi({
        address: '/nonexistent/bus_socket',
        procRoot: 'test/fixtures/proc-wireless',
        timeoutMs: 300,
    });

    assert.equal(probe.available, true);
    assert.equal(probe.source, 'proc', 'a screen that silently degrades is a screen that lies');
    assert.equal(probe.devices[0].name, 'wlan0');
});


test('a machine with no wifi card is not-applicable rather than a failure', async () => {
    const probe = await getWifi({
        address: '/nonexistent/bus_socket',
        procRoot: 'test/fixtures/proc-nowireless',
        timeoutMs: 300,
    });

    assert.equal(probe.available, false);
    // useLayout.isAbsent treats this reason as "this screen should not exist
    // here", which is the right answer for a desktop with no radio
    assert.equal(probe.reason, 'not-applicable');
});


test('no iwd and no file at all is not-found', async () => {
    const probe = await getWifi({
        address: '/nonexistent/bus_socket',
        procRoot: 'test/fixtures/no-such-tree',
        timeoutMs: 300,
    });

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
    assert.match(probe.detail, /iwd is not reachable/);
});


test('getWifi resolves an Unavailable and never rejects', async () => {
    const results = await Promise.all([
        getWifi({ address: '/nonexistent/a', procRoot: 'test/fixtures/no-such-tree', timeoutMs: 200 }),
        getWifi({ address: '/nonexistent/b', procRoot: 'test/fixtures/no-such-tree', timeoutMs: 200 }),
    ]);

    for (const probe of results) {
        assert.equal(probe.available, false);
    }
});
