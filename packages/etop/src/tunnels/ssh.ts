/**
 * What actually gets executed, and what it meant when it stopped.
 *
 * Both halves are pure. `buildSshArgs` is the whole of the decision about how a
 * tunnel is run - the supervisor calls it and hands the result to spawn without
 * adding anything - which is what makes "what command did that produce" a unit
 * test rather than an strace. The same reasoning as `state/signals.ts`: the
 * dangerous call is one line at the bottom of something whose inputs were all
 * decided somewhere testable.
 *
 * Nothing here is passed through a shell. spawn() is called without `shell`, so
 * every element of this array is one argument no matter what is in it.
 */

import type { Forward, Tunnel } from './config.js';


/**
 * The options every tunnel gets unless it says otherwise.
 *
 * Each one is load-bearing and none is decoration:
 *
 * `ExitOnForwardFailure` is the one to not delete. Without it, a local port
 * that is already in use produces a warning on stderr and a live, useless ssh
 * connection that forwards nothing - and since the supervisor decides a tunnel
 * is up by "still alive after the grace period", it would report green over a
 * tunnel carrying no traffic. This option is what makes that definition honest.
 *
 * `ServerAliveInterval`/`CountMax` are what make reconnection actually happen.
 * On a wifi drop or a NAT timeout the TCP connection goes half-open: without
 * keepalives the child stays alive for hours, the supervisor sees a healthy
 * process, and the tunnel forwards into a black hole. 15x3 notices in ~45s.
 *
 * `BatchMode` is the answer to the interactive-passphrase problem. A supervised
 * child has no terminal, so a key needing a passphrase would block forever on a
 * stdin that will never arrive and the screen would sit in `starting` until
 * someone gave up. With this, it fails in milliseconds with `Permission denied`
 * and classifyExit turns that into "add the key to your agent". The cost - a
 * passphrase-protected key with no agent simply does not work - is the right
 * trade for something unattended, and `options` can override it.
 *
 * `ConnectTimeout` bounds a `starting` that would otherwise sit through the
 * kernel's whole SYN retry schedule.
 */
export const DEFAULT_OPTIONS: Record<string, string> = {
    ExitOnForwardFailure: 'yes',
    ServerAliveInterval: '15',
    ServerAliveCountMax: '3',
    BatchMode: 'yes',
    ConnectTimeout: '10',
};


/**
 * The argv, without the program name.
 *
 * Order is fixed and asserted by test, so the command is reproducible and a log
 * line from one run can be diffed against another.
 */
export function buildSshArgs(tunnel: Tunnel): string[]
{
    // -N: no remote command, so no shell sits there. -T: no pty. -T is implied
    // by -N, but saying it means a later change to -N cannot silently start
    // allocating one.
    const args = ['-N', '-T'];

    // the user's options win. ssh takes the FIRST occurrence of a -o, so
    // emitting both would leave the user's copy as a silent no-op rather than
    // an override - which is why this merges rather than concatenates.
    const options = { ...DEFAULT_OPTIONS, ...tunnel.options };

    for (const key of Object.keys(options).sort()) {
        args.push('-o', `${key}=${options[key]!}`);
    }

    if (tunnel.port !== undefined) {
        args.push('-p', String(tunnel.port));
    }

    if (tunnel.identityFile !== undefined) {
        args.push('-i', tunnel.identityFile);
    }

    for (const forward of tunnel.forwards) {
        args.push(flagFor(forward), forwardSpec(forward));
    }

    args.push(tunnel.user === undefined ? tunnel.host : `${tunnel.user}@${tunnel.host}`);

    // last, so it can override anything above that ssh resolves last-wins
    args.push(...tunnel.extraArgs);

    return args;
}


function flagFor(forward: Forward): string
{
    if (forward.kind === 'local') {
        return '-L';
    }

    return forward.kind === 'remote' ? '-R' : '-D';
}


/**
 * A forward, back in ssh's own spelling.
 *
 * An IPv6 bind address is bracketed here. The string form of the config rejects
 * unbracketed IPv6 because the colons are ambiguous against the separator, but
 * the object form accepts it - and this is where it has to be made unambiguous
 * again for ssh.
 */
export function forwardSpec(forward: Forward): string
{
    const bind = forward.bind === undefined ? [] : [bracket(forward.bind)];

    if (forward.kind === 'dynamic') {
        return [...bind, forward.port].join(':');
    }

    return [...bind, forward.port, bracket(forward.host), forward.hostPort].join(':');
}


function bracket(address: string): string
{
    return address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
}


/** the human-readable command, for a log line or the panel's detail row */
export function describeCommand(tunnel: Tunnel): string
{
    return ['ssh', ...buildSshArgs(tunnel)].join(' ');
}


export type ExitVerdict = {
    /** retrying cannot fix this; stop and tell the user what to do */
    fatal: boolean;
    /** one line, for the footer and the log */
    message: string;
};


/**
 * Why it stopped, and whether trying again could help.
 *
 * ssh exits 255 for essentially every failure of its own, so the code alone
 * says almost nothing and the stderr tail is the discriminator. That makes this
 * a text-matching function, which is exactly the kind of thing the "never a
 * subprocess" rule exists to avoid - so note what it is NOT doing: no fact
 * about the machine is derived from this text. It decides retry or stop, and
 * supplies a sentence for a human. Whether the tunnel is actually up is
 * answered from /proc, not from here.
 *
 * The default is retryable. The cost of retrying something fatal is a slow loop
 * with a visible reason on screen; the cost of giving up on something
 * transient is a tunnel that stays down all night.
 */
export function classifyExit(code: number | null, signal: string | null, stderr: string): ExitVerdict
{
    const text = stderr.toLowerCase();

    for (const rule of FATAL) {
        if (rule.match.some(needle => text.includes(needle))) {
            return { fatal: true, message: rule.message };
        }
    }

    if (signal !== null) {
        return { fatal: false, message: `ssh was killed by ${signal}` };
    }

    for (const rule of RETRYABLE) {
        if (rule.match.some(needle => text.includes(needle))) {
            return { fatal: false, message: rule.message };
        }
    }

    if (code === 0) {
        // -N does this when the remote sshd restarts under it
        return { fatal: false, message: 'ssh exited cleanly; the server closed the connection' };
    }

    const tail = firstLine(stderr);

    return {
        fatal: false,
        message: tail === '' ? `ssh exited ${code ?? '?'}` : `ssh exited ${code ?? '?'}: ${tail}`,
    };
}


/**
 * Failures that retrying cannot fix.
 *
 * A typo in a hostname or a key that is not in the agent will fail identically
 * forever, and a supervisor that retries it every second until the cap is a hot
 * loop with a misleading "retrying" on screen. Each message names the fix,
 * because the user is going to have to make one.
 */
const FATAL: { match: string[]; message: string }[] = [
    {
        match: ['permission denied', 'too many authentication failures', 'no such identity'],
        message: 'authentication failed; add the key to your agent with ssh-add (etop runs ssh with BatchMode=yes)',
    },
    {
        match: ['host key verification failed', 'remote host identification has changed'],
        message: 'the host key was not accepted; connect once by hand to review it',
    },
    {
        match: ['could not resolve hostname', 'name or service not known'],
        message: 'the hostname could not be resolved; check the host field',
    },
    {
        match: ['bad configuration option', 'command-line: line'],
        message: 'ssh rejected an option; check the options field',
    },
];


/**
 * Failures worth waiting out.
 *
 * 'address already in use' is here rather than in FATAL deliberately: the
 * process holding the port may well exit, and a laptop that reconnects after
 * the old ssh finally dies is the behaviour wanted. The message names the port
 * so the user can decide otherwise.
 */
const RETRYABLE: { match: string[]; message: string }[] = [
    {
        match: ['bind: address already in use', 'cannot listen to port'],
        message: 'a local port is already in use; waiting for it to free up',
    },
    {
        match: ['connection refused'],
        message: 'connection refused',
    },
    {
        match: ['connection timed out', 'operation timed out', 'timeout, server not responding'],
        message: 'the connection timed out',
    },
    {
        match: ['network is unreachable', 'no route to host'],
        message: 'the network is unreachable',
    },
    {
        match: ['connection reset', 'broken pipe', 'connection closed'],
        message: 'the connection dropped',
    },
];


function firstLine(text: string): string
{
    for (const line of text.split('\n')) {
        const trimmed = line.trim();

        if (trimmed !== '') {
            return trimmed;
        }
    }

    return '';
}
