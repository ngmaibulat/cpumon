import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_TYPES,
    UnitPanel,
    compareUnits,
    initialUi,
    matchesUnit,
    reduce,
    resolve,
    selectUnits,
    unitRow,
} from '../dist/internal.js';

import { assertFits, draw, fakeSlow, h, lines, plain } from './helpers/render.js';


const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), ...over });


const unit = (name, activeState = 'active', over = {}) => ({
    name,
    description: `${name} description`,
    loadState: 'loaded',
    activeState,
    subState: activeState === 'active' ? 'running' : 'dead',
    type: name.slice(name.lastIndexOf('.') + 1),
    ...over,
});


const UNITS = [
    unit('sshd.service'),
    unit('aidecheck.service', 'failed'),
    unit('docker.socket'),
    unit('man-db.timer'),
    unit('dev-disk-by\\x2did-nvme.abc\\x2dpart1.device', 'active', { subState: 'plugged' }),
    unit('home.mount'),
    unit('broken.mount', 'failed'),
    unit('user.slice'),
];


const withUnits = (units = UNITS) => fakeSlow({ units: { available: true, units } });

const render = (props = {}, options = {}) => draw(
    h(UnitPanel, { width: 96, height: 14, ...props }),
    { columns: 96, slow: withUnits(), ...options },
);


test('the default view is services, sockets and timers', () => {
    const shown = selectUnits(UNITS).map(u => u.name);

    assert.deepEqual(DEFAULT_TYPES, ['service', 'socket', 'timer']);

    assert.ok(shown.includes('sshd.service'));
    assert.ok(shown.includes('docker.socket'));
    assert.ok(shown.includes('man-db.timer'));

    // 179 of this machine's 475 units are these two types, and none of them is
    // why anyone opened the screen
    assert.ok(!shown.includes('home.mount'));
    assert.ok(!shown.some(name => name.endsWith('.device')));
    assert.ok(!shown.includes('user.slice'));
});


test('a failed unit is shown whatever its type', () => {
    // a machine whose only broken thing is a .mount would otherwise show a
    // clean screen while being broken, which is what this screen exists to stop
    const shown = selectUnits(UNITS).map(u => u.name);

    assert.ok(shown.includes('broken.mount'), 'a failed mount must not be filtered away');
});


test('showing all types adds the rest back', () => {
    const some = selectUnits(UNITS);
    const all = selectUnits(UNITS, true);

    assert.equal(all.length, UNITS.length);
    assert.ok(all.length > some.length);
    assert.ok(all.map(u => u.name).includes('user.slice'));
});


test('failed units sort to the top, and the rest stay alphabetical', () => {
    const names = selectUnits(UNITS, true).map(u => u.name);

    assert.deepEqual(names.slice(0, 2), ['aidecheck.service', 'broken.mount'].sort());

    const rest = names.slice(2);

    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)), 'alphabetical is what makes a unit findable');
});


test('only failed is promoted, not every state', () => {
    // sorting by state generally would scatter a service and its socket to
    // opposite ends of a list someone is scanning by name
    const mixed = [unit('b.service', 'inactive'), unit('a.service', 'active')];

    assert.deepEqual(mixed.sort(compareUnits).map(u => u.name), ['a.service', 'b.service']);
});


test('the filter matches a name or a description', () => {
    assert.equal(matchesUnit(unit('sshd.service'), 'ssh'), true);
    assert.equal(matchesUnit(unit('sshd.service'), 'SSHD'), true, 'case-insensitive');
    assert.equal(matchesUnit(unit('sshd.service'), 'description'), true, 'the description counts too');
    assert.equal(matchesUnit(unit('sshd.service'), 'nginx'), false);
    assert.equal(matchesUnit(unit('sshd.service'), ''), true, 'no filter matches everything');
});


test('a queued job is shown beside the sub-state it is about to replace', () => {
    const plain = unitRow(unit('a.service'));
    const queued = unitRow(unit('a.service', 'activating', { subState: 'start', jobType: 'start' }));

    assert.equal(plain[3], 'running');
    assert.equal(queued[3], 'start (start)');
});


test('the screen draws its units and names what it is filtering to', () => {
    const output = plain(render());

    assert.match(output, /sshd\.service/);
    assert.match(output, /service\/socket\/timer/, 'a filtered list must admit it is filtered');
    assert.match(output, /2 failed/);
    assert.doesNotMatch(output, /user\.slice/);
});


test('the subtitle changes when all types are shown', () => {
    const output = plain(render({ allTypes: true }));

    assert.match(output, /all types/);
    assert.match(output, /user\.slice/);
});


test('a filter with no match says so rather than drawing an empty table', () => {
    const output = plain(render({ filter: 'nothing-matches-this' }));

    assert.match(output, /no unit matches/);
});


test('a bus that cannot be reached is explained rather than drawn empty', () => {
    const output = plain(draw(
        h(UnitPanel, { width: 96, height: 14 }),
        {
            columns: 96,
            slow: fakeSlow({ units: { available: false, reason: 'not-found', detail: 'no system bus socket' } }),
        },
    ));

    assert.match(output, /not found|no system bus/i);
});


test('`a` toggles the type filter and says which way it went', () => {
    let state = ui({ screen: 'units' });

    assert.equal(state.allUnitTypes, false);

    state = reduce(state, { type: 'toggle-unit-types' });

    assert.equal(state.allUnitTypes, true);
    assert.match(state.message, /all unit types/);

    state = reduce(state, { type: 'toggle-unit-types' });

    assert.equal(state.allUnitTypes, false);
    assert.match(state.message, /service, socket and timer/);
});


test('toggling the type filter puts the cursor back at the top', () => {
    // the list length changes underneath it, so leaving it where it was would
    // land it on an unrelated row
    const state = reduce(ui({ screen: 'units', selected: 40, scroll: 30 }), { type: 'toggle-unit-types' });

    assert.equal(state.selected, 0);
    assert.equal(state.scroll, 0);
});


test('`a` is a unit-screen key and does nothing on the dashboard', () => {
    assert.deepEqual(resolve('a', {}, ui({ screen: 'units' })), { type: 'toggle-unit-types' });
    assert.equal(resolve('a', {}, ui({ screen: 'dash', focus: 'cpu' })), null);
});


test('opening the filter focuses the panel being filtered, not always the process one', () => {
    // phase-01 debt: filter-open hardcoded focus:'process', so opening the
    // filter on the units screen moved the dashboard's focus somewhere unrelated
    assert.equal(reduce(ui({ screen: 'units', focus: 'cpu' }), { type: 'filter-open' }).focus, 'unit');
    assert.equal(reduce(ui({ screen: 'proc', focus: 'cpu' }), { type: 'filter-open' }).focus, 'process');
    assert.equal(reduce(ui({ screen: 'stacks', focus: 'cpu' }), { type: 'filter-open' }).focus, 'stack');

    // on the dashboard there is no screen panel, so focus stays where it was
    assert.equal(reduce(ui({ screen: 'dash', focus: 'memory' }), { type: 'filter-open' }).focus, 'memory');
});


test('the panel fits every width it is given, and stays ascii', () => {
    for (const width of [40, 52, 61, 80, 120]) {
        for (const unicode of [true, false]) {
            const output = draw(
                h(UnitPanel, { width, height: 14, allTypes: true }),
                { columns: width, slow: withUnits(), unicode },
            );

            const where = `width ${width}, unicode ${unicode}: `;

            assertFits(assert, output, width, where);
            assert.equal(lines(output).length, 14, `${where}a panel must be exactly the height it was given`);

            if (!unicode) {
                // eslint-disable-next-line no-control-regex
                assert.ok(!/[^\x00-\x7f]/.test(plain(output)), `${where}ascii mode drew a non-ascii character`);
            }
        }
    }
});


test('the window the panel reports is the number of rows it actually drew', () => {
    const many = Array.from({ length: 40 }, (_, i) => unit(`svc${String(i).padStart(2, '0')}.service`));

    for (const height of [8, 10, 12, 15, 20]) {
        const reports = [];

        const output = plain(draw(
            h(UnitPanel, {
                width: 96,
                height,
                selected: 0,
                scroll: 0,
                onRows: (rowCount, windowRows) => reports.push([rowCount, windowRows]),
            }),
            { columns: 96, slow: withUnits(many) },
        ));

        const drawn = lines(output).filter(line => /\.service/.test(line)).length;

        assert.equal(reports.at(-1)?.[0], 40, `height ${height}: row count`);
        assert.equal(reports.at(-1)?.[1], drawn, `height ${height}: reported window vs rows drawn`);
    }
});
