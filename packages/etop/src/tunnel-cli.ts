/**
 * `etop tunnel …` - the tunnels without the dashboard.
 *
 * This is what replaces a shell alias. `etop tunnel up squid` does what
 * `ssh -L … host` did, plus the two things the alias could never do: it
 * reconnects, and it says what it is doing while it does it.
 *
 * It also resolves the awkwardness in "tunnels are children of etop": a
 * subcommand that spawned and exited would kill the tunnel on the way out, so
 * `up` does not pretend to be a daemon manager. It stays in the foreground and
 * holds them, exactly as the alias did, and Ctrl-C stops them.
 *
 * Nothing here has a top-level side effect; cli.tsx calls it and owns the exit
 * code, the same split parseCliArgs already has.
 */

import { getConnections, isAvailable, resolveOwners } from 'libsysmon';

import { resolveEditor, runEditor } from './term/editor.js';
import { TunnelSupervisor } from './tunnels/supervisor.js';
import { configPath } from './tunnels/config.js';
import { loadTunnelConfig, writeTemplate } from './tunnels/load.js';
import { describeCommand } from './tunnels/ssh.js';
import { localPorts, ownerText, probeTunnels } from './tunnels/status.js';
import { buildTunnelHelp } from './cli-args.js';
import type { TunnelCommand } from './cli-args.js';
import type { ConfigProbe } from './tunnels/load.js';
import type { Tunnel } from './tunnels/config.js';
import type { TunnelStatus } from './tunnels/supervisor.js';


export async function runTunnelCommand(command: TunnelCommand): Promise<number>
{
    if (command.verb === 'help') {
        console.log(buildTunnelHelp());

        return 0;
    }

    if (command.verb === 'edit') {
        return edit(command.configPath ?? configPath());
    }

    const path = command.configPath ?? configPath();
    const probe = loadTunnelConfig(path);

    if (!isAvailable(probe)) {
        return reportUnavailable(probe, path);
    }

    if (command.verb === 'list') {
        return list(probe.config.tunnels, command.json);
    }

    if (command.verb === 'status') {
        return status(probe.config.tunnels, command.json);
    }

    return up(probe.config.tunnels, command.names, command.all);
}


/**
 * What to say when there is no usable config.
 *
 * A missing file is not an error the way a broken one is: nobody has written
 * one yet, and the useful response is to say where it goes and offer the
 * template rather than to print a failure.
 */
function reportUnavailable(probe: ConfigProbe & { available: false }, path: string): number
{
    if (probe.reason === 'not-found') {
        console.error(`etop: no tunnel config at ${path}`);
        console.error('  run `etop tunnel edit` to create one from a template');

        return 1;
    }

    if (probe.reason === 'permission-denied') {
        console.error(`etop: cannot read ${path}: permission denied`);

        return 1;
    }

    console.error(`etop: ${path} is not usable`);

    for (const line of (probe.detail ?? '').split('\n')) {
        console.error(`  ${line}`);
    }

    return 2;
}


function list(tunnels: Tunnel[], json: boolean): number
{
    if (json) {
        // wrapped in a named key, never a bare array: stringifying an array
        // drops every non-index property, which is the rule plans/README.md
        // records against Probe<Foo[]>
        console.log(JSON.stringify({ tunnels }, null, 2));

        return 0;
    }

    if (tunnels.length === 0) {
        console.log('no tunnels configured');

        return 0;
    }

    const rows = tunnels.map(tunnel => [
        tunnel.name,
        target(tunnel),
        String(tunnel.forwards.length),
        tunnel.autostart ? 'yes' : 'no',
    ]);

    printTable(['NAME', 'TARGET', 'FORWARDS', 'AUTOSTART'], rows);

    return 0;
}


/**
 * Which local ports are listening, and who holds them.
 *
 * Deliberately reports what is observable rather than what is inferred. It
 * cannot say "your tunnel is up", because a port bound by somebody else's ssh
 * looks identical from here - so it says the port is bound and names the owner
 * it can see, and lets the reader draw the conclusion. This is also why there
 * is no `down` subcommand.
 */
function status(tunnels: Tunnel[], json: boolean): number
{
    const probe = getConnections();

    if (!isAvailable(probe)) {
        console.error(`etop: cannot read the socket table: ${probe.reason}`);

        return 1;
    }

    const probes = probeTunnels(tunnels, resolveOwners(probe.connections));

    if (json) {
        console.log(JSON.stringify({ tunnels: probes }, null, 2));

        return 0;
    }

    if (probes.length === 0) {
        console.log('no tunnels configured');

        return 0;
    }

    const rows = probes.map((entry, i) => [
        entry.name,
        target(tunnels[i]!),
        entry.total === 0 ? '-' : `${entry.bound}/${entry.total}`,
        entry.ports.map(port => port.port).join(', ') || '-',
        entry.ports.map(port => ownerText(port.owner)).find(text => text !== '-') ?? '-',
    ]);

    printTable(['NAME', 'TARGET', 'BOUND', 'PORTS', 'OWNER'], rows);

    // every tunnel with local forwards has all of them bound
    const allUp = probes.every(entry => entry.total === 0 || entry.bound === entry.total);

    return allUp ? 0 : 1;
}


/**
 * Run them in the foreground until interrupted.
 *
 * The direct replacement for the alias. One line per state change and nothing
 * on a tick where nothing changed: a supervisor that reprints an unchanged
 * table every second is unreadable in a scrollback.
 */
async function up(tunnels: Tunnel[], names: string[], all: boolean): Promise<number>
{
    const wanted = all
        ? tunnels.filter(tunnel => tunnel.autostart)
        : tunnels.filter(tunnel => names.includes(tunnel.name));

    const missing = names.filter(name => !tunnels.some(tunnel => tunnel.name === name));

    if (missing.length > 0) {
        console.error(`etop: no tunnel named ${missing.join(', ')}`);

        return 2;
    }

    if (wanted.length === 0) {
        console.error(all ? 'etop: no tunnel is marked autostart' : 'etop: nothing to start');

        return 2;
    }

    const supervisor = new TunnelSupervisor({ config: { version: 1, tunnels: wanted } });
    const seen = new Map<string, string>();

    const report = () => {
        for (const entry of supervisor.getSnapshot().statuses) {
            const line = `${entry.phase} ${entry.message}`;

            if (seen.get(entry.tunnel.name) !== line) {
                seen.set(entry.tunnel.name, line);
                console.log(`${stamp()}  ${pad(entry.tunnel.name, 12)} ${pad(entry.phase, 9)} ${detail(entry)}`);
            }
        }
    };

    for (const tunnel of wanted) {
        console.log(`${stamp()}  ${pad(tunnel.name, 12)} ${pad('command', 9)} ${describeCommand(tunnel)}`);
        supervisor.command('start', tunnel.name);
    }

    return waitForSignal(supervisor, report);
}


/**
 * Everything asked for has failed for a reason retrying cannot fix.
 *
 * Worth detecting because the alternative is a process that sits there having
 * given up, looking exactly like one that is working. A single fatal tunnel
 * among several is not this: the others are still worth supervising.
 */
function allFailed(supervisor: TunnelSupervisor): boolean
{
    const { statuses } = supervisor.getSnapshot();

    return statuses.length > 0 && statuses.every(entry => entry.phase === 'failed');
}


function detail(entry: TunnelStatus): string
{
    if (entry.phase === 'up') {
        const ports = localPorts(entry.tunnel);

        return ports.length === 0 ? entry.message : `${entry.message}; ${ports.join(', ')}`;
    }

    return entry.message;
}


/**
 * Hold until Ctrl-C, then stop the children before leaving.
 *
 * The keepalive is not decoration. Every timer in the supervisor is unref'd, on
 * the SlowPoller rule that nothing there may be the reason the process stays
 * alive - which is right under ink, where the render loop holds the event loop
 * open. Here there is no ink, so once a child has exited and only an unref'd
 * retry timer remains, node drains the loop and exits mid-backoff: the first
 * failure printed "retrying" and the process was gone before it could. This
 * ref'd handle is what makes `up` mean "stay up".
 *
 * The children are in this process group, so the terminal's SIGINT already
 * reaches them - but a SIGTERM from elsewhere does not, and exiting without
 * this would leave them holding their ports with nothing supervising them.
 */
function waitForSignal(supervisor: TunnelSupervisor, report: () => void): Promise<number>
{
    return new Promise(resolve => {
        let leaving = false;

        // ref'd on purpose; see the note above
        const keepalive = setInterval(() => {}, 60_000);

        const leave = (signal: NodeJS.Signals, code: number) => () => {
            if (leaving) {
                return;
            }

            leaving = true;
            console.log(`${stamp()}  stopping on ${signal}`);
            supervisor.dispose();

            // give SIGTERM a moment to be delivered and acknowledged before the
            // process leaves and the children are reparented
            setTimeout(() => {
                clearInterval(keepalive);
                resolve(code);
            }, 250);
        };

        process.once('SIGINT', leave('SIGINT', 130));
        process.once('SIGTERM', leave('SIGTERM', 143));

        supervisor.subscribe(() => {
            report();

            if (leaving || !allFailed(supervisor)) {
                return;
            }

            leaving = true;
            console.error('etop: every tunnel failed for a reason retrying cannot fix');
            supervisor.dispose();
            clearInterval(keepalive);
            resolve(1);
        });

        // the tunnels were started before this subscriber existed, so the
        // transitions that already happened have to be flushed by hand -
        // otherwise the very first "starting" line never prints
        report();
    });
}


function edit(path: string): Promise<number> | number
{
    const editor = resolveEditor();

    if (editor === null) {
        console.error('etop: no editor found; set $VISUAL or $EDITOR');

        return 1;
    }

    const created = writeTemplate(path);

    if (created.ok) {
        console.log(created.message);
    }

    return runEditor(path, editor).then(result => {
        if (!result.ok) {
            console.error(`etop: ${result.message}`);

            return 1;
        }

        // parse it now rather than leaving a broken file to be discovered on
        // the next run, when the context has gone
        const probe = loadTunnelConfig(path);

        if (!isAvailable(probe)) {
            console.error(`etop: ${path} is not usable yet`);

            for (const line of (probe.detail ?? '').split('\n')) {
                console.error(`  ${line}`);
            }

            return 1;
        }

        return 0;
    });
}


function target(tunnel: Tunnel): string
{
    const host = tunnel.user === undefined ? tunnel.host : `${tunnel.user}@${tunnel.host}`;

    return tunnel.port === undefined ? host : `${host}:${tunnel.port}`;
}


function printTable(headers: string[], rows: string[][]): void
{
    const widths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map(row => (row[i] ?? '').length)));

    const line = (cells: string[]) =>
        cells.map((cell, i) => pad(cell, widths[i]!)).join('  ').trimEnd();

    console.log(line(headers));

    for (const row of rows) {
        console.log(line(row));
    }
}


const pad = (text: string, width: number): string => text.padEnd(width);


/** local time, to the second; a tunnel log is read against a clock on a wall */
function stamp(): string
{
    return new Date().toTimeString().slice(0, 8);
}
