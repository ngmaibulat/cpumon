import test from 'node:test';
import assert from 'node:assert/strict';

import { ConnectionPanel, Ring, compareConnections, connectionRow, ownerCell } from '../dist/internal.js';

import { assertFits, draw, h, lines, plain } from './helpers/render.js';
import { fakeStore, snapshot } from './fixtures/snapshots.js';


const connection = (over = {}) => ({
    protocol: 'tcp',
    localAddress: '127.0.0.1',
    localPort: 8080,
    remoteAddress: '0.0.0.0',
    remotePort: 0,
    state: 'LISTEN',
    uid: 1000,
    inode: 4242,
    txQueue: 0,
    rxQueue: 0,
    owner: { kind: 'none' },
    ...over,
});


const withConnections = (connections) => snapshot({
    connections: { available: true, connections },
});


/**
 * The panel resolves owners from the real /proc unless told otherwise, so every
 * render here replaces that with the identity and lets the fixture say who owns
 * what. Otherwise these assertions would be about the runner's socket table.
 */
const render = (props, options = {}) => draw(
    h(ConnectionPanel, { width: 80, height: 12, resolve: (list) => list, ...props }),
    { columns: 80, ...options },
);


test('the three owner states are three different cells', () => {
    const held = ownerCell(connection({ owner: { kind: 'process', pid: 42, comm: 'nginx' } }));
    const none = ownerCell(connection({ owner: { kind: 'none' } }));
    const denied = ownerCell(connection({ owner: { kind: 'denied' } }));

    assert.equal(held, 'nginx');
    assert.equal(none, '-');
    assert.equal(denied, '?');

    // the point of the whole three-state type: "nobody holds this" and "you may
    // not see who holds this" must not render the same
    assert.notEqual(none, denied);
    assert.equal(new Set([held, none, denied]).size, 3);
});


test('an unresolved owner reads as withheld, not as ownerless', () => {
    // absent is exactly as much knowledge as denied. Claiming '-' would say
    // nobody holds the socket, which nothing has established.
    assert.equal(ownerCell(connection({ owner: undefined })), '?');
});


test('the three owner states reach the screen distinguishably', () => {
    const output = plain(render({
        store: undefined,
    }, {
        store: fakeStore(Ring, {
            snapshot: withConnections([
                connection({ localPort: 80, owner: { kind: 'process', pid: 42, comm: 'nginx' } }),
                connection({ localPort: 443, inode: 4243, owner: { kind: 'none' } }),
                connection({ localPort: 8443, inode: 4244, owner: { kind: 'denied' } }),
            ]),
        }),
    }));

    assert.match(output, /nginx/);

    const rows = lines(output).filter(line => /LISTEN/.test(line));

    assert.equal(rows.length, 3);
    assert.ok(/\bnginx\b/.test(rows[0]), rows[0]);
    assert.ok(/-\s*$/.test(rows[1].trimEnd() + ' ') || / - /.test(rows[1] + ' '), rows[1]);
    assert.ok(rows[2].includes('?'), rows[2]);
});


test('the footnote appears only when a row is withheld', () => {
    const store = (owner) => fakeStore(Ring, {
        snapshot: withConnections([connection({ owner })]),
    });

    const withheld = plain(render({}, { store: store({ kind: 'denied' }) }));
    const ownerless = plain(render({}, { store: store({ kind: 'none' }) }));
    const held = plain(render({}, { store: store({ kind: 'process', pid: 1, comm: 'init' }) }));

    assert.match(withheld, /run as root/);
    assert.doesNotMatch(ownerless, /run as root/, 'nothing was withheld, so there is nothing to explain');
    assert.doesNotMatch(held, /run as root/);
});


test('an unconnected peer is a dash rather than a port zero', () => {
    // 0.0.0.0:0 written out invites being read as a peer that happens to sit on
    // port zero, which is not what the kernel is saying
    const [, , remote] = connectionRow(connection());
    assert.equal(remote, '-');

    const [, , real] = connectionRow(connection({ remoteAddress: '10.0.2.15', remotePort: 443 }));
    assert.equal(real, '10.0.2.15:443');

    const [, , v6] = connectionRow(connection({ remoteAddress: '::', remotePort: 0 }));
    assert.equal(v6, '-');
});


test('listeners sort to the top, then by local port', () => {
    const rows = [
        connection({ state: 'TIME_WAIT', localPort: 100, inode: 3 }),
        connection({ state: 'LISTEN', localPort: 443, inode: 2 }),
        connection({ state: 'ESTABLISHED', localPort: 22, inode: 4 }),
        connection({ state: 'LISTEN', localPort: 80, inode: 1 }),
    ].sort(compareConnections);

    assert.deepEqual(
        rows.map(item => `${item.state}:${item.localPort}`),
        ['LISTEN:80', 'LISTEN:443', 'ESTABLISHED:22', 'TIME_WAIT:100'],
    );
});


test('rows in the same state and port keep a stable order between ticks', () => {
    // without the inode tiebreak a host full of identical TIME_WAIT rows
    // reshuffles every tick for no reason the user can see
    const rows = [
        connection({ state: 'TIME_WAIT', localPort: 80, inode: 9 }),
        connection({ state: 'TIME_WAIT', localPort: 80, inode: 3 }),
        connection({ state: 'TIME_WAIT', localPort: 80, inode: 7 }),
    ];

    assert.deepEqual([...rows].sort(compareConnections).map(item => item.inode), [3, 7, 9]);
    assert.deepEqual([...rows].reverse().sort(compareConnections).map(item => item.inode), [3, 7, 9]);
});


test('the panel fits every width it is given, and stays ascii', () => {
    const store = fakeStore(Ring, {
        snapshot: withConnections([
            connection({ owner: { kind: 'process', pid: 42, comm: 'nginx' } }),
            connection({
                protocol: 'tcp6',
                localAddress: '2001:db8:85a3::8a2e:370:7334',
                localPort: 443,
                remoteAddress: '2001:db8::1',
                remotePort: 51000,
                state: 'ESTABLISHED',
                inode: 4243,
                owner: { kind: 'denied' },
            }),
        ]),
    });

    for (const width of [40, 52, 61, 80, 120]) {
        for (const unicode of [true, false]) {
            const output = draw(
                h(ConnectionPanel, { width, height: 12, resolve: (list) => list }),
                { columns: width, store, unicode },
            );

            const where = `width ${width}, unicode ${unicode}: `;

            assertFits(assert, output, width, where);
            assert.equal(lines(output).length, 12, `${where}a panel must be exactly the height it was given`);

            if (!unicode) {
                // eslint-disable-next-line no-control-regex
                assert.ok(!/[^\x00-\x7f]/.test(plain(output)), `${where}ascii mode drew a non-ascii character`);
            }
        }
    }
});


test('an unavailable probe is explained rather than drawn empty', () => {
    const store = fakeStore(Ring, {
        snapshot: snapshot({ connections: { available: false, reason: 'permission-denied', detail: '/proc/net/tcp' } }),
    });

    const output = plain(render({}, { store }));

    assert.match(output, /not readable/i);
    assert.match(output, /proc\/net\/tcp/, 'the detail names the file, which is what makes it actionable');
});


test('the window the panel reports is the number of rows it actually drew', () => {
    // the join between the reducer and the screen. One too many and `G` puts
    // the cursor on a row below the last visible one and the list looks stuck.
    const many = Array.from({ length: 40 }, (_, i) => connection({
        localPort: 1000 + i,
        inode: 5000 + i,
        owner: { kind: 'process', pid: i, comm: `proc${i}` },
    }));

    const store = fakeStore(Ring, { snapshot: withConnections(many) });

    for (const height of [8, 10, 12, 15, 20]) {
        const reports = [];

        const output = plain(draw(
            h(ConnectionPanel, {
                width: 80,
                height,
                scroll: 0,
                selected: 0,
                resolve: (list) => list,
                onRows: (rowCount, windowRows) => reports.push([rowCount, windowRows]),
            }),
            { columns: 80, store },
        ));

        const drawn = lines(output).filter(line => /LISTEN/.test(line)).length;

        assert.equal(reports.at(-1)?.[0], 40, `height ${height}: row count`);
        assert.equal(reports.at(-1)?.[1], drawn, `height ${height}: reported window vs rows drawn`);
    }
});


test('the reported window shrinks by one when the footnote takes a row', () => {
    const rows = Array.from({ length: 30 }, (_, i) => connection({ localPort: 1000 + i, inode: 6000 + i }));

    const measure = (owner) => {
        const reports = [];

        draw(
            h(ConnectionPanel, {
                width: 80,
                height: 14,
                resolve: (list) => list,
                onRows: (rowCount, windowRows) => reports.push([rowCount, windowRows]),
            }),
            {
                columns: 80,
                store: fakeStore(Ring, {
                    snapshot: withConnections(rows.map(item => ({ ...item, owner }))),
                }),
            },
        );

        return reports.at(-1)?.[1];
    };

    assert.equal(measure({ kind: 'denied' }), measure({ kind: 'none' }) - 1);
});
