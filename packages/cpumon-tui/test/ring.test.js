import test from 'node:test';
import assert from 'node:assert/strict';

import { Ring } from '../dist/internal.js';


/** latest() into a fresh array, as a plain JS array for readable assertions */
const latest = (ring, n) => {
    const out = new Float64Array(n);
    const written = ring.latest(n, out);

    return [...out.slice(0, written)];
};


const fill = (ring, values) => {
    for (const value of values) {
        ring.push(value);
    }

    return ring;
};


test('an empty ring reports nothing rather than zeros', () => {
    const ring = new Ring(4);

    assert.equal(ring.length, 0);
    assert.equal(ring.last, undefined);
    assert.deepEqual(latest(ring, 4), []);
});


test('latest returns the samples oldest first', () => {
    // graphs are drawn left to right with the newest on the right, so this
    // order is the one the caller wants; reversing it silently mirrors history
    const ring = fill(new Ring(8), [1, 2, 3]);

    assert.deepEqual(latest(ring, 8), [1, 2, 3]);
    assert.equal(ring.last, 3);
});


test('latest writes only what it has, and says how much that was', () => {
    const ring = fill(new Ring(8), [1, 2, 3]);
    const out = new Float64Array(8).fill(-1);

    assert.equal(ring.latest(8, out), 3);
    // the tail must be left alone, so the caller can left-pad rather than
    // draw a flat line claiming the machine was idle before it started
    assert.equal(out[3], -1);
});


test('a full ring keeps the newest and drops the oldest', () => {
    const ring = fill(new Ring(4), [1, 2, 3, 4, 5, 6]);

    assert.equal(ring.length, 4);
    assert.deepEqual(latest(ring, 4), [3, 4, 5, 6]);
});


test('the wrap point is not a special case', () => {
    const ring = new Ring(3);

    // exactly capacity
    fill(ring, [1, 2, 3]);
    assert.deepEqual(latest(ring, 3), [1, 2, 3]);

    // capacity + 1, where head wraps back to 0
    ring.push(4);
    assert.deepEqual(latest(ring, 3), [2, 3, 4]);

    // and a full extra lap, where head returns to where it started
    fill(ring, [5, 6, 7]);
    assert.deepEqual(latest(ring, 3), [5, 6, 7]);
});


test('asking for fewer than are held returns the newest of them', () => {
    const ring = fill(new Ring(8), [1, 2, 3, 4, 5]);

    assert.deepEqual(latest(ring, 2), [4, 5]);
});


test('asking for more than the ring can hold is clamped, not an error', () => {
    const ring = fill(new Ring(4), [1, 2, 3, 4, 5]);

    assert.deepEqual(latest(ring, 100), [2, 3, 4, 5]);
});


test('latest never writes past the end of the array it was given', () => {
    const ring = fill(new Ring(8), [1, 2, 3, 4, 5]);
    const out = new Float64Array(2);

    assert.equal(ring.latest(8, out), 2);
    assert.deepEqual([...out], [4, 5]);
});


test('clear empties the ring without disturbing later pushes', () => {
    const ring = fill(new Ring(4), [1, 2, 3, 4, 5]);

    ring.clear();

    assert.equal(ring.length, 0);
    assert.equal(ring.last, undefined);

    ring.push(9);
    assert.deepEqual(latest(ring, 4), [9]);
});


test('max looks only at the window it was asked about', () => {
    const ring = fill(new Ring(8), [10, 90, 20, 30]);

    assert.equal(ring.max(8), 90);
    // the spike is outside the last two samples, so it must not be reported
    assert.equal(ring.max(2), 30);
    assert.equal(new Ring(4).max(4), 0);
});


test('a non-finite sample is stored as zero rather than poisoning the series', () => {
    // one NaN would propagate through every max and scale downstream and come
    // out as a graph that cannot be drawn at all
    const ring = fill(new Ring(4), [1, NaN, Infinity, 2]);

    assert.deepEqual(latest(ring, 4), [1, 0, 0, 2]);
    assert.equal(ring.max(4), 2);
});


test('a nonsense capacity is rejected at construction', () => {
    // the alternative is a %-by-zero that yields NaN indices and silently
    // stores nothing
    assert.throws(() => new Ring(0), RangeError);
    assert.throws(() => new Ring(-1), RangeError);
    assert.throws(() => new Ring(1.5), RangeError);
});
