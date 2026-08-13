import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ANSI16_THEME,
    DEFAULT_THEME,
    MONO_THEME,
    nextTheme,
    rampLerp,
    rampStep,
    resolveTheme,
    rowColor,
} from '../dist/internal.js';


const RAMP = ['#000000', '#404040', '#808080', '#ffffff'];


test('the ramp spends its resolution where the answer matters', () => {
    // below half the only question is "idle or not", so the first stop covers
    // all of it; the last three split 50-100 where a user might actually act
    assert.equal(rampStep(RAMP, 0), RAMP[0]);
    assert.equal(rampStep(RAMP, 0.49), RAMP[0]);
    assert.equal(rampStep(RAMP, 0.5), RAMP[1]);
    assert.equal(rampStep(RAMP, 0.74), RAMP[1]);
    assert.equal(rampStep(RAMP, 0.75), RAMP[2]);
    assert.equal(rampStep(RAMP, 0.89), RAMP[2]);
    assert.equal(rampStep(RAMP, 0.9), RAMP[3]);
    assert.equal(rampStep(RAMP, 1), RAMP[3]);
});


test('the ramp clamps rather than falling off either end', () => {
    // cpuPercentage is on top's scale, so a 4-thread build legitimately
    // reports 400 and a ratio of 4
    assert.equal(rampStep(RAMP, -1), RAMP[0]);
    assert.equal(rampStep(RAMP, 4), RAMP[3]);
    assert.equal(rampStep(RAMP, NaN), RAMP[0]);
});


test('the continuous ramp blends between the stops', () => {
    assert.equal(rampLerp(RAMP, 0), '#000000');
    assert.equal(rampLerp(RAMP, 1), '#ffffff');

    // a quarter of the way through the first band, which spans 0 to 0.5
    assert.equal(rampLerp(RAMP, 0.25), '#202020');
});


test('the continuous ramp is monotonic', () => {
    let previous = -1;

    for (let i = 0; i <= 100; i++) {
        const value = Number.parseInt(rampLerp(RAMP, i / 100).slice(1, 3), 16);

        assert.ok(value >= previous, `ratio ${i / 100} went backwards`);
        previous = value;
    }
});


test('the continuous ramp falls back to stepping for named colours', () => {
    // there is nothing to interpolate between 'green' and 'yellow', and
    // guessing would emit a hex value a 16-colour terminal cannot show
    assert.equal(rampLerp(ANSI16_THEME.cpu, 0.6), rampStep(ANSI16_THEME.cpu, 0.6));
    assert.equal(rampLerp(MONO_THEME.cpu, 0.6), undefined);
});


test('graph rows are coloured by height on the axis, not by value', () => {
    // so a spike's tip is hot and its base is cool - the same column changes
    // colour as it rises, which is what makes height readable at a glance
    const rows = 4;

    assert.equal(rowColor(RAMP, 0, rows, false), RAMP[3]);
    assert.equal(rowColor(RAMP, rows - 1, rows, false), RAMP[0]);
});


test('rowColor survives a zero-height graph', () => {
    assert.equal(rowColor(RAMP, 0, 0, false), RAMP[0]);
});


test('a colourless terminal gets the mono theme whatever was asked for', () => {
    // the alternative is escape sequences printed as literal text
    assert.equal(resolveTheme('default', 0), MONO_THEME);
    assert.equal(resolveTheme('auto', 0), MONO_THEME);
});


test('auto picks by depth', () => {
    assert.equal(resolveTheme('auto', 1), ANSI16_THEME);
    assert.equal(resolveTheme('auto', 2), DEFAULT_THEME);
    assert.equal(resolveTheme('auto', 3), DEFAULT_THEME);
});


test('an explicit theme is honoured on any terminal that has colour', () => {
    assert.equal(resolveTheme('mono', 3), MONO_THEME);
    assert.equal(resolveTheme('ansi16', 3), ANSI16_THEME);
    assert.equal(resolveTheme('default', 1), DEFAULT_THEME);
});


test('every theme answers every role, so no component can hit a hole', () => {
    const roles = Object.keys(DEFAULT_THEME);

    for (const theme of [ANSI16_THEME, MONO_THEME]) {
        for (const role of roles) {
            assert.ok(role in theme, `${theme.name} is missing ${role}`);
        }
    }
});


test('the mono theme has no colour at all, and says so', () => {
    // undefined rather than a colour name is what makes <Text color={...}>
    // render plain, so the same components work on a monochrome terminal
    for (const [role, value] of Object.entries(MONO_THEME)) {
        if (role === 'name' || role === 'useAttributes') {
            continue;
        }

        const values = Array.isArray(value) ? value : [value];

        for (const item of values) {
            assert.equal(item, undefined, `mono.${role} should carry no colour`);
        }
    }

    // and it compensates with bold, dim and inverse
    assert.equal(MONO_THEME.useAttributes, true);
});


test('every ramp has four stops', () => {
    for (const theme of [DEFAULT_THEME, ANSI16_THEME, MONO_THEME]) {
        for (const key of ['cpu', 'memory', 'network', 'disk']) {
            assert.equal(theme[key].length, 4, `${theme.name}.${key}`);
        }
    }
});


test('the theme cycle visits every theme and returns to the start', () => {
    const seen = [];
    let current = 'auto';

    for (let i = 0; i < 4; i++) {
        seen.push(current);
        current = nextTheme(current);
    }

    assert.deepEqual(seen, ['auto', 'default', 'ansi16', 'mono']);
    assert.equal(current, 'auto');
});
