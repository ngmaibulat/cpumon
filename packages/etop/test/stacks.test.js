import test from 'node:test';
import assert from 'node:assert/strict';

import { StackPanel, buildStackRows, initialUi, reduce, shortPath, stackRow } from '../dist/internal.js';

import { assertFits, draw, fakeSlow, h, lines, plain } from './helpers/render.js';


const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), ...over });

const GLYPHS = { pointer: '>', down: 'v', ellipsis: '~', separator: '|' };


const service = (project, name, state = 'running', over = {}) => ({
    id: `${name}`.padEnd(64, '0'),
    name: `${project}-${name}-1`,
    image: `${name}:latest`,
    command: 'sh',
    createdAt: 1786700000,
    state,
    status: state === 'running' ? 'Up 3 days' : 'Exited (0) 2 hours ago',
    ports: [],
    labels: {},
    compose: { project, service: name, containerNumber: 1, oneoff: false, ...over },
});


const stack = (project, services, over = {}) => ({
    project,
    workingDir: `/home/admin/projects/${project}`,
    configFiles: [],
    services,
    running: services.filter(s => !s.compose.oneoff && s.state === 'running').length,
    total: services.filter(s => !s.compose.oneoff).length,
    ...over,
});


const STACKS = [
    stack('default-lab', [service('default-lab', 'nginx'), service('default-lab', 'postgres', 'exited')]),
    stack('mailgw', [service('mailgw', 'webui')], { workingDir: undefined }),
];


/** the panel reads docker straight off the slow poller */
const withDocker = (containers) => fakeSlow({
    docker: { available: true, containers },
});

const CONTAINERS = STACKS.flatMap(s => s.services);


const render = (props = {}, options = {}) => draw(
    h(StackPanel, { width: 90, height: 12, ...props }),
    { columns: 90, slow: withDocker(CONTAINERS), ...options },
);


test('a project row is followed by its services, indented', () => {
    const rows = buildStackRows(STACKS);

    assert.deepEqual(rows.map(row => row.kind), [
        'project', 'service', 'service',
        'project', 'service',
    ]);

    const [project, first] = rows;

    assert.equal(stackRow(project, GLYPHS)[0], 'v default-lab');
    assert.equal(stackRow(first, GLYPHS)[0], '  nginx', 'a service is indented under its project');
});


test('a project row carries the counts and the folder; a service row carries neither', () => {
    const [project, first] = buildStackRows(STACKS);

    const [, state, folder, status] = stackRow(project, GLYPHS);

    assert.equal(state, '1/2 up');
    assert.match(folder, /default-lab$/);
    assert.equal(status, '', 'a project has no status of its own to state');

    const [, serviceState, image, serviceStatus] = stackRow(first, GLYPHS);

    assert.equal(serviceState, 'running');
    assert.equal(image, 'nginx:latest');
    assert.match(serviceStatus, /^Up /);
});


test('collapsing a project hides its services and keeps its counts', () => {
    const collapsed = { 'default-lab': true };
    const rows = buildStackRows(STACKS, collapsed);

    assert.deepEqual(rows.map(row => row.kind), ['project', 'project', 'service']);

    const [folded] = rows;

    assert.equal(stackRow(folded, GLYPHS, collapsed)[0], '> default-lab', 'the marker says which way it folds');
    assert.equal(stackRow(folded, GLYPHS, collapsed)[1], '1/2 up', 'a folded project still reports what is down');
});


test('a stack with no folder says so rather than showing a blank', () => {
    const [, , , mailgw] = buildStackRows(STACKS);

    assert.equal(mailgw.kind, 'project');
    assert.equal(stackRow(mailgw, GLYPHS)[2], '-');
});


test('a one-off container is marked rather than passed off as a service', () => {
    const runner = service('default-lab', 'postgres', 'running', { oneoff: true });
    const rows = buildStackRows([stack('default-lab', [service('default-lab', 'nginx'), runner])]);

    const marked = rows.map(row => stackRow(row, GLYPHS)[0]).find(name => name.includes('postgres'));

    assert.equal(marked, '  postgres (run)');
});


test('a folder keeps its tail, which is the part that identifies it', () => {
    // truncating the other end gives a column of "/home/admin/Downloads/2026~"
    // that reads identically for every stack on the machine
    const long = '/home/admin/Downloads/2026-06-26/siem-tracker/containers/default';

    assert.equal(shortPath(long, '~'), '~/siem-tracker/containers/default');

    // short enough to show whole is shown whole, with no misleading ellipsis
    assert.equal(shortPath('/srv/app', '~'), '/srv/app');
    assert.equal(shortPath('/a/b/c', '~'), '/a/b/c');
});


test('Enter folds the project the panel reported, and folds it back', () => {
    let state = ui({ screen: 'stacks' });

    state = reduce(state, { type: 'toggle-collapse', project: 'default-lab' });
    assert.deepEqual(state.collapsed, { 'default-lab': true });

    state = reduce(state, { type: 'toggle-collapse', project: 'default-lab' });
    assert.deepEqual(state.collapsed, {}, 'folding is a toggle, not a one-way door');
});


test('Enter on no project at all does nothing', () => {
    // the panel reports '' when the cursor is on no row it owns; folding that
    // would put a phantom key in the map and leak it into every later render
    const state = ui({ screen: 'stacks' });

    assert.equal(reduce(state, { type: 'toggle-collapse', project: '' }), state);
});


test('the screen draws its projects and services', () => {
    const output = plain(render());

    assert.match(output, /default-lab/);
    assert.match(output, /nginx/);
    assert.match(output, /mailgw/);
    assert.match(output, /1\/2 up/);
    assert.match(output, /2 projects/);
});


test('the screen hides the services of a folded project', () => {
    const open = plain(render({ collapsed: {} }));
    const folded = plain(render({ collapsed: { 'default-lab': true } }));

    assert.match(open, /nginx/);
    assert.doesNotMatch(folded, /nginx/, 'a folded project shows none of its services');
    assert.match(folded, /default-lab/, 'but the project itself stays');
    assert.match(folded, /webui/, 'and the other project is untouched');
});


test('no docker at all is explained rather than drawn empty', () => {
    const output = plain(draw(
        h(StackPanel, { width: 90, height: 12 }),
        {
            columns: 90,
            slow: fakeSlow({ docker: { available: false, reason: 'permission-denied', detail: '/var/run/docker.sock' } }),
        },
    ));

    assert.match(output, /not readable/i);
    assert.match(output, /docker\.sock/);
});


test('containers with no compose labels are named as such, not shown as empty', () => {
    const loose = { ...service('x', 'redis'), compose: undefined };

    const output = plain(draw(
        h(StackPanel, { width: 90, height: 12 }),
        { columns: 90, slow: fakeSlow({ docker: { available: true, containers: [loose] } }) },
    ));

    assert.match(output, /started by hand/);
});


test('the panel fits every width it is given, and stays ascii', () => {
    for (const width of [40, 52, 61, 80, 120]) {
        for (const unicode of [true, false]) {
            const output = draw(
                h(StackPanel, { width, height: 12 }),
                { columns: width, slow: withDocker(CONTAINERS), unicode },
            );

            const where = `width ${width}, unicode ${unicode}: `;

            assertFits(assert, output, width, where);
            assert.equal(lines(output).length, 12, `${where}a panel must be exactly the height it was given`);

            if (!unicode) {
                // eslint-disable-next-line no-control-regex
                assert.ok(!/[^\x00-\x7f]/.test(plain(output)), `${where}ascii mode drew a non-ascii character`);
            }
        }
    }
});


test('the window the panel reports is the number of rows it actually drew', () => {
    const many = Array.from({ length: 12 }, (_, i) => service('big', `svc${String(i).padStart(2, '0')}`));
    const containers = [...CONTAINERS, ...many];

    for (const height of [8, 10, 12, 15, 20]) {
        const reports = [];

        const output = plain(draw(
            h(StackPanel, {
                width: 90,
                height,
                selected: 0,
                scroll: 0,
                onRows: (rowCount, windowRows) => reports.push([rowCount, windowRows]),
            }),
            { columns: 90, slow: withDocker(containers) },
        ));

        // every drawn row is either a project ("1/2 up") or a service, which
        // carries its state. Matching on content rather than on the fold marker
        // keeps this independent of which glyph set is in force.
        const drawn = lines(output).filter(line => /\b(up|running|exited)\b/.test(line)).length;

        assert.equal(reports.at(-1)?.[1], drawn, `height ${height}: reported window vs rows drawn`);
    }
});


test('the panel reports which project the cursor is on, including from a service row', () => {
    const seen = [];

    const at = (selected) => {
        seen.length = 0;

        draw(
            h(StackPanel, { width: 90, height: 12, selected, onProject: (p) => seen.push(p) }),
            { columns: 90, slow: withDocker(CONTAINERS) },
        );

        return seen.at(-1);
    };

    // rows: 0 default-lab, 1 nginx, 2 postgres, 3 mailgw, 4 webui
    assert.equal(at(0), 'default-lab');
    assert.equal(at(2), 'default-lab', 'Enter on a service folds the project it belongs to');
    assert.equal(at(3), 'mailgw');
    assert.equal(at(99), null, 'a cursor past the end owns no project');
});
