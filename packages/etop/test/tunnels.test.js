/**
 * The tunnels screen: its rows, its colours, and its keys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_THEME,
    PANEL_BINDINGS,
    Ring,
    TUNNEL_BINDINGS,
    TunnelPanel,
    initialUi,
    parseTunnelConfig,
    reduce,
    resolve,
    stateColor,
    targetOf,
    tunnelRow,
} from '../dist/internal.js';

import { assertFits, draw, fakeTunnels, h, lines, plain } from './helpers/render.js';
import { fakeStore, snapshot } from './fixtures/snapshots.js';


const tunnelOf = (over = {}) => {
    const result = parseTunnelConfig(JSON.stringify({
        tunnels: {
            squid: {
                host: '128.199.47.190',
                user: 'root',
                forwards: [{ local: '3128:localhost:3128' }, { local: '1194:localhost:1194' }],
                ...over,
            },
        },
    }));

    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));

    return result.config.tunnels[0];
};


const statusOf = (over = {}) => ({
    tunnel: tunnelOf(),
    phase: 'up',
    pid: 42,
    message: 'connected',
    attempt: 0,
    retryAt: null,
    upSince: 0,
    output: [],
    ...over,
});


const probeOf = (bound = 2, total = 2) => ({
    name: 'squid',
    bound,
    total,
    ports: [{ port: 3128, listening: bound > 0 }, { port: 1194, listening: bound > 1 }],
});


/**
 * The panel joins against the socket table the store already samples, so a
 * store is required the way ConnectionPanel's is. The fixture decides what is
 * listening; otherwise these assertions would be about the runner's own ports.
 */
const listening = (ports = []) => fakeStore(Ring, {
    snapshot: snapshot({
        connections: {
            available: true,
            connections: ports.map((port, i) => ({
                protocol: 'tcp',
                localAddress: '127.0.0.1',
                localPort: port,
                remoteAddress: '0.0.0.0',
                remotePort: 0,
                state: 'LISTEN',
                uid: 1000,
                inode: 4242 + i,
                txQueue: 0,
                rxQueue: 0,
                owner: { kind: 'process', pid: 42, comm: 'ssh' },
            })),
        },
    }),
});


const panel = (options = {}) => draw(
    h(TunnelPanel, { width: options.columns ?? 80, height: 12, focused: true, ...options.props }),
    {
        columns: options.columns ?? 80,
        tunnels: fakeTunnels(options.state),
        store: options.store ?? listening(options.ports ?? [3128, 1194]),
        ...options,
    },
);


test('a row carries the name, the state, the binding count and the target', () => {
    assert.deepEqual(tunnelRow(statusOf(), probeOf()), [
        'squid', 'up', '2/2', 'root@128.199.47.190', '3128,1194', 'connected',
    ]);
});


test('a tunnel with nothing listening here shows a dash, not 0/0', () => {
    // a remote forward binds on the far end; counting it would mean a working
    // tunnel reported 0/0 for ever
    const row = tunnelRow(statusOf(), { name: 'squid', bound: 0, total: 0, ports: [] });

    assert.equal(row[2], '-');
    assert.equal(row[4], '-');
});


test('targetOf spells the ssh destination the way ssh does', () => {
    assert.equal(targetOf(statusOf()), 'root@128.199.47.190');
    assert.equal(targetOf({ tunnel: tunnelOf({ user: undefined }) }), '128.199.47.190');
    assert.equal(targetOf({ tunnel: tunnelOf({ port: 2222 }) }), 'root@128.199.47.190:2222');
});


test('a failed tunnel is drawn as danger, a backoff as a warning', () => {
    assert.equal(stateColor(statusOf({ phase: 'failed' }), probeOf(), DEFAULT_THEME), DEFAULT_THEME.danger);
    assert.equal(stateColor(statusOf({ phase: 'backoff' }), probeOf(), DEFAULT_THEME), DEFAULT_THEME.warn);
});


test('up with all its ports bound is ok; up with a port missing is not', () => {
    // the case this screen exists to make visible: ssh is alive, and nothing is
    // listening. A single merged "up" column would hide it behind a green word.
    assert.equal(stateColor(statusOf(), probeOf(2, 2), DEFAULT_THEME), DEFAULT_THEME.ok);
    assert.equal(stateColor(statusOf(), probeOf(1, 2), DEFAULT_THEME), DEFAULT_THEME.warn);
});


test('a stopped tunnel is muted, so dead and running do not look alike', () => {
    assert.equal(stateColor(statusOf({ phase: 'stopped' }), probeOf(), DEFAULT_THEME), DEFAULT_THEME.muted);
    assert.equal(stateColor(statusOf({ phase: 'idle' }), probeOf(), DEFAULT_THEME), DEFAULT_THEME.muted);
});


test('the panel fits its width at every size it must survive', () => {
    for (const columns of [40, 52, 80, 120]) {
        const output = panel({ columns, state: { statuses: [statusOf()] } });

        assertFits(assert, output, columns, `at ${columns} columns`);
    }
});


test('the panel draws the tunnel and its state', () => {
    const output = plain(panel({ state: { statuses: [statusOf()] } }));

    assert.match(output, /TUNNELS/);
    assert.match(output, /squid/);
    assert.match(output, /root@128\.199\.47\.190/);
});


test('a missing config says how to make one rather than reporting a failure', () => {
    // nobody has written one yet; that is not an error and must not read as one
    const output = plain(panel({
        state: { config: { available: false, reason: 'not-found', detail: '/x/tunnels.json' } },
    }));

    assert.match(output, /no tunnel config yet/);
    assert.match(output, /press e/);
    assert.ok(!output.includes('unavailable'), 'a missing config is not an unavailable probe');
});


test('a broken config shows the parse errors instead of an empty table', () => {
    const output = plain(panel({
        state: {
            config: {
                available: false,
                reason: 'parse-error',
                detail: 'tunnels.squid.host: required\ntunnels.squid.forwards: needs at least one forward',
            },
        },
    }));

    assert.match(output, /unavailable/);
    assert.match(output, /tunnels\.squid\.host: required/);
});


test('rendering a broken config does not throw', () => {
    // a dashboard must not die of a trailing comma
    assert.doesNotThrow(() => panel({
        state: { config: { available: false, reason: 'parse-error', detail: 'nope' } },
    }));
});


test('the detail row shows the ssh output, and says so when there is none', () => {
    const quiet = plain(panel({
        state: { statuses: [statusOf()] },
        props: { detail: 'squid' },
    }));

    // `ssh -N` is silent while it works, so an empty box would read as broken
    assert.match(quiet, /ssh is quiet while it works/);

    const noisy = plain(panel({
        state: { statuses: [statusOf({ output: ['bind: Address already in use'] })] },
        props: { detail: 'squid' },
    }));

    assert.match(noisy, /Address already in use/);
});


test('the detail row takes rows from the table rather than adding them', () => {
    // a panel that grows when you press a key moves the row out from under the
    // cursor
    const closed = lines(panel({ state: { statuses: [statusOf()] } })).length;
    const open = lines(panel({ state: { statuses: [statusOf()] }, props: { detail: 'squid' } })).length;

    assert.equal(open, closed);
});


test('the subtitle counts what is up and what is bound', () => {
    const output = plain(panel({
        state: { statuses: [statusOf(), statusOf({ phase: 'failed' })] },
    }));

    assert.match(output, /1\/2 up/);
    assert.match(output, /failed/);
});


test('the panel renders with no tunnel provider at all', () => {
    // a missing supervisor looks the same as one with nothing configured, which
    // is what keeps every panel test that does not care about tunnels unchanged
    assert.doesNotThrow(() => draw(
        h(TunnelPanel, { width: 80, height: 12 }),
        { columns: 80, store: listening() },
    ));
});


test('BOUND reports what /proc says, not what the supervisor believes', () => {
    // ssh alive with nothing listening is a real failure and the two columns
    // are what make it visible
    const output = plain(panel({ state: { statuses: [statusOf()] }, ports: [3128] }));
    const row = lines(output).find(line => line.includes('squid'));

    assert.match(row, /1\/2/);
});


// --- keys ---

const ui = (over = {}) => ({ ...initialUi(1000, 'auto', 'auto'), screen: 'tunnels', ...over });

const key = (over = {}) => ({
    ctrl: false, shift: false, meta: false, escape: false, return: false, tab: false,
    backspace: false, delete: false, upArrow: false, downArrow: false, leftArrow: false,
    rightArrow: false, pageUp: false, pageDown: false, f1: false, home: false, end: false,
    ...over,
});


test('the tunnel keys resolve on the tunnels screen', () => {
    assert.deepEqual(resolve('e', key(), ui()), { type: 'tunnel-edit' });
    assert.deepEqual(resolve('x', key(), ui()), { type: 'tunnel-stop', name: '' });
    assert.deepEqual(resolve('R', key(), ui()), { type: 'tunnel-restart', name: '' });
    assert.deepEqual(resolve('l', key(), ui()), { type: 'tunnel-detail', name: '' });
    assert.deepEqual(resolve('', key({ return: true }), ui()), { type: 'tunnel-toggle', name: '' });
});


test('they do not fire on any other screen', () => {
    // `e` and `x` are unbound elsewhere, so they must fall through to nothing
    // rather than acting on a tunnel the user cannot see
    assert.equal(resolve('e', key(), ui({ screen: 'dash', focus: 'cpu' })), null);
    assert.equal(resolve('x', key(), ui({ screen: 'conn' })), null);

    // R is the process table's reverse-sort, and must stay that way
    assert.deepEqual(resolve('R', key(), ui({ screen: 'proc' })), { type: 'sort-reverse' });
});


test('the cursor keys still work here, and the globals still win', () => {
    assert.deepEqual(resolve('j', key(), ui()), { type: 'move', delta: 1 });
    assert.deepEqual(resolve('G', key(), ui()), { type: 'move-to', where: 'last' });
    assert.deepEqual(resolve('q', key(), ui()), { type: 'quit' });
    assert.deepEqual(resolve('t', key(), ui()), { type: 'cycle-theme' });
});


test('a ctrl chord is not swallowed by a bare-character binding', () => {
    // every matcher goes through plain(); without it Ctrl-E, Ctrl-X and Ctrl-L
    // would be claimed by this panel before the globals ever saw them
    for (const input of ['e', 'x', 'l', 'r']) {
        const action = resolve(input, key({ ctrl: true }), ui());

        assert.ok(
            action === null || action.type === 'quit' || action.type === 'cycle-graph' || action.type === 'move',
            `Ctrl-${input} resolved to ${JSON.stringify(action)}`,
        );
    }
});


test('every tunnel binding is reachable through PANEL_BINDINGS', () => {
    // STACK_BINDINGS was once declared and never spread in, and worked nowhere
    // for a whole release
    for (const binding of TUNNEL_BINDINGS) {
        assert.ok(PANEL_BINDINGS.includes(binding), `${binding.keys} is not in PANEL_BINDINGS`);
    }
});


test('the detail toggles by name, and ignores an empty one', () => {
    const opened = reduce(ui(), { type: 'tunnel-detail', name: 'squid' });

    assert.equal(opened.tunnelDetail, 'squid');
    assert.equal(reduce(opened, { type: 'tunnel-detail', name: 'squid' }).tunnelDetail, null);
    assert.equal(reduce(opened, { type: 'tunnel-detail', name: 'web' }).tunnelDetail, 'web');

    // the placeholder the binding emits when no row is selected
    assert.equal(reduce(opened, { type: 'tunnel-detail', name: '' }), opened);
});


test('the supervisor commands leave the view alone', () => {
    // they are effects, performed by App against the supervisor; the reducer
    // waves them through so the exhaustiveness check still covers the union
    const before = ui();

    for (const type of ['tunnel-toggle', 'tunnel-stop', 'tunnel-restart', 'tunnel-edit']) {
        assert.equal(reduce(before, { type, name: 'squid' }), before, type);
    }
});


test('leaving the screen closes the detail it was showing', () => {
    const open = reduce(ui(), { type: 'tunnel-detail', name: 'squid' });
    const gone = reduce(open, { type: 'screen', screen: 'dash' });

    assert.equal(gone.tunnelDetail, null);
});
