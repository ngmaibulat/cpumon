import test from 'node:test';
import assert from 'node:assert/strict';

import { bytes, duration, formatUptime, gib, percent, rate, shortId } from '../bin/format.js';


test('bytes leaves whole bytes without a decimal point', () => {
    assert.equal(bytes(0), '0 B');
    assert.equal(bytes(512), '512 B');
    assert.equal(bytes(1023), '1023 B');
});


test('bytes steps up a unit at exactly 1024', () => {
    assert.equal(bytes(1024), '1.0 KiB');
    assert.equal(bytes(1024 ** 2), '1.0 MiB');
    assert.equal(bytes(1024 ** 3), '1.0 GiB');
});


test('bytes stops scaling at the largest unit it knows', () => {
    // beyond PiB there is nothing to step up to, so the number grows instead of
    // the unit - which is right, but only if the loop actually terminates
    assert.equal(bytes(1024 ** 6), '1024.0 PiB');
});


test('bytes keeps the sign of a negative delta', () => {
    assert.equal(bytes(-2048), '-2.0 KiB');
});


test('rate appends a per-second suffix', () => {
    assert.equal(rate(1536), '1.5 KiB/s');
});


test('gib is fixed-unit, unlike bytes', () => {
    assert.equal(gib(1024 ** 3), '1.0');
    // the point of a fixed unit is that a column of them lines up, so a small
    // value must NOT scale itself down to MiB
    assert.equal(gib(1024 ** 2), '0.0');
});


test('formatUptime drops leading units that are zero', () => {
    assert.equal(formatUptime(0), '0m');
    assert.equal(formatUptime(90), '1m');
    assert.equal(formatUptime(3600), '1h 0m');
});


test('formatUptime keeps an hours figure whenever there are days', () => {
    // 4d 0h 12m must not collapse to "4d 12m", where the 12 reads as hours
    assert.equal(formatUptime(4 * 86400 + 12 * 60), '4d 0h 12m');
    assert.equal(formatUptime(4 * 86400 + 3 * 3600 + 12 * 60), '4d 3h 12m');
});


test('shortId trims a known runtime prefix to 12 hex characters', () => {
    const id = `docker-${'a1b2c3d4e5f6'}${'0'.repeat(52)}.scope`;

    assert.equal(shortId(id), 'a1b2c3d4e5f6');
    assert.equal(shortId('libpod-0123456789ab...'), '0123456789ab');
});


test('shortId leaves anything it does not recognise alone', () => {
    // a systemd slice or a bare path is already readable; mangling it would
    // lose the only identifying information the row has
    assert.equal(shortId('user.slice'), 'user.slice');
    assert.equal(shortId('/'), '/');
});


test('percent takes a ratio, not a percentage', () => {
    assert.equal(percent(0.615), '62%');
    assert.equal(percent(0.615, 1), '61.5%');
    assert.equal(percent(1), '100%');
});


test('duration switches unit as the magnitude grows', () => {
    assert.equal(duration(820), '820ms');
    assert.equal(duration(4200), '4.2s');
    assert.equal(duration(200_000), '3m 20s');
    assert.equal(duration(7_500_000), '2h 5m');
});
