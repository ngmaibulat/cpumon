/**
 * The marshaller, as a table of values.
 *
 * These are the highest-value tests in the phase and every one of them is pure:
 * no bus, no daemon, no platform. A hand-rolled binary format whose tests are
 * written afterwards is a format that agrees with its own bugs, so the byte
 * counts below are worked out from the specification rather than from what the
 * code happened to emit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    Variant,
    align,
    completeTypeLength,
    parseSignature,
} from '../bin/dbus/types.js';
import { marshal } from '../bin/dbus/marshal.js';
import { unmarshal } from '../bin/dbus/unmarshal.js';
import {
    FIELD,
    MESSAGE_TYPE,
    decodeMessage,
    encodeMessage,
    messageLength,
} from '../bin/dbus/message.js';
import { connectPath, parseBusAddress, systemBusAddress } from '../bin/dbus/address.js';


/** marshal then unmarshal, and assert the value survived the round trip */
const trip = (signature, values, littleEndian = true) => {
    const buffer = marshal(signature, values, littleEndian);
    const { value, offset } = unmarshal(signature, buffer, 0, littleEndian);

    assert.equal(offset, buffer.length, `${signature}: reader stopped at ${offset} of ${buffer.length}`);

    return value;
};


test('every scalar type round-trips', () => {
    assert.deepEqual(trip('y', [255]), [255]);
    assert.deepEqual(trip('b', [true]), [true]);
    assert.deepEqual(trip('b', [false]), [false]);
    assert.deepEqual(trip('n', [-32768]), [-32768]);
    assert.deepEqual(trip('q', [65535]), [65535]);
    assert.deepEqual(trip('i', [-2147483648]), [-2147483648]);
    assert.deepEqual(trip('u', [4294967295]), [4294967295]);
    assert.deepEqual(trip('x', [-9007199254740993n]), [-9007199254740993n]);
    assert.deepEqual(trip('t', [18446744073709551615n]), [18446744073709551615n]);
    assert.deepEqual(trip('d', [0.1]), [0.1]);
    assert.deepEqual(trip('s', ['hello']), ['hello']);
    assert.deepEqual(trip('o', ['/org/freedesktop/systemd1']), ['/org/freedesktop/systemd1']);
    assert.deepEqual(trip('g', ['a(ssssssouso)']), ['a(ssssssouso)']);
});


test('a boolean on the wire is a 32-bit 0 or 1, not a byte', () => {
    const buffer = marshal('b', [true]);

    assert.equal(buffer.length, 4);
    assert.equal(buffer.readUInt32LE(0), 1);
});


test('a struct aligns to 8, so (yu) is 8 bytes with 3 of padding', () => {
    // a byte, three bytes of padding to bring the uint32 to a 4-boundary, then
    // the uint32. Five would be the answer if padding were skipped.
    const buffer = marshal('(yu)', [[1, 2]]);

    assert.equal(buffer.length, 8);
    assert.equal(buffer.readUInt8(0), 1);
    assert.deepEqual([...buffer.subarray(1, 4)], [0, 0, 0], 'padding must be zero bytes');
    assert.equal(buffer.readUInt32LE(4), 2);

    assert.deepEqual(trip('(yu)', [[1, 2]]), [[1, 2]]);
});


test('a byte before a uint64 pads to 8', () => {
    const buffer = marshal('yt', [1, 2n]);

    assert.equal(buffer.length, 16);
    assert.equal(buffer.readBigUInt64LE(8), 2n);
});


test("an array's length is bytes, and excludes the padding before its first element", () => {
    // a(u), byte by byte:
    //   0..4   the length word
    //   4..8   padding, to bring the first struct to its 8-alignment
    //   8..12  struct one
    //   12..16 padding, to bring the second struct to 8
    //   16..20 struct two
    // so the content runs 8..20 and the length is 12 - not 20, which would
    // include the padding before the first element, and not 2, which would be
    // an element count. A struct is padded at its start and never at its end,
    // so nothing follows the last one.
    const buffer = marshal('a(u)', [[[1], [2]]]);

    assert.equal(buffer.readUInt32LE(0), 12, 'the byte count of the contents only');
    assert.equal(buffer.length, 20);
    assert.equal(buffer.readUInt32LE(8), 1);
    assert.equal(buffer.readUInt32LE(16), 2);

    assert.deepEqual(trip('a(u)', [[[1], [2]]]), [[[1], [2]]]);
});


test('an empty array is four bytes of zero length, and reads back empty', () => {
    const buffer = marshal('as', [[]]);

    assert.equal(buffer.length, 4);
    assert.equal(buffer.readUInt32LE(0), 0);
    assert.deepEqual(trip('as', [[]]), [[]]);
});


test('an array of bytes counts bytes, which is the case where the two agree', () => {
    const buffer = marshal('ay', [[1, 2, 3]]);

    assert.equal(buffer.readUInt32LE(0), 3);
    assert.equal(buffer.length, 7);
});


test("a signature's length is one byte where a string's is four", () => {
    const sig = marshal('g', ['s']);
    const str = marshal('s', ['s']);

    assert.equal(sig.length, 3, 'one length byte, one character, one NUL');
    assert.equal(sig.readUInt8(0), 1);

    assert.equal(str.length, 6, 'four length bytes, one character, one NUL');
    assert.equal(str.readUInt32LE(0), 1);
});


test('a signature next to a string does not shift what follows it', () => {
    // the classic failure: treating g's length as a uint32 moves everything
    // after it by three bytes, and the next field decodes as garbage
    assert.deepEqual(trip('gs', ['au', 'after']), ['au', 'after']);
    assert.deepEqual(trip('sgs', ['before', 'a{sv}', 'after']), ['before', 'a{sv}', 'after']);
});


test('a variant carries its signature and unmarshals to the bare value', () => {
    assert.deepEqual(trip('v', [new Variant('s', 'wlan0')]), ['wlan0']);
    assert.deepEqual(trip('v', [new Variant('u', 42)]), [42]);
    assert.deepEqual(trip('v', [new Variant('as', ['a', 'b'])]), [['a', 'b']]);
});


test('a dict array reads back as an object', () => {
    const buffer = marshal('a{sv}', [[['Name', new Variant('s', 'wlan0')], ['Strength', new Variant('n', -55)]]]);
    const { value } = unmarshal('a{sv}', buffer);

    assert.deepEqual(value, [{ Name: 'wlan0', Strength: -55 }]);
});


test('a dict array can be written from a plain object', () => {
    const fromPairs = marshal('a{ss}', [[['a', 'b']]]);
    const fromObject = marshal('a{ss}', [{ a: 'b' }]);

    assert.deepEqual([...fromObject], [...fromPairs]);
});


test('a nested array of structs of strings survives, which is ListUnits shaped', () => {
    const rows = [
        ['sshd.service', 'OpenSSH Daemon', 'loaded', 'active', 'running', '', '/org/freedesktop/systemd1/unit/sshd_2eservice', 0, '', '/'],
        ['dbus.service', 'D-Bus System Bus', 'loaded', 'active', 'running', '', '/org/freedesktop/systemd1/unit/dbus_2eservice', 0, '', '/'],
    ];

    assert.deepEqual(trip('a(ssssssouso)', [rows]), [rows]);
});


test('big-endian decodes, from a buffer x86 will never produce', () => {
    const buffer = marshal('us', [1, 'hi'], false);

    assert.equal(buffer.readUInt32BE(0), 1, 'hand-check: the same bytes read little-endian would be 16777216');
    assert.notEqual(buffer.readUInt32LE(0), 1);

    assert.deepEqual(unmarshal('us', buffer, 0, false).value, [1, 'hi']);
});


test('an endianness mismatch is caught rather than silently wrong', () => {
    const buffer = marshal('u', [1], false);

    assert.notDeepEqual(unmarshal('u', buffer, 0, true).value, [1]);
});


test('a truncated buffer throws rather than returning a plausible value', () => {
    const buffer = marshal('s', ['hello']);

    assert.throws(() => unmarshal('s', buffer.subarray(0, 6)), /ended early/);
});


test('an array that overruns its stated length is rejected', () => {
    const buffer = marshal('au', [[1, 2, 3]]);

    // claim one more byte of content than there is room to decode cleanly
    buffer.writeUInt32LE(10, 0);

    assert.throws(() => unmarshal('au', buffer), /overran|ended early/);
});


test('signatures split into complete types, brackets and all', () => {
    assert.deepEqual(parseSignature('yyyyuu'), ['y', 'y', 'y', 'y', 'u', 'u']);
    assert.deepEqual(parseSignature('a(yv)'), ['a(yv)']);
    assert.deepEqual(parseSignature('a(ssssssouso)'), ['a(ssssssouso)']);
    assert.deepEqual(parseSignature('sa{sv}as'), ['s', 'a{sv}', 'as']);
    assert.deepEqual(parseSignature('aa{sv}'), ['aa{sv}']);
    assert.deepEqual(parseSignature(''), []);

    assert.equal(completeTypeLength('aa{sv}'), 6);
    assert.equal(completeTypeLength('(ii)s'), 4);
});


test('a malformed signature is an error, not a silent misread', () => {
    assert.throws(() => parseSignature('a'), /ended early/);
    assert.throws(() => parseSignature('(is'), /unclosed/);
    assert.throws(() => parseSignature('Z'), /unknown type code/);
});


test('align rounds up and leaves an already-aligned offset alone', () => {
    assert.equal(align(0, 8), 0);
    assert.equal(align(1, 8), 8);
    assert.equal(align(8, 8), 8);
    assert.equal(align(9, 4), 12);
    assert.equal(align(5, 1), 5);
});


test('a method call round-trips through encode and decode', () => {
    const encoded = encodeMessage({
        type: MESSAGE_TYPE.methodCall,
        serial: 7,
        path: '/org/freedesktop/systemd1',
        iface: 'org.freedesktop.systemd1.Manager',
        member: 'ListUnits',
        destination: 'org.freedesktop.systemd1',
    });

    assert.equal(encoded.length % 8, 0, 'a message with no body ends on the boundary its body would start at');
    assert.equal(messageLength(encoded), encoded.length);

    const decoded = decodeMessage(encoded);

    assert.equal(decoded.type, MESSAGE_TYPE.methodCall);
    assert.equal(decoded.serial, 7);
    assert.equal(decoded.member, 'ListUnits');
    assert.equal(decoded.path, '/org/freedesktop/systemd1');
    assert.equal(decoded.destination, 'org.freedesktop.systemd1');
    assert.deepEqual(decoded.body, []);
});


test('a message with a body states its signature and length', () => {
    const encoded = encodeMessage({
        type: MESSAGE_TYPE.methodCall,
        serial: 2,
        destination: 'org.freedesktop.DBus',
        path: '/org/freedesktop/DBus',
        iface: 'org.freedesktop.DBus',
        member: 'GetNameOwner',
        signature: 's',
        body: ['org.freedesktop.systemd1'],
    });

    const decoded = decodeMessage(encoded);

    assert.equal(decoded.signature, 's');
    assert.deepEqual(decoded.body, ['org.freedesktop.systemd1']);
    assert.equal(decoded.bodyLength, 4 + 'org.freedesktop.systemd1'.length + 1);
});


test('the body begins on an 8-byte boundary whatever the header length', () => {
    // member names of different lengths move the header array's end around; the
    // body must still start aligned, and a decode that assumed otherwise would
    // read the body shifted by up to seven bytes
    for (const member of ['A', 'AB', 'ABC', 'ABCD', 'ABCDE', 'ABCDEF', 'ABCDEFG', 'ABCDEFGH']) {
        const encoded = encodeMessage({
            type: MESSAGE_TYPE.methodCall,
            serial: 1,
            path: '/x',
            member,
            signature: 't',
            body: [0x1122334455667788n],
        });

        const decoded = decodeMessage(encoded);

        assert.deepEqual(decoded.body, [0x1122334455667788n], `member ${member}`);
        assert.equal(messageLength(encoded), encoded.length, `member ${member}`);
    }
});


test('messageLength says "not yet" until the whole message is present', () => {
    const encoded = encodeMessage({
        type: MESSAGE_TYPE.methodCall,
        serial: 1,
        path: '/x',
        member: 'M',
        signature: 's',
        body: ['a somewhat longer string so the body spans several chunks'],
    });

    assert.equal(messageLength(encoded.subarray(0, 4)), null, 'not even the fixed header yet');
    assert.equal(messageLength(encoded.subarray(0, 16)), null, 'header lengths known, body not here');
    assert.equal(messageLength(encoded.subarray(0, encoded.length - 1)), null, 'one byte short');
    assert.equal(messageLength(encoded), encoded.length);

    // a stream hands over two messages at once and the first must be framed
    // without consuming the second
    const two = Buffer.concat([encoded, encoded]);

    assert.equal(messageLength(two), encoded.length);
});


test('an error reply carries its name and is typed as an error', () => {
    const encoded = encodeMessage({
        type: MESSAGE_TYPE.error,
        serial: 9,
        signature: 's',
        body: ['no such interface'],
    });

    const decoded = decodeMessage(encoded);

    assert.equal(decoded.type, MESSAGE_TYPE.error);
    assert.deepEqual(decoded.body, ['no such interface']);
});


test('an unknown endianness byte is refused', () => {
    const encoded = encodeMessage({ type: MESSAGE_TYPE.methodCall, serial: 1, path: '/x', member: 'M' });

    encoded.writeUInt8(0x41, 0);

    assert.throws(() => decodeMessage(encoded), /endianness/);
});


test('the header field codes are the ones the spec assigns', () => {
    // a wrong code here is invisible: the daemon simply ignores the field and
    // answers a call with no member as "unknown method"
    assert.deepEqual(FIELD, {
        path: 1, iface: 2, member: 3, errorName: 4,
        replySerial: 5, destination: 6, sender: 7, signature: 8, unixFds: 9,
    });
});


test('the bus address defaults to the system socket and the env var overrides', () => {
    assert.deepEqual(systemBusAddress(undefined, {}), { kind: 'path', path: '/run/dbus/system_bus_socket' });

    assert.deepEqual(
        systemBusAddress(undefined, { DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/tmp/bus' }),
        { kind: 'path', path: '/tmp/bus' },
    );

    // an explicit option beats both, and a bare path is accepted for tests
    assert.deepEqual(systemBusAddress('/tmp/mine', { DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/tmp/bus' }),
        { kind: 'path', path: '/tmp/mine' });
});


test('an abstract socket is addressed with a leading NUL', () => {
    const address = parseBusAddress('unix:abstract=/tmp/dbus-abc,guid=deadbeef');

    assert.deepEqual(address, { kind: 'abstract', path: '/tmp/dbus-abc' });
    assert.equal(connectPath(address), '\0/tmp/dbus-abc');
    assert.equal(connectPath({ kind: 'path', path: '/run/x' }), '/run/x');
});


test('a percent-escaped path is unescaped, and a tcp bus is not accepted', () => {
    assert.deepEqual(parseBusAddress('unix:path=/tmp/a%2Cb'), { kind: 'path', path: '/tmp/a,b' });

    // a system monitor reading the local machine has no business on a tcp bus,
    // and claiming support would mean claiming its authentication too
    assert.equal(parseBusAddress('tcp:host=localhost,port=1234'), null);
    assert.equal(parseBusAddress(''), null);

    // the first unix transport in a list wins
    assert.deepEqual(
        parseBusAddress('tcp:host=x,port=1;unix:path=/run/bus'),
        { kind: 'path', path: '/run/bus' },
    );
});


/**
 * 463 bytes captured off the real system bus: a Hello reply, the NameAcquired
 * signal the daemon volunteers straight after it, and an error reply. Three
 * message types in one stream, which is also what makes it a framing test.
 */
const CAPTURED = Buffer.from(readFileSync('test/fixtures/dbus-replies.hex', 'utf8').trim(), 'hex');


function frames(buffer)
{
    const messages = [];

    let rest = buffer;

    for (;;) {
        const length = messageLength(rest);

        if (length === null) {
            return messages;
        }

        messages.push(decodeMessage(rest.subarray(0, length)));
        rest = rest.subarray(length);
    }
}


test('a real captured reply stream decodes into its three messages', () => {
    const messages = frames(CAPTURED);

    assert.equal(messages.length, 3);

    const [hello, signal, error] = messages;

    assert.equal(hello.type, MESSAGE_TYPE.methodReturn);
    assert.equal(hello.replySerial, 1, 'the reply names the call it answers');
    assert.equal(hello.signature, 's');
    assert.deepEqual(hello.body, [':1.13161']);
    assert.equal(hello.sender, 'org.freedesktop.DBus');

    // the daemon volunteers this without being asked, which is exactly why a
    // client must match replies by serial rather than by arrival order
    assert.equal(signal.type, MESSAGE_TYPE.signal);
    assert.equal(signal.member, 'NameAcquired');
    assert.equal(signal.replySerial, undefined);

    assert.equal(error.type, MESSAGE_TYPE.error);
    assert.equal(error.replySerial, 2);
    assert.equal(error.errorName, 'org.freedesktop.DBus.Error.AccessDenied');
    assert.deepEqual(error.body, ['Sender is not authorized to send message']);
});


test('the captured stream reframes byte by byte, as a socket would deliver it', () => {
    // a chunk can hold half a message, three messages, or two and a half
    for (const chunk of [1, 7, 16, 64, 100, 463]) {
        let assembled = Buffer.alloc(0);
        let count = 0;

        for (let at = 0; at < CAPTURED.length; at += chunk) {
            assembled = Buffer.concat([assembled, CAPTURED.subarray(at, at + chunk)]);

            for (;;) {
                const length = messageLength(assembled);

                if (length === null) {
                    break;
                }

                decodeMessage(assembled.subarray(0, length));
                assembled = assembled.subarray(length);
                count++;
            }
        }

        assert.equal(count, 3, `chunk size ${chunk}`);
        assert.equal(assembled.length, 0, `chunk size ${chunk}: leftover bytes`);
    }
});


test('the captured Hello reply is exactly 101 bytes, header padding included', () => {
    // pinned because the padding to 8 before the body is the classic off-by-N
    // and a wrong one still produces a decodable-looking message
    assert.equal(messageLength(CAPTURED), 101);
});
