import test from 'node:test';
import assert from 'node:assert/strict';

import {
    checkRefusal,
    detectColorLevel,
    resolveGraphStyle,
    supportsUnicode,
} from '../dist/internal.js';


const tty = { stdin: { isTTY: true }, stdout: { isTTY: true } };
const term = { TERM: 'xterm-256color' };


test('a full terminal is not refused', () => {
    assert.equal(checkRefusal(tty, term), null);
});


test('a piped stdout is refused before anything is drawn', () => {
    const refusal = checkRefusal({ ...tty, stdout: {} }, term);

    assert.ok(refusal);
    assert.match(refusal.message, /stdout is not one/);
    // the suggestion has to name something that actually works, or the refusal
    // is just a dead end
    assert.match(refusal.suggestion, /cpumon --json/);
});


test('a redirected stdin is refused, even with a terminal on stdout', () => {
    // `cpumon-tui < /dev/null` is the case that otherwise gets all the way into
    // a render before ink throws "Raw mode is not supported"
    const refusal = checkRefusal({ ...tty, stdin: {} }, term);

    assert.ok(refusal);
    assert.match(refusal.message, /stdin/);
});


test('CI is refused even when both streams are terminals', () => {
    const refusal = checkRefusal(tty, { ...term, CI: 'true' });

    assert.ok(refusal);
    assert.match(refusal.message, /CI/);
});


test('an unset or dumb TERM is refused', () => {
    assert.ok(checkRefusal(tty, {}));
    assert.ok(checkRefusal(tty, { TERM: 'dumb' }));
});


test('NO_COLOR does not stop the dashboard from running', () => {
    // colour and capability are different questions; a user who asked for no
    // colour did not ask for no dashboard
    assert.equal(checkRefusal(tty, { ...term, NO_COLOR: '1' }), null);
});


test('unicode follows the locale, not the terminal name', () => {
    assert.equal(supportsUnicode({ LANG: 'en_US.UTF-8' }), true);
    assert.equal(supportsUnicode({ LC_ALL: 'C.utf8' }), true);
    assert.equal(supportsUnicode({ LANG: 'C' }), false);
    assert.equal(supportsUnicode({}), false);
});


test('LC_ALL outranks LC_CTYPE outranks LANG', () => {
    assert.equal(supportsUnicode({ LC_ALL: 'C', LANG: 'en_US.UTF-8' }), false);
    assert.equal(supportsUnicode({ LC_CTYPE: 'C', LANG: 'en_US.UTF-8' }), false);
});


test('the linux console is not unicode whatever the locale claims', () => {
    // its 512-glyph font has no block characters to render
    assert.equal(supportsUnicode({ TERM: 'linux', LANG: 'en_US.UTF-8' }), false);
});


test('braille is never chosen automatically', () => {
    // the failure mode is a font substitution of a different advance width,
    // which tears the whole frame and cannot be detected at runtime
    assert.equal(resolveGraphStyle('auto', true), 'block');
    assert.equal(resolveGraphStyle('braille', true), 'braille');
});


test('a terminal without unicode gets ascii whatever was asked for', () => {
    assert.equal(resolveGraphStyle('auto', false), 'ascii');
    assert.equal(resolveGraphStyle('block', false), 'ascii');
    assert.equal(resolveGraphStyle('braille', false), 'ascii');
});


test('NO_COLOR and --no-color both mean level zero', () => {
    assert.equal(detectColorLevel(undefined, { ...term, NO_COLOR: '' }), 0);
    assert.equal(detectColorLevel(false, term), 0);
});


test('colour depth is read off COLORTERM and TERM', () => {
    assert.equal(detectColorLevel(undefined, { TERM: 'xterm', COLORTERM: 'truecolor' }), 3);
    assert.equal(detectColorLevel(undefined, { TERM: 'xterm-256color' }), 2);
    assert.equal(detectColorLevel(undefined, { TERM: 'xterm' }), 1);
    assert.equal(detectColorLevel(undefined, {}), 0);
});


test('FORCE_COLOR is honoured and clamped', () => {
    assert.equal(detectColorLevel(undefined, { FORCE_COLOR: '1' }), 1);
    assert.equal(detectColorLevel(undefined, { FORCE_COLOR: '3' }), 3);
    assert.equal(detectColorLevel(undefined, { FORCE_COLOR: '9' }), 3);
    // the bare `FORCE_COLOR=` form means "on", not "off"
    assert.equal(detectColorLevel(undefined, { FORCE_COLOR: '' }), 3);
});


test('NO_COLOR beats FORCE_COLOR', () => {
    assert.equal(detectColorLevel(undefined, { FORCE_COLOR: '3', NO_COLOR: '1' }), 0);
});
