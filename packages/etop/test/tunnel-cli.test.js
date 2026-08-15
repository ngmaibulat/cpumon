/**
 * The `etop tunnel` argument router, the status join, and editor resolution.
 *
 * The router's job is to add subcommands without loosening the dashboard's own
 * parser, so the first thing asserted is that the dashboard's contract is
 * exactly what it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EDITOR_FALLBACKS,
    buildTunnelHelp,
    localPorts,
    ownerText,
    parseCli,
    parseCliArgs,
    parseTunnelArgs,
    parseTunnelConfig,
    probeTunnels,
    resolveEditor,
} from '../dist/internal.js';


const tunnels = json => {
    const result = parseTunnelConfig(JSON.stringify(json));

    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));

    return result.config.tunnels;
};


test('no subcommand is still the dashboard, with its options unchanged', () => {
    const cli = parseCli(['--interval', '500']);

    assert.equal(cli.kind, 'tui');
    assert.equal(cli.options.intervalMs, 500);
});


test('the dashboard parser still rejects a stray positional', () => {
    // the router sits above parseCliArgs precisely so this stays true: a typo
    // must not become an unrecognised subcommand or vice versa
    assert.throws(() => parseCliArgs(['wat']), /wat/);
    assert.throws(() => parseCli(['wat']), /wat/);
});


test('tunnel routes to the tunnel parser', () => {
    const cli = parseCli(['tunnel', 'list']);

    assert.equal(cli.kind, 'tunnel');
    assert.equal(cli.command.verb, 'list');
});


test('up takes names, or --all, and refuses neither', () => {
    assert.deepEqual(parseTunnelArgs(['up', 'squid', 'web']), {
        verb: 'up', names: ['squid', 'web'], all: false,
    });

    assert.deepEqual(parseTunnelArgs(['up', '--all']), { verb: 'up', names: [], all: true });

    assert.throws(() => parseTunnelArgs(['up']), /needs a tunnel name, or --all/);
});


test('--config reaches every verb that reads one', () => {
    assert.equal(parseTunnelArgs(['list', '--config', '/x.json']).configPath, '/x.json');
    assert.equal(parseTunnelArgs(['status', '--config', '/x.json']).configPath, '/x.json');
    assert.equal(parseTunnelArgs(['up', 'a', '--config', '/x.json']).configPath, '/x.json');
    assert.equal(parseTunnelArgs(['edit', '--config', '/x.json']).configPath, '/x.json');
});


test('an unknown verb names the ones that exist', () => {
    assert.throws(() => parseTunnelArgs(['frobnicate']), /expected list, status, up, edit, help/);
});


test('a verb that takes no arguments says so rather than ignoring them', () => {
    assert.throws(() => parseTunnelArgs(['list', 'squid']), /takes no arguments/);
});


test('bare `etop tunnel` and --help both ask for help', () => {
    assert.deepEqual(parseTunnelArgs([]), { verb: 'help' });
    assert.deepEqual(parseTunnelArgs(['--help']), { verb: 'help' });
    assert.deepEqual(parseTunnelArgs(['list', '-h']), { verb: 'help' });
});


test('a TUI flag is not silently accepted by the tunnel parser', () => {
    // the two parsers are separate so neither help text can drift into a lie
    assert.throws(() => parseTunnelArgs(['list', '--theme', 'mono']));
});


test('the tunnel help documents every flag it accepts', () => {
    const help = buildTunnelHelp();

    for (const flag of ['--config', '--all', '--json', '--help']) {
        assert.ok(help.includes(flag), `${flag} is missing from the help`);
    }

    for (const verb of ['list', 'status', 'up', 'edit']) {
        assert.ok(help.includes(verb), `${verb} is missing from the help`);
    }
});


test('the help explains why there is no down', () => {
    // the reasoning is the feature: a user who looks for `down` should find out
    // why in the place they looked
    assert.match(buildTunnelHelp(), /no `down`/);
});


test('only forwards that listen on this machine are counted', () => {
    // a remote forward binds on the far end, where this process cannot see it;
    // counting it would mean a working tunnel reported 1/2 for ever
    const [tunnel] = tunnels({
        tunnels: {
            a: {
                host: 'h',
                forwards: [
                    { local: '3128:localhost:3128' },
                    { remote: '9000:localhost:9000' },
                    { dynamic: '1080' },
                ],
            },
        },
    });

    assert.deepEqual(localPorts(tunnel), [3128, 1080]);
});


test('a port with a LISTEN socket is bound, and its owner is reported', () => {
    const list = tunnels({
        tunnels: { squid: { host: 'h', forwards: [{ local: '3128:localhost:3128' }, { local: '1194:localhost:1194' }] } },
    });

    const [probe] = probeTunnels(list, [
        { localPort: 3128, state: 'LISTEN', owner: { kind: 'process', pid: 42, comm: 'ssh' } },
        { localPort: 1194, state: 'ESTABLISHED' },
    ]);

    assert.equal(probe.bound, 1);
    assert.equal(probe.total, 2);
    assert.equal(probe.ports[0].listening, true);
    assert.equal(probe.ports[1].listening, false);
    assert.equal(ownerText(probe.ports[0].owner), 'ssh (42)');
});


test('a port bound on both v4 and v6 counts once', () => {
    const list = tunnels({ tunnels: { a: { host: 'h', forwards: [{ local: '3128:localhost:3128' }] } } });

    const [probe] = probeTunnels(list, [
        { localPort: 3128, state: 'LISTEN', owner: { kind: 'process', pid: 1, comm: 'ssh' } },
        { localPort: 3128, state: 'LISTEN', owner: { kind: 'process', pid: 1, comm: 'ssh' } },
    ]);

    assert.equal(probe.bound, 1);
    assert.equal(probe.total, 1);
});


test('an owner that could not be read says denied, not nothing', () => {
    // on a normal machine most sockets belong to other users; a blank cell would
    // claim nobody holds the port, which is a different and false statement
    assert.equal(ownerText({ kind: 'denied' }), 'denied');
    assert.equal(ownerText(undefined), '-');
    assert.equal(ownerText({ kind: 'none' }), '-');
});


test('VISUAL wins over EDITOR, and both win over the fallbacks', () => {
    assert.deepEqual(
        resolveEditor({ VISUAL: 'hx', EDITOR: 'vim' }),
        { command: 'hx', args: [] },
    );

    assert.deepEqual(resolveEditor({ EDITOR: 'vim' }), { command: 'vim', args: [] });
});


test('an editor with flags keeps them', () => {
    // "code -w" without the wait flag returns at once and the dashboard redraws
    // over the editor that is still opening
    assert.deepEqual(resolveEditor({ EDITOR: 'code -w' }), { command: 'code', args: ['-w'] });
});


test('an empty EDITOR is treated as unset, not as a command named ""', () => {
    const found = resolveEditor(
        { EDITOR: '  ', PATH: '/bin' },
        { exists: path => path === '/bin/vim' },
    );

    assert.deepEqual(found, { command: 'vim', args: [] });
});


test('with nothing configured, a known editor on PATH is used', () => {
    // deliberately not "return null and tell them to set $EDITOR": neither
    // variable is set on a default install, and opening the editor they have is
    // what was actually asked for
    const found = resolveEditor(
        { PATH: '/usr/bin:/bin' },
        { exists: path => path === '/usr/bin/nvim' },
    );

    assert.deepEqual(found, { command: 'nvim', args: [] });
    assert.ok(EDITOR_FALLBACKS.includes('nvim'));
});


test('with nothing configured and nothing installed, there is no editor', () => {
    assert.equal(resolveEditor({ PATH: '/usr/bin' }, { exists: () => false }), null);
});
