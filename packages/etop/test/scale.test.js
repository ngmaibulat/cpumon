import test from 'node:test';
import assert from 'node:assert/strict';

import { AutoScale, niceMax } from '../dist/internal.js';


test('niceMax rounds up through the 1-2-5 sequence', () => {
    assert.equal(niceMax(1), 1);
    assert.equal(niceMax(1.1), 2);
    assert.equal(niceMax(2), 2);
    assert.equal(niceMax(2.1), 5);
    assert.equal(niceMax(5), 5);
    assert.equal(niceMax(5.1), 10);
    assert.equal(niceMax(10), 10);
});


test('the sequence repeats across decades', () => {
    assert.equal(niceMax(1234), 2000);
    assert.equal(niceMax(0.03), 0.05);
    assert.equal(niceMax(3_500_000), 5_000_000);
});


test('an exact decade boundary does not overshoot', () => {
    // log10 and ** are not exact, so 1000 can land a hair above its own
    // candidate and get rounded up to 2000 - a doubled axis for no reason
    for (const value of [1, 10, 100, 1000, 10_000, 100_000, 1_000_000]) {
        assert.equal(niceMax(value), value, `${value} should be its own ceiling`);
    }
});


test('nothing to draw gives no axis rather than an axis of one', () => {
    // an axis of "1 byte per second" over an idle link amplifies rounding noise
    // into a full-height graph
    assert.equal(niceMax(0), 0);
    assert.equal(niceMax(-5), 0);
    assert.equal(niceMax(NaN), 0);
    assert.equal(niceMax(Infinity), 0);
});


test('an axis grows the moment the data needs it', () => {
    // a clipped spike is a misreport, not a cosmetic problem, so growth is
    // never delayed
    const scale = new AutoScale();

    assert.equal(scale.update(3), 5);
    assert.equal(scale.update(40), 50);
    assert.equal(scale.update(400), 500);
});


test('an axis holds while the data is quiet, then shrinks once', () => {
    const scale = new AutoScale({ shrinkAfter: 3 });

    scale.update(400);
    assert.equal(scale.current, 500);

    // the first two quiet ticks change nothing: an axis that moved under a
    // graph every frame would make shape a property of the axis, not the data
    assert.equal(scale.update(1), 500);
    assert.equal(scale.update(1), 500);
    assert.equal(scale.update(1), 1);
});


test('a spike resets the patience counter', () => {
    const scale = new AutoScale({ shrinkAfter: 3 });

    scale.update(400);
    scale.update(1);
    scale.update(1);
    // back up to the old level, so the two quiet ticks no longer count
    scale.update(400);
    assert.equal(scale.update(1), 500);
    assert.equal(scale.update(1), 500);
    assert.equal(scale.update(1), 1);
});


test('staying at the same level indefinitely never shrinks', () => {
    const scale = new AutoScale({ shrinkAfter: 2 });

    scale.update(400);

    for (let i = 0; i < 20; i++) {
        assert.equal(scale.update(400), 500);
    }
});


test('a floor keeps a near-idle series from amplifying noise', () => {
    const scale = new AutoScale({ floor: 1000 });

    assert.equal(scale.update(0), 1000);
    assert.equal(scale.update(3), 1000);
    assert.equal(scale.update(9000), 10_000);
});


test('reset returns the axis to nothing', () => {
    const scale = new AutoScale();

    scale.update(400);
    scale.reset();

    assert.equal(scale.current, 0);
    assert.equal(scale.update(1), 1);
});
