import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SOCKET_PROTOCOLS,
    TCP_STATES,
    decodeAddress,
    getConnections,
    parseNetSockets,
} from '../bin/collectors/connections.js';


const FIXTURE_ROOT = { procRoot: 'test/fixtures/proc' };
const V4_ONLY_ROOT = { procRoot: 'test/fixtures/proc-v4only' };
const MISSING_ROOT = { procRoot: 'test/fixtures/no-such-tree' };

const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';

const row = (fields) =>
    `   0: ${fields} 00000000:00000000 00:00000000 00000000  1000        0 999 1 0000000000000000 20 4 30 10 -1`;


test('an address is little-endian per word and the port beside it is not', () => {
    const [socket] = parseNetSockets([HEADER, row('0100007F:0050 0F02000A:01BB 01')].join('\n'), 'tcp');

    // 0100007F reversed byte by byte is 127.0.0.1 - the naive reading, 1.0.0.127,
    // is a valid-looking address pointing somewhere else
    assert.equal(socket.localAddress, '127.0.0.1');
    assert.equal(socket.remoteAddress, '10.0.2.15');

    // same field, opposite convention
    assert.equal(socket.localPort, 80);
    assert.equal(socket.remotePort, 443);
});


test('a v6 address is byte-swapped per 32-bit word, not across the whole string', () => {
    // 2001:db8:85a3::8a2e:370:7334 - deliberately not palindromic in any word,
    // so reversing the whole string produces a different, wrong address
    assert.equal(decodeAddress('B80D01200000A3852E8A000034737003'), '2001:db8:85a3::8a2e:370:7334');

    // and the whole-string reversal really would differ, which is what makes
    // the assertion above worth anything
    const reversed = decodeAddress([...'B80D01200000A3852E8A000034737003'].reverse().join(''));
    assert.notEqual(reversed, '2001:db8:85a3::8a2e:370:7334');
});


test('the longest zero run compresses, and a lone zero group does not', () => {
    assert.equal(decodeAddress('00000000000000000000000001000000'), '::1');
    assert.equal(decodeAddress('00000000000000000000000000000000'), '::');

    // groups 0, 2 and the run at 4-6 are all zero; only the longest run
    // collapses. A single group written as :: saves no width and would let two
    // different addresses render identically.
    assert.equal(decodeAddress('01000000020000000000000003000000'), '0:1:0:2::3');
});


test('an address that is neither 8 nor 32 hex digits is not guessed at', () => {
    assert.equal(decodeAddress('0100'), null);
    assert.equal(decodeAddress(''), null);
    assert.equal(decodeAddress('ZZZZZZZZ'), null);
});


test('every state code in the table decodes, and an unknown one does not throw', () => {
    for (const [code, name] of Object.entries(TCP_STATES)) {
        const [socket] = parseNetSockets([HEADER, row(`0100007F:0050 00000000:0000 ${code}`)].join('\n'), 'tcp');
        assert.equal(socket.state, name, `state ${code}`);
    }

    const [unknown] = parseNetSockets([HEADER, row('0100007F:0050 00000000:0000 FF')].join('\n'), 'tcp');
    assert.equal(unknown.state, 'UNKNOWN');
});


test('a header-only or truncated file yields no rows rather than an error', () => {
    assert.deepEqual(parseNetSockets(HEADER, 'tcp'), []);
    assert.deepEqual(parseNetSockets('', 'tcp'), []);
    assert.deepEqual(parseNetSockets([HEADER, '   0: 0100007F:00'].join('\n'), 'tcp'), []);
});


test('the fixture tree reads all four protocols', () => {
    const probe = getConnections(FIXTURE_ROOT);

    assert.equal(probe.available, true);

    const found = new Set(probe.connections.map(item => item.protocol));
    assert.deepEqual([...found].sort(), [...SOCKET_PROTOCOLS].sort());

    const listener = probe.connections.find(item => item.state === 'LISTEN' && item.protocol === 'tcp');
    assert.equal(listener.localAddress, '127.0.0.1');
    assert.equal(listener.localPort, 80);
    assert.equal(listener.inode, 21562);
    assert.equal(listener.uid, 0);

    // udp reuses the state column with the kernel's own overload: 07 is CLOSE
    const udp = probe.connections.find(item => item.protocol === 'udp');
    assert.equal(udp.state, 'CLOSE');
    assert.equal(udp.localPort, 53);
});


test('three of four files missing is a partial answer, not a failure', () => {
    const probe = getConnections(V4_ONLY_ROOT);

    assert.equal(probe.available, true);
    assert.equal(probe.connections.length, 1);
    assert.deepEqual([...new Set(probe.connections.map(item => item.protocol))], ['tcp']);
});


test('all four missing is not-found', () => {
    const probe = getConnections(MISSING_ROOT);

    assert.equal(probe.available, false);
    assert.equal(probe.reason, 'not-found');
});


test('owners are absent until they are asked for', () => {
    const probe = getConnections(FIXTURE_ROOT);

    assert.equal(probe.available, true);
    assert.ok(probe.connections.every(item => item.owner === undefined));
});
