/**
 * The command a tunnel becomes, and what its exit meant.
 *
 * The first test pins the whole argv with a deepEqual against a literal. That
 * is deliberate rather than lazy: this array is the entire contract between the
 * config file and the machine, and a change to it should have to be typed out
 * here before it ships.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SSH_DEFAULT_OPTIONS,
    buildSshArgs,
    classifyExit,
    describeCommand,
    parseTunnelConfig,
} from '../dist/internal.js';


const tunnel = (over = {}) => {
    const result = parseTunnelConfig(JSON.stringify({
        tunnels: {
            squid: {
                host: '128.199.47.190',
                user: 'root',
                forwards: [
                    { local: '3128:localhost:3128' },
                    { local: '1194:localhost:1194' },
                ],
                ...over,
            },
        },
    }));

    assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));

    return result.config.tunnels[0];
};


test('the squid tunnel produces exactly this argv', () => {
    assert.deepEqual(buildSshArgs(tunnel()), [
        '-N', '-T',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ServerAliveInterval=15',
        '-L', '3128:localhost:3128',
        '-L', '1194:localhost:1194',
        'root@128.199.47.190',
    ]);
});


test('ExitOnForwardFailure is present, and deleting it makes "up" a lie', () => {
    // without it, a local port already in use leaves ssh alive and forwarding
    // nothing - and the supervisor calls "alive after the grace period" up. This
    // one option is what makes that definition honest.
    assert.equal(SSH_DEFAULT_OPTIONS.ExitOnForwardFailure, 'yes');
    assert.ok(buildSshArgs(tunnel()).includes('ExitOnForwardFailure=yes'));
});


test('keepalives are present, and without them reconnection never fires', () => {
    // a half-open connection after a wifi drop keeps the child alive for hours;
    // the supervisor sees a healthy process and the tunnel forwards nowhere
    assert.equal(SSH_DEFAULT_OPTIONS.ServerAliveInterval, '15');
    assert.equal(SSH_DEFAULT_OPTIONS.ServerAliveCountMax, '3');
});


test('BatchMode is present, so a passphrase fails fast instead of hanging', () => {
    // a supervised child has no terminal; a prompt would block forever on stdin
    // that never arrives, and the screen would sit in `starting` until someone
    // gave up
    assert.equal(SSH_DEFAULT_OPTIONS.BatchMode, 'yes');
});


test('a user option replaces the default rather than duplicating it', () => {
    // ssh takes the FIRST occurrence of a -o, so emitting both would leave the
    // user's value as a silent no-op - the failure this merge exists to prevent
    const args = buildSshArgs(tunnel({ options: { ServerAliveInterval: '5' } }));
    const intervals = args.filter(arg => arg.startsWith('ServerAliveInterval='));

    assert.deepEqual(intervals, ['ServerAliveInterval=5']);
});


test('port and identity file are emitted when present, omitted when not', () => {
    const bare = buildSshArgs(tunnel());

    assert.ok(!bare.includes('-p'));
    assert.ok(!bare.includes('-i'));

    const full = buildSshArgs(tunnel({ port: 2222, identityFile: '/keys/id' }));

    assert.deepEqual(full.slice(12, 16), ['-p', '2222', '-i', '/keys/id']);
});


test('a tunnel with no user omits the user@ rather than inventing one', () => {
    const args = buildSshArgs(tunnel({ user: undefined }));

    assert.ok(args.includes('128.199.47.190'));
    assert.ok(!args.some(arg => arg.includes('@')));
});


test('extraArgs land last, after everything generated', () => {
    const args = buildSshArgs(tunnel({ extraArgs: ['-J', 'bastion'] }));

    assert.deepEqual(args.slice(-2), ['-J', 'bastion']);
    assert.equal(args.at(-3), 'root@128.199.47.190');
});


test('remote, dynamic and IPv6 forwards get the right flag and spelling', () => {
    const args = buildSshArgs(tunnel({
        forwards: [
            { remote: '9000:localhost:9000' },
            { dynamic: '1080' },
            { local: { port: 1, host: 'h', hostPort: 2, bind: '::1' } },
        ],
    }));

    // ssh needs an IPv6 bind address bracketed; the config's string form refuses
    // it as ambiguous, so this is where it becomes unambiguous again
    assert.ok(args.includes('-R') && args.includes('9000:localhost:9000'));
    assert.ok(args.includes('-D') && args.includes('1080'));
    assert.ok(args.includes('-L') && args.includes('[::1]:1:h:2'));
});


test('a hostile host name stays one argument', () => {
    // structurally true because spawn is called without `shell`, but the config
    // rejects it anyway and this records that both are deliberate
    const result = parseTunnelConfig(JSON.stringify({
        tunnels: { a: { host: '; rm -rf /', forwards: [{ local: '1:h:2' }] } },
    }));

    assert.equal(result.ok, false);
});


test('describeCommand renders something a person can read back', () => {
    assert.match(describeCommand(tunnel()), /^ssh -N -T .* root@128\.199\.47\.190$/);
});


test('authentication failure is fatal and names the fix', () => {
    const verdict = classifyExit(255, null, 'root@host: Permission denied (publickey).');

    assert.equal(verdict.fatal, true);
    assert.match(verdict.message, /ssh-add/);
});


test('a refused connection is retryable', () => {
    // deliberately adjacent to the test above: these two must never agree, and
    // keeping them side by side is what stops an edit making them
    const verdict = classifyExit(255, null, 'ssh: connect to host x port 22: Connection refused');

    assert.equal(verdict.fatal, false);
});


test('a bad host key is fatal; retrying cannot accept it', () => {
    assert.equal(classifyExit(255, null, 'Host key verification failed.').fatal, true);
});


test('an unresolvable hostname is fatal; it is a typo, not a blip', () => {
    assert.equal(classifyExit(255, null, 'ssh: Could not resolve hostname nope').fatal, true);
});


test('a port already in use is retryable, and says which problem it is', () => {
    // the process holding the port may exit; a laptop that recovers once the
    // old ssh dies is the wanted behaviour
    const verdict = classifyExit(255, null, 'bind: Address already in use');

    assert.equal(verdict.fatal, false);
    assert.match(verdict.message, /already in use/);
});


test('a clean exit is retryable; -N does that when sshd restarts', () => {
    const verdict = classifyExit(0, null, '');

    assert.equal(verdict.fatal, false);
    assert.match(verdict.message, /server closed/);
});


test('an unrecognised failure is retryable and carries the first stderr line', () => {
    // erring toward retry: the cost of retrying something fatal is a slow loop
    // with a visible reason; the cost of giving up on something transient is a
    // tunnel that stays down all night
    const verdict = classifyExit(1, null, '\n  something nobody predicted\nmore detail\n');

    assert.equal(verdict.fatal, false);
    assert.match(verdict.message, /something nobody predicted/);
    assert.ok(!verdict.message.includes('more detail'));
});


test('a signalled exit is reported as such', () => {
    const verdict = classifyExit(null, 'SIGTERM', '');

    assert.equal(verdict.fatal, false);
    assert.match(verdict.message, /SIGTERM/);
});
