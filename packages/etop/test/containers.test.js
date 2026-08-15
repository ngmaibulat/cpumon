import test from 'node:test';
import assert from 'node:assert/strict';

import { ContainerPanel, Ring, dockerIdOf, dockerIndex, pressure } from '../dist/internal.js';

import { assertFits, draw, fakeSlow, h, lines, plain } from './helpers/render.js';
import { fakeStore, snapshot } from './fixtures/snapshots.js';


const container = (over = {}) => ({
    id: 'docker-a1b2c3d4e5f6000000000000000000000000000000000000000000000000000000.scope',
    path: '/system.slice/docker-a1b2c3d4e5f6.scope',
    version: 2,
    runtime: 'docker',
    cpuPercentage: 12.5,
    limits: {
        cpuQuotaUsec: null,
        cpuPeriodUsec: 100000,
        cpuLimitCores: null,
        memoryCurrent: 110 * 1024 ** 2,
        memoryTotal: 120 * 1024 ** 2,
        memoryMax: null,
    },
    cpu: { usageUsec: 0, userUsec: 0, systemUsec: 0, nrPeriods: 0, nrThrottled: 0, throttledUsec: 0 },
    ...over,
});


const withContainers = (containers, scope = 'host') => snapshot({
    containers: { available: true, scope, containers },
});


const render = (props, options = {}) => draw(
    h(ContainerPanel, { width: 60, height: 10, ...props }),
    { columns: 60, ...options },
);


test('memory pressure is measured against the container limit, not the host', () => {
    // a container capped at 256 MiB and using 250 is in trouble on a host with
    // a spare terabyte, and colouring it by the host would say the opposite
    const capped = container({
        limits: { ...container().limits, memoryCurrent: 250 * 1024 ** 2, memoryMax: 256 * 1024 ** 2 },
    });

    assert.ok(pressure(capped) > 0.9);
});


test('an unlimited container is under no pressure by definition', () => {
    assert.equal(pressure(container()), 0);
    assert.equal(pressure(container({ limits: { ...container().limits, memoryMax: 0 } })), 0);
});


test('the table shows a shortened id and the runtime', () => {
    const store = fakeStore(Ring, { snapshot: withContainers([container()]) });
    const output = plain(render({}, { store }));

    assert.match(output, /CONTAINER/);
    // the twelve hex characters every docker command shows, not the full scope
    assert.match(output, /a1b2c3d4e5f6/);
    assert.doesNotMatch(output, /\.scope/);
    assert.match(output, /docker/);
});


test('an unlimited quota reads as unlimited rather than as a missing value', () => {
    const store = fakeStore(Ring, { snapshot: withContainers([container()]) });

    assert.match(plain(render({}, { store })), /∞/);
});


test('a limit is shown when there is one', () => {
    const store = fakeStore(Ring, {
        snapshot: withContainers([container({
            limits: { ...container().limits, memoryMax: 512 * 1024 ** 2, cpuLimitCores: 2 },
        })]),
    });

    const output = plain(render({ width: 80 }, { store }));

    assert.match(output, /512\.0 MiB/);
    assert.match(output, /\s2\s/);
});


test('a container with no cpu figure yet reads as unknown, not as idle', () => {
    // it appeared during the window and has no baseline; 0.0 would be a claim
    const store = fakeStore(Ring, {
        snapshot: withContainers([container({ cpuPercentage: undefined })]),
    });

    assert.match(plain(render({}, { store })), /\s-\s/);
});


test('a namespaced scope is always disclosed', () => {
    // the dashboard is inside a container and can see only its own cgroup, so
    // a short list is a fact about the namespace and not about the machine
    const store = fakeStore(Ring, { snapshot: withContainers([container()], 'namespaced') });
    const output = plain(render({}, { store }));

    assert.match(output, /only this cgroup is visible/);
});


test('a host scope carries no such footnote', () => {
    const store = fakeStore(Ring, { snapshot: withContainers([container()], 'host') });

    assert.doesNotMatch(plain(render({}, { store })), /only this cgroup/);
});


test('an empty list distinguishes an empty host from a keyhole', () => {
    const host = fakeStore(Ring, { snapshot: withContainers([], 'host'), ticks: 9 });
    const inside = fakeStore(Ring, { snapshot: withContainers([], 'namespaced'), ticks: 9 });

    assert.match(plain(render({}, { store: host })), /no container cgroups found/);
    assert.match(plain(render({}, { store: inside })), /only this cgroup is visible/);
});


test('an empty list on the first tick is loading', () => {
    const store = fakeStore(Ring, { snapshot: withContainers([], 'host'), ticks: 1 });

    assert.match(plain(render({}, { store })), /waiting/);
});


test('a platform without cgroups explains itself', () => {
    const store = fakeStore(Ring, {
        snapshot: snapshot({ containers: { available: false, reason: 'not-applicable' } }),
    });

    assert.match(plain(render({}, { store })), /unavailable/);
});


test('the panel fits every size it might be given', () => {
    const many = Array.from({ length: 20 }, (_unused, i) =>
        container({ id: `docker-${String(i).padStart(12, '0')}0000000000000000000000000000000000000000000000000000.scope` }));

    const store = fakeStore(Ring, { snapshot: withContainers(many, 'namespaced') });

    for (const width of [24, 40, 60, 90, 140]) {
        for (const height of [4, 6, 12, 24]) {
            const output = draw(
                h(ContainerPanel, { width, height }),
                { columns: width, store },
            );

            assertFits(assert, output, width, `${width}x${height}: `);
            assert.equal(lines(output).length, height, `${width}x${height} height`);
        }
    }
});


test('a byte figure is never truncated into a different number', () => {
    // "110.5 MiB" arriving as "…0.5 MiB" is not a rounded value, it is a wrong
    // one, and at a glance it is indistinguishable from a correct one
    const store = fakeStore(Ring, {
        snapshot: withContainers([container({
            limits: { ...container().limits, memoryCurrent: 110.5 * 1024 ** 2 },
        })]),
    });

    for (const width of [50, 55, 60, 70, 90]) {
        const output = plain(draw(h(ContainerPanel, { width, height: 8 }), { columns: width, store }));

        assert.doesNotMatch(output, /…[\d.]+ [KMGT]iB/, `width ${width}`);
    }
});


test('nothing outside ascii is drawn when the terminal cannot show it', () => {
    // a character the terminal renders as a replacement box is a shifted
    // column, and a shifted column tears the whole frame rather than one panel
    const store = fakeStore(Ring, { snapshot: withContainers([container()], 'namespaced') });

    const output = plain(draw(
        h(ContainerPanel, { width: 70, height: 10 }),
        { columns: 70, store, unicode: false, graph: 'ascii' },
    ));

    // ink's own truncate-end uses U+2026 and is width-aware, so it is excluded
    const offenders = [...output].filter(c => c.codePointAt(0) > 126 && c !== '…');

    assert.deepEqual(offenders, [], `unexpected: ${JSON.stringify(offenders.join(''))}`);
});


test('an unlimited quota is still legible without the infinity sign', () => {
    const store = fakeStore(Ring, { snapshot: withContainers([container()]) });

    const output = plain(draw(
        h(ContainerPanel, { width: 80, height: 8 }),
        { columns: 80, store, unicode: false, graph: 'ascii' },
    ));

    // "-" would read as "unknown", which is a different claim
    assert.match(output, /none/);
});


test('the container list scrolls and reports its geometry', () => {
    // the same contract the process table has: the panel is the only thing that
    // knows how many rows there are and how many fit, so it tells the reducer
    const many = Array.from({ length: 40 }, (_, i) => container({
        id: `docker-${String(i).padStart(12, '0')}0000000000000000000000000000000000000000000000000000.scope`,
        path: `/system.slice/docker-${i}.scope`,
    }));

    const store = fakeStore(Ring, { snapshot: withContainers(many) });

    const reports = [];
    const onRows = (rowCount, windowRows) => reports.push([rowCount, windowRows]);

    const output = plain(draw(
        h(ContainerPanel, { width: 70, height: 12, scroll: 30, selected: 33, onRows }),
        { columns: 70, store },
    ));

    assert.deepEqual(reports.at(-1), [40, 8], 'twelve rows less border, title and header');

    // scrolled past the first thirty, so row 0 is off screen and row 30 is on
    assert.doesNotMatch(output, /000000000000/, 'the first container should have scrolled off');
    assert.match(output, /000000000030/);
});


test('the container list draws no cursor when nothing selected it', () => {
    // on the dashboard the panel is one tile among six and has no cursor of its
    // own; the highlight belongs to the screen that gave it one
    const store = fakeStore(Ring, { snapshot: withContainers([container()]) });

    const output = draw(h(ContainerPanel, { width: 60, height: 8 }), { columns: 60, store });
    const body = lines(output).slice(2).join('\n');

    assert.doesNotMatch(body, /\[7m/, 'no row may be inverted without a selection');
});


test('the window the panel reports is the number of rows it actually drew', () => {
    // this is the join between the reducer and the screen. If the report is one
    // too many, `G` puts the cursor on a row below the last visible one and the
    // list looks stuck; one too few and the last row is unreachable.
    const many = Array.from({ length: 40 }, (_, i) => container({
        id: `docker-${String(i).padStart(12, 'a')}0000000000000000000000000000000000000000000000000000.scope`,
        path: `/system.slice/docker-${i}.scope`,
    }));

    const store = fakeStore(Ring, { snapshot: withContainers(many) });

    for (const height of [8, 10, 12, 15, 20]) {
        const reports = [];

        const output = plain(draw(
            h(ContainerPanel, {
                width: 70,
                height,
                scroll: 0,
                selected: 0,
                onRows: (rowCount, windowRows) => reports.push([rowCount, windowRows]),
            }),
            { columns: 70, store },
        ));

        const drawn = lines(output).filter(line => /docker-?a/.test(line) || /\bdocker\b/.test(line)).length;

        assert.deepEqual(reports.at(-1)?.[0], 40, `height ${height}: row count`);
        assert.equal(reports.at(-1)?.[1], drawn, `height ${height}: reported window vs rows drawn`);
    }
});


const HEX = 'a1b2c3d4e5f6' + '0'.repeat(52);


test('a docker cgroup name carries the engine id; anything else carries none', () => {
    assert.equal(dockerIdOf(`docker-${HEX}.scope`), HEX);

    // an lxc payload, a podman scope and a bare cgroup have no docker id in
    // them, and a guess here would attach the wrong name to a row
    assert.equal(dockerIdOf('lxc.payload.super-hound'), null);
    assert.equal(dockerIdOf(`libpod-${HEX}.scope`), null);
    assert.equal(dockerIdOf('user.slice'), null);
    assert.equal(dockerIdOf(`docker-${HEX}`), null, 'the .scope suffix is part of the shape');
});


test('the join replaces the hex id with the name docker knows', () => {
    const dockerContainer = { id: HEX, name: 'default-lab-nginx-1', image: 'nginx:alpine' };

    const output = plain(draw(
        h(ContainerPanel, { width: 90, height: 8 }),
        {
            columns: 90,
            store: fakeStore(Ring, { snapshot: withContainers([container({ id: `docker-${HEX}.scope` })]) }),
            slow: fakeSlow({ docker: { available: true, containers: [dockerContainer] } }),
        },
    ));

    assert.match(output, /default-lab-nginx-1/);
    assert.match(output, /nginx:alpine/);
    assert.doesNotMatch(output, /a1b2c3d4e5f6/, 'the short id gives way to the name');
});


test('a container docker does not know keeps its short id rather than going blank', () => {
    // lxc, podman, or docker simply not running: a blank cell would read as
    // "this container has no name"
    const output = plain(draw(
        h(ContainerPanel, { width: 90, height: 8 }),
        {
            columns: 90,
            store: fakeStore(Ring, { snapshot: withContainers([container({ id: 'lxc.payload.super-hound', runtime: 'lxc' })]) }),
            slow: fakeSlow({ docker: { available: true, containers: [] } }),
        },
    ));

    assert.match(output, /lxc\.payload\.super-hound|super-hound/);
    assert.match(output, /lxc/);
});


test('with no slow poller at all the panel is exactly what it was before the join', () => {
    // every panel test above this line renders without a provider, and that has
    // to keep meaning "show the short id"
    const output = plain(draw(
        h(ContainerPanel, { width: 90, height: 8 }),
        { columns: 90, store: fakeStore(Ring, { snapshot: withContainers([container({ id: `docker-${HEX}.scope` })]) }) },
    ));

    assert.match(output, /a1b2c3d4e5f6/);
});


test('dockerIndex keys on the full id, which is what the cgroup name holds', () => {
    const index = dockerIndex([{ id: HEX, name: 'x' }, { id: 'b'.repeat(64), name: 'y' }]);

    assert.equal(index.size, 2);
    assert.equal(index.get(HEX).name, 'x');
    assert.equal(index.get('nope'), undefined);
});
