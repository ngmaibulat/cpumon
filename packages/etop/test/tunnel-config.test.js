/**
 * The tunnel config parser.
 *
 * The fixture at the top is the user's real shell alias, transcribed. If this
 * file's first test passes, the feature has done the thing it was asked to do;
 * everything below it is about failing usefully.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CONFIG_VERSION,
    TUNNEL_TEMPLATE,
    parseTunnelConfig,
    tunnelConfigPath,
} from '../dist/internal.js';


/** squid='ssh -L 3128:localhost:3128 -L 1194:localhost:1194 root@128.199.47.190' */
const SQUID = JSON.stringify({
    version: 1,
    tunnels: {
        squid: {
            host: '128.199.47.190',
            user: 'root',
            autostart: true,
            forwards: [
                { local: '3128:localhost:3128' },
                { local: '1194:localhost:1194' },
            ],
        },
    },
});


const ok = text => {
    const result = parseTunnelConfig(text);

    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));

    return result.config;
};


const errors = text => {
    const result = parseTunnelConfig(text);

    assert.equal(result.ok, false, 'expected this config to be rejected');

    return result.errors;
};


test('the alias this feature replaces parses to the tunnel it describes', () => {
    const config = ok(SQUID);

    assert.equal(config.version, CONFIG_VERSION);
    assert.equal(config.tunnels.length, 1);

    assert.deepEqual(config.tunnels[0], {
        name: 'squid',
        host: '128.199.47.190',
        user: 'root',
        autostart: true,
        options: {},
        extraArgs: [],
        forwards: [
            { kind: 'local', port: 3128, host: 'localhost', hostPort: 3128 },
            { kind: 'local', port: 1194, host: 'localhost', hostPort: 1194 },
        ],
    });
});


test('the template etop writes for a first-time user parses', () => {
    // a template the parser refuses to read is the worst possible first
    // impression, and the "//" documentation key is the reason this can break
    const config = ok(TUNNEL_TEMPLATE);

    assert.equal(config.tunnels.length, 1);
    assert.equal(config.tunnels[0].name, 'example');
});


test('a four-part local forward sets the bind address', () => {
    const config = ok(JSON.stringify({
        tunnels: { a: { host: 'h', forwards: [{ local: '127.0.0.1:8080:localhost:80' }] } },
    }));

    assert.deepEqual(config.tunnels[0].forwards[0], {
        kind: 'local', bind: '127.0.0.1', port: 8080, host: 'localhost', hostPort: 80,
    });
});


test('remote and dynamic forwards are accepted in both shapes', () => {
    const config = ok(JSON.stringify({
        tunnels: {
            a: {
                host: 'h',
                forwards: [
                    { remote: '9000:localhost:9000' },
                    { dynamic: '1080' },
                    { dynamic: '127.0.0.1:1081' },
                    { local: { port: 1, host: 'h2', hostPort: 2, bind: '::1' } },
                ],
            },
        },
    }));

    assert.deepEqual(config.tunnels[0].forwards, [
        { kind: 'remote', port: 9000, host: 'localhost', hostPort: 9000 },
        { kind: 'dynamic', port: 1080 },
        { kind: 'dynamic', bind: '127.0.0.1', port: 1081 },
        { kind: 'local', bind: '::1', port: 1, host: 'h2', hostPort: 2 },
    ]);
});


test('a hostname with a hyphen in it is not a whitespace violation', () => {
    // the first draft of the word check used a character class whose trailing
    // dash was a literal, so every real-world hostname was rejected
    const config = ok(JSON.stringify({
        tunnels: { a: { host: 'build-server-01.eu-west.example.com', forwards: [{ local: '1:h:2' }] } },
    }));

    assert.equal(config.tunnels[0].host, 'build-server-01.eu-west.example.com');
});


test('malformed JSON is reported, not thrown', () => {
    // a throw here reaches the render tree; a dashboard must not die of a
    // trailing comma
    assert.doesNotThrow(() => parseTunnelConfig('{ "tunnels": }'));

    const [message] = errors('{ "tunnels": }');

    assert.match(message, /not valid JSON/);
});


test('every problem is reported, not just the first', () => {
    const found = errors(JSON.stringify({
        tunnels: {
            a: { forwards: [] },
            b: { host: 'h', port: 70000, forwards: [{ local: 'nope' }] },
        },
    }));

    assert.ok(found.length >= 4, `expected four or more errors, got ${found.length}: ${found.join('; ')}`);
    assert.ok(found.some(e => /tunnels\.a\.host: required/.test(e)), found.join('; '));
    assert.ok(found.some(e => /tunnels\.a\.forwards: needs at least one/.test(e)), found.join('; '));
    assert.ok(found.some(e => /tunnels\.b\.port: 70000 is not a port/.test(e)), found.join('; '));
    assert.ok(found.some(e => /tunnels\.b\.forwards\[0\]\.local/.test(e)), found.join('; '));
});


test('an error names the tunnel and the field that caused it', () => {
    const [message] = errors(JSON.stringify({ tunnels: { squid: { forwards: [{ local: '1:h:2' }] } } }));

    assert.equal(message, 'tunnels.squid.host: required');
});


test('a forward naming two kinds is refused rather than guessed at', () => {
    const found = errors(JSON.stringify({
        tunnels: { a: { host: 'h', forwards: [{ local: '1:h:2', remote: '3:h:4' }] } },
    }));

    assert.match(found[0], /names local and remote/);
});


test('a forward naming no kind says which three are allowed', () => {
    const found = errors(JSON.stringify({ tunnels: { a: { host: 'h', forwards: [{}] } } }));

    assert.match(found[0], /local, remote or dynamic/);
});


test('an unbracketed IPv6 bind address names the object form as the fix', () => {
    const found = errors(JSON.stringify({
        tunnels: { a: { host: 'h', forwards: [{ local: '::1:8080:localhost:80' }] } },
    }));

    assert.match(found[0], /too many colons/);
    assert.match(found[0], /object form/);
});


test('a typo in a setting name is an error, not a silent no-op', () => {
    // `autostrat: true` that quietly does nothing is worse than a refusal
    const found = errors(JSON.stringify({
        tunnels: { a: { host: 'h', autostrat: true, forwards: [{ local: '1:h:2' }] } },
    }));

    assert.match(found[0], /tunnels\.a\.autostrat: not a known setting/);
});


test('a config newer than this etop is refused rather than half-read', () => {
    const found = errors(JSON.stringify({ version: 2, tunnels: {} }));

    assert.match(found[0], /newer than the 1 this etop understands/);
});


test('tunnels declared as an array is rejected; the names would be lost', () => {
    const found = errors(JSON.stringify({ tunnels: [{ host: 'h' }] }));

    assert.match(found[0], /object keyed by tunnel name/);
});


test('a value with whitespace in it is rejected', () => {
    const found = errors(JSON.stringify({
        tunnels: { a: { host: 'a host', forwards: [{ local: '1:h:2' }] } },
    }));

    assert.match(found[0], /contains whitespace/);
});


test('options are collected and coerced to strings', () => {
    const config = ok(JSON.stringify({
        tunnels: {
            a: { host: 'h', forwards: [{ local: '1:h:2' }], options: { ServerAliveInterval: 30 } },
        },
    }));

    assert.deepEqual(config.tunnels[0].options, { ServerAliveInterval: '30' });
});


test('the config path follows XDG, and takes its environment as an argument', () => {
    assert.equal(
        tunnelConfigPath({ XDG_CONFIG_HOME: '/xdg', HOME: '/home/who' }),
        '/xdg/etop/tunnels.json',
    );

    assert.equal(
        tunnelConfigPath({ HOME: '/home/who' }),
        '/home/who/.config/etop/tunnels.json',
    );

    // the basedir spec says to ignore a relative XDG_CONFIG_HOME rather than
    // resolve it against a cwd that has nothing to do with the user's config
    assert.equal(
        tunnelConfigPath({ XDG_CONFIG_HOME: 'relative', HOME: '/home/who' }),
        '/home/who/.config/etop/tunnels.json',
    );
});
