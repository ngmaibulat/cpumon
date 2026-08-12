import test from 'node:test';
import assert from 'node:assert/strict';

import { brailleCapacity, brailleChar, dotMask, rasteriseBraille } from '../dist/internal.js';


const draw = (values, cols, rows, max) => rasteriseBraille(values, values.length, cols, rows, max).rows;


test('the dot masks match the real braille numbering', () => {
    // This is the whole reason this file exists. Braille dots are NOT numbered
    // row-major: 7 and 8 were appended below the original six, so the bottom
    // row is 0x40/0x80 rather than 0x08/0x80. Getting it wrong produces a graph
    // that looks entirely plausible and is upside-down in the low bits.
    assert.equal(dotMask(0, 0), 0x01);
    assert.equal(dotMask(1, 0), 0x02);
    assert.equal(dotMask(2, 0), 0x04);
    assert.equal(dotMask(3, 0), 0x40);

    assert.equal(dotMask(0, 1), 0x08);
    assert.equal(dotMask(1, 1), 0x10);
    assert.equal(dotMask(2, 1), 0x20);
    assert.equal(dotMask(3, 1), 0x80);
});


test('the masks address every dot exactly once', () => {
    const seen = new Set();

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
            seen.add(dotMask(row, col));
        }
    }

    assert.equal(seen.size, 8);
    assert.equal([...seen].reduce((a, b) => a | b, 0), 0xff);
});


test('the codepoints are the ones the standard defines', () => {
    assert.equal(brailleChar(0x00), '⠀');
    assert.equal(brailleChar(0x01), '⠁');
    assert.equal(brailleChar(0xff), '⣿');
});


test('an empty graph is blank braille, not spaces', () => {
    // U+2800 is a braille cell with no dots, and it is width 1 like every other
    // cell in the block - mixing in ASCII spaces would be fine visually and
    // wrong if anything ever measured the string
    assert.deepEqual(draw([0, 0], 1, 1, 100), ['⠀']);
});


test('a full column sets every dot', () => {
    // one cell is two dot-columns, so two full samples fill it completely
    assert.deepEqual(draw([100, 100], 1, 1, 100), ['⣿']);
});


test('a single full sample fills only its own dot-column', () => {
    // the newest sample sits on the right, so it is the right-hand dot column:
    // dots 4, 5, 6 and 8 => 0x08 | 0x10 | 0x20 | 0x80
    assert.deepEqual(draw([100], 1, 1, 100), [brailleChar(0x08 | 0x10 | 0x20 | 0x80)]);
});


test('columns fill from the bottom up', () => {
    // a quarter of a four-dot cell is the bottom dot only, which is dot 8 in
    // the right-hand column
    assert.deepEqual(draw([25], 1, 1, 100), [brailleChar(0x80)]);
});


test('a zero draws nothing while a hair above zero draws one dot', () => {
    assert.deepEqual(draw([0], 1, 1, 100), ['⠀']);
    assert.deepEqual(draw([0.001], 1, 1, 100), [brailleChar(0x80)]);
});


test('a cell holds two samples, so the same width shows twice the history', () => {
    // this is the entire reason to offer braille at all
    assert.equal(brailleCapacity(10), 20);
    assert.equal(brailleCapacity(0), 0);
});


test('history longer than the canvas keeps the newest samples', () => {
    const values = [0, 0, 100, 100];

    // capacity of a one-cell graph is two samples, so the two zeros fall off
    assert.deepEqual(rasteriseBraille(values, values.length, 1, 1, 100).rows, ['⣿']);
});


test('rasteriseBraille reads only the count it was told about', () => {
    const buffer = new Float64Array([100, 100, 999, 999]);

    assert.deepEqual(rasteriseBraille(buffer, 2, 1, 1, 100).rows, ['⣿']);
});


test('a multi-row graph puts the tallest values in the top row', () => {
    const rows = draw([100, 100], 1, 2, 100);

    assert.equal(rows.length, 2);
    assert.equal(rows[0], '⣿');
    assert.equal(rows[1], '⣿');

    // half height reaches the bottom row only
    const half = draw([50, 50], 1, 2, 100);
    assert.equal(half[0], '⠀');
    assert.equal(half[1], '⣿');
});


test('a degenerate size returns no rows rather than throwing', () => {
    assert.deepEqual(rasteriseBraille([1], 1, 0, 2, 100).rows, []);
    assert.deepEqual(rasteriseBraille([1], 1, 2, 0, 100).rows, []);
});


test('every row is exactly as wide as the graph', () => {
    // a short row would shift everything drawn after it on that line
    for (const cols of [1, 3, 8, 40]) {
        for (const rows of [1, 2, 5]) {
            const values = Array.from({ length: 7 }, (_, i) => i * 10);

            for (const line of rasteriseBraille(values, values.length, cols, rows, 100).rows) {
                assert.equal([...line].length, cols, `${cols}x${rows}`);
            }
        }
    }
});
