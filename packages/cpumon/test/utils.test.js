import test from 'node:test';
import assert from 'node:assert/strict';

import { getProgressBar } from '../bin/utils.js';


// compare chalk output with the SGR escape sequences dropped
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const strip = (s) => s.replace(ANSI, '');


test('getProgressBar fills nothing at 0', () => {
    const bar = strip(getProgressBar(0, '|'));

    assert.equal(bar, `[${' '.repeat(100)}0%]`);
});


test('getProgressBar fills the whole width at 100', () => {
    const bar = strip(getProgressBar(100, '|'));

    assert.equal(bar, `[${'|'.repeat(100)}100%]`);
});


test('getProgressBar keeps a constant 100 column width', () => {
    for (const progress of [0, 1, 37, 99, 100]) {
        const bar = strip(getProgressBar(progress, '|'));
        const filled = (bar.match(/\|/g) ?? []).length;
        const blank = (bar.match(/ /g) ?? []).length;

        assert.equal(filled, progress);
        assert.equal(filled + blank, 100);
    }
});


test('getProgressBar rejects values outside 0..100', () => {
    assert.throws(() => getProgressBar(-1, '|'), /range/);
    assert.throws(() => getProgressBar(101, '|'), /range/);
});


test('getProgressBar rejects NaN', () => {
    // NaN used to slip past the range check and render a malformed bar
    assert.throws(() => getProgressBar(NaN, '|'), /range/);
});
