import test from 'node:test';
import assert from 'node:assert/strict';

import { meter, quantise, rasterise, rasteriseInverted, spark } from '../dist/internal.js';


const draw = (values, cols, rows, max) => rasterise(values, values.length, cols, rows, max).rows;


test('a zero renders blank, not a phantom baseline', () => {
    // one eighth of a block across a whole idle graph reads as a constant low
    // load that is not there - the single most misleading thing this could do
    assert.equal(quantise(0, 100, 1), 0);
    assert.deepEqual(draw([0, 0, 0], 3, 1, 100), ['   ']);
});


test('a full value fills the column', () => {
    assert.equal(quantise(100, 100, 1), 8);
    assert.deepEqual(draw([100], 1, 1, 100), ['█']);
});


test('a near-full value reads full rather than an eighth short', () => {
    // rounding, not flooring: 99% must not draw as 7/8ths
    assert.equal(quantise(99, 100, 1), 8);
});


test('the smallest non-zero value still draws something', () => {
    // a value below half an eighth would round to nothing, and a graph that
    // hides the difference between "a little" and "none" is worse than coarse
    assert.equal(quantise(0.0001, 100, 1), 1);
    assert.deepEqual(draw([0.0001], 1, 1, 100), ['▁']);
});


test('a mid value lands mid-glyph', () => {
    assert.deepEqual(draw([0, 50, 100], 3, 1, 100), [' ▄█']);
});


test('a value over the axis is clamped rather than overflowing the glyph set', () => {
    assert.equal(quantise(500, 100, 1), 8);
    assert.deepEqual(draw([500], 1, 1, 100), ['█']);
});


test('a zero or negative axis draws nothing instead of dividing by it', () => {
    assert.equal(quantise(50, 0, 2), 0);
    assert.deepEqual(draw([50, 60], 2, 1, 0), ['  ']);
});


test('a taller graph fills whole cells below the level', () => {
    // 100% of a two-row graph is both rows solid; 50% is the lower row solid
    // and the upper blank
    assert.deepEqual(draw([100], 1, 2, 100), ['█', '█']);
    assert.deepEqual(draw([50], 1, 2, 100), [' ', '█']);
    assert.deepEqual(draw([75], 1, 2, 100), ['▄', '█']);
});


test('rows come back top first, which is the order they print in', () => {
    const rows = draw([25], 1, 4, 100);

    assert.equal(rows.length, 4);
    assert.equal(rows[0], ' ');
    assert.equal(rows[3], '█');
});


test('a short history is left-padded, not zero-filled', () => {
    // blanks on the left say "not measured yet"; a flat line at the bottom
    // would claim the machine was idle before the dashboard started
    assert.deepEqual(draw([100, 100], 5, 1, 100), ['   ██']);
});


test('a history longer than the graph keeps the newest samples', () => {
    const values = [10, 20, 30, 100, 100];

    assert.deepEqual(rasterise(values, values.length, 2, 1, 100).rows, ['██']);
});


test('rasterise reports how many columns carry data', () => {
    assert.equal(rasterise([1, 2], 2, 5, 1, 100).filled, 2);
    assert.equal(rasterise([1, 2, 3, 4, 5, 6], 6, 4, 1, 100).filled, 4);
});


test('rasterise reads only the count it was told about', () => {
    // Ring.latest writes into a reusable buffer whose tail is stale, so an
    // over-read here would draw last frame's data on the right edge
    const buffer = new Float64Array([100, 100, 999, 999]);

    assert.deepEqual(rasterise(buffer, 2, 4, 1, 100).rows, ['  ██']);
});


test('a degenerate size returns no rows rather than throwing', () => {
    assert.deepEqual(rasterise([1], 1, 0, 4, 100).rows, []);
    assert.deepEqual(rasterise([1], 1, 4, 0, 100).rows, []);
});


test('the inverted raster is the mirror of the upright one', () => {
    // there is no top-anchored eighths set in unicode - only U+2594 and U+2580
    // exist - so the lower half of a mirrored graph reverses rows instead
    const up = rasterise([25], 1, 4, 100).rows;
    const down = rasteriseInverted([25], 1, 1, 4, 100).rows;

    assert.deepEqual(down, [...rasterise([25], 1, 1, 4, 100).rows].reverse());
    assert.equal(down[0], '█');
    assert.notEqual(up, down);
});


test('meter fills proportionally and pads to its full width', () => {
    assert.equal(meter(0, 4), '    ');
    assert.equal(meter(1, 4), '████');
    assert.equal(meter(0.5, 4), '██  ');
});


test('meter uses a fractional cell so it does not move in whole steps', () => {
    // at a ten-cell bar a whole-cell meter only moves in tenths, which reads
    // as stuck rather than as coarse
    assert.equal(meter(0.625, 4), '██▌ ');
    assert.notEqual(meter(0.62, 10), meter(0.65, 10));
});


test('meter never exceeds the width it was given', () => {
    for (let width = 1; width <= 40; width++) {
        for (const ratio of [0, 0.001, 0.5, 0.999, 1, 1.5, -1, NaN]) {
            assert.equal(meter(ratio, width).length, width, `ratio ${ratio} at width ${width}`);
        }
    }
});


test('a full meter has no partial cell tacked on the end', () => {
    assert.equal(meter(1, 3), '███');
    assert.equal(meter(0.9999, 3), '███');
});


test('spark maps a value onto one glyph', () => {
    assert.equal(spark(0, 100), ' ');
    assert.equal(spark(100, 100), '█');
    assert.equal(spark(50, 100), '▄');
});
