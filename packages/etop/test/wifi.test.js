import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BEST_DBM,
    WORST_DBM,
    WifiPanel,
    detailLine,
    signalRatio,
    wifiRow,
} from '../dist/internal.js';

import { assertFits, draw, fakeSlow, h, lines, plain } from './helpers/render.js';


const GLYPHS = { check: '*', separator: '|' };


const network = (ssid, signalDbm, over = {}) => ({
    ssid,
    security: 'psk',
    connected: false,
    known: false,
    ...(signalDbm === undefined ? {} : { signalDbm }),
    ...over,
});


const CONNECTION = {
    ssid: 'HOMENET_5G',
    bssid: '00:11:22:33:44:55',
    frequencyMhz: 5560,
    channel: 112,
    security: 'WPA2-Personal',
    signalDbm: -55,
    averageSignalDbm: -54,
    rxMode: '802.11ax',
    txMode: '802.11ax',
    rxBitrateMbps: 1020.6,
    txBitrateMbps: 720.6,
    connectedSeconds: 10754,
};


const DEVICE = {
    name: 'wlan0',
    address: 'aa:bb:cc:dd:ee:ff',
    powered: true,
    mode: 'station',
    adapterModel: 'MT7921',
    state: 'connected',
    scanning: false,
};


const iwd = (over = {}) => fakeSlow({
    wifi: {
        available: true,
        source: 'iwd',
        devices: [DEVICE],
        connection: CONNECTION,
        networks: [
            network('HOMENET_5G', -56, { connected: true, known: true }),
            network('HOMENET', -58, { known: true }),
            network('NEIGHBOUR_2G', -72),
            network('GUEST_OPEN', -81, { security: 'open' }),
            network('CORP_NET', undefined, { security: '8021x' }),
        ],
        ...over,
    },
});


const render = (props = {}, options = {}) => draw(
    h(WifiPanel, { width: 90, height: 14, ...props }),
    { columns: 90, slow: iwd(), ...options },
);


test('the signal gauge is absolute, not relative to the best network in view', () => {
    // a relative scale would draw the best of three terrible signals as a full
    // bar, which is the opposite of what a signal meter is for
    assert.equal(signalRatio(BEST_DBM), 1);
    assert.equal(signalRatio(WORST_DBM), 0);
    assert.equal(signalRatio(-60), 0.5);

    // clamped at both ends: better than -30 is not more than full
    assert.equal(signalRatio(-10), 1);
    assert.equal(signalRatio(-120), 0);
});


test('a lone weak network does not draw a full bar', () => {
    const output = plain(draw(
        h(WifiPanel, { width: 60, height: 8 }),
        {
            columns: 60,
            slow: fakeSlow({
                wifi: {
                    available: true,
                    source: 'iwd',
                    devices: [{ ...DEVICE, state: 'disconnected' }],
                    networks: [network('WEAK', -85)],
                },
            }),
        },
    ));

    // the only network is at -85, which is nearly unusable; if the gauge
    // normalised against the list it would be drawn at full strength
    assert.match(output, /WEAK/);
    assert.doesNotMatch(output, /█{20}/, 'a -85 dBm network must not fill the bar');
});


test('a connected network is marked, a saved one is named, a stranger is neither', () => {
    const [, , , connectedNote] = wifiRow(network('A', -50, { connected: true, known: true }), GLYPHS);
    const [, , , knownNote] = wifiRow(network('B', -50, { known: true }), GLYPHS);
    const [, , , strangerNote] = wifiRow(network('C', -50), GLYPHS);

    assert.equal(connectedNote, '* connected');
    assert.equal(knownNote, 'known');
    assert.equal(strangerNote, '');
});


test('a network the scan missed shows a dash, not a zero', () => {
    // 0 dBm would render as the strongest signal possible
    const [, , seen] = wifiRow(network('A', -56), GLYPHS);
    const [, , unseen] = wifiRow(network('B', undefined), GLYPHS);

    assert.equal(seen, '-56 dBm');
    assert.equal(unseen, '-');
});


test('the detail line drops fields from the right as it narrows', () => {
    const wide = detailLine(CONNECTION, 200, '|');

    assert.match(wide, /^ch 112/);
    assert.match(wide, /5560 MHz/);
    assert.match(wide, /802\.11ax/);
    assert.match(wide, /rx 1020\.6 \/ tx 720\.6 Mbit\/s/);
    assert.match(wide, /up /);

    const narrow = detailLine(CONNECTION, 24, '|');

    assert.ok(narrow.length <= 24, `"${narrow}" is ${narrow.length} cells`);
    assert.match(narrow, /^ch 112/, 'the leftmost fields are the ones worth keeping');
    assert.doesNotMatch(narrow, /Mbit/);

    // never a half-written field: it is built to fit rather than truncated
    for (const width of [0, 1, 5, 10, 20, 40, 80]) {
        const line = detailLine(CONNECTION, width, '|');

        assert.ok(line.length <= width || line === '', `width ${width}: "${line}"`);
        assert.doesNotMatch(line, /\|\s*$/, `width ${width}: trailing separator`);
    }
});


test('the screen shows the connection and the scan', () => {
    const output = plain(render());

    assert.match(output, /wlan0/);
    assert.match(output, /HOMENET_5G/);
    assert.match(output, /-55 dBm/, 'the gauge shows the connection RSSI');
    assert.match(output, /ch 112/);
    assert.match(output, /NEIGHBOUR_2G/);
    assert.match(output, /8021x/);
});


test('the header does not name the source when it is iwd', () => {
    const output = plain(render());

    assert.doesNotMatch(output, /\biwd\b/, 'naming the normal case is noise');
});


test('a degraded screen says so, and says what is missing', () => {
    // /proc/net/wireless has a level and nothing else - no ssid, no security,
    // no scan. A screen that silently degrades is a screen that lies.
    const output = plain(draw(
        h(WifiPanel, { width: 90, height: 12 }),
        {
            columns: 90,
            slow: fakeSlow({
                wifi: {
                    available: true,
                    source: 'proc',
                    devices: [{ name: 'wlan0', address: '', powered: true, mode: '', state: 'unknown', scanning: false, signalDbm: -55, linkQuality: 55 }],
                    networks: [],
                },
            }),
        },
    ));

    assert.match(output, /proc/, 'the source is named when it is not iwd');
    assert.match(output, /iwd is not reachable/);
    assert.match(output, /-55 dBm/, 'the one thing it does know is still shown');
});


test('a machine with no radio at all is explained rather than drawn empty', () => {
    const output = plain(draw(
        h(WifiPanel, { width: 90, height: 12 }),
        {
            columns: 90,
            slow: fakeSlow({ wifi: { available: false, reason: 'not-applicable', detail: 'no wireless interface on this machine' } }),
        },
    ));

    assert.match(output, /not applicable|no wireless/i);
});


test('a station that is scanning says so instead of showing a stale connection', () => {
    const output = plain(draw(
        h(WifiPanel, { width: 90, height: 12 }),
        {
            columns: 90,
            slow: fakeSlow({
                wifi: {
                    available: true,
                    source: 'iwd',
                    devices: [{ ...DEVICE, state: 'disconnected', scanning: true }],
                    networks: [network('A', -60)],
                },
            }),
        },
    ));

    assert.match(output, /scanning/);
});


test('the panel fits every width it is given, and stays ascii', () => {
    for (const width of [40, 52, 61, 80, 120]) {
        for (const unicode of [true, false]) {
            const output = draw(
                h(WifiPanel, { width, height: 14 }),
                { columns: width, slow: iwd(), unicode },
            );

            const where = `width ${width}, unicode ${unicode}: `;

            assertFits(assert, output, width, where);
            assert.equal(lines(output).length, 14, `${where}a panel must be exactly the height it was given`);

            if (!unicode) {
                // the tick beside "connected" needs an ascii fallback, and so
                // does the gauge's bar
                // eslint-disable-next-line no-control-regex
                assert.ok(!/[^\x00-\x7f]/.test(plain(output)), `${where}ascii mode drew a non-ascii character`);
            }
        }
    }
});
