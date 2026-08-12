/**
 * Output modes for the CLI.
 *
 * Every renderer takes a CpuInfo[] sample and returns a string - none of them
 * write to a stream, so they stay testable and the runner keeps sole control of
 * clearing, ordering and exit.
 *
 * Like utils.ts, this module is NOT re-exported from src/index.ts: it imports
 * chalk, and the barrel deliberately stays colour-library free (see the comment
 * at the top of src/index.ts).
 */

import os from 'os';
import chalk from 'chalk';

import { aggregateCpu } from './CpuMonitor.js';
import type { CpuInfo } from './CpuMonitor.js';
import { isAvailable } from './types.js';
import type { Probe } from './types.js';
import { getDiskUsage } from './collectors/disk.js';
import type { DiskInfo } from './collectors/disk.js';
import { getLoadAverage } from './collectors/loadavg.js';
import type { LoadAverage } from './collectors/loadavg.js';
import { getMemoryInfo } from './collectors/memory.js';
import type { MemoryInfo } from './collectors/memory.js';
import type { NetworkRates } from './collectors/network.js';
import type { ProcessLoad } from './collectors/process.js';
import type { ContainerInfo } from './collectors/container.js';
import { getProgressBar } from './utils.js';
import { getVersion } from './cli.js';
import { bytes, formatUptime, gib, rate, shortId } from './format.js';

// bytes/rate were exported from here before format.ts existed, and the CLI is
// not the only caller - keep the old import path working
export { bytes, rate } from './format.js';


const BAR_SYMBOL = '|';

/** ascending block characters, used for the per-core sparkline */
const SPARKS = '▁▂▃▄▅▆▇█';

const PANEL_WIDTH = 46;
/** widened from 9 to fit "Container" */
const LABEL_WIDTH = 10;


export function renderBars(load: CpuInfo[]): string
{
    const fmt = {
        minimumIntegerDigits: 2,
        useGrouping: false,
    };

    return load
        .map((cpu, i) => {
            const label = (i + 1).toLocaleString('en-US', fmt);
            return `${label} ${getProgressBar(cpu.loadPercentage ?? 0, BAR_SYMBOL)}`;
        })
        .join('\n');
}


export function renderOverall(load: CpuInfo[]): string
{
    const overall = aggregateCpu(load);

    return `all ${getProgressBar(overall.loadPercentage ?? 0, BAR_SYMBOL)}`;
}


/**
 * One sample per line (NDJSON), uncoloured, so `cpumon --json | jq` works and a
 * long-running stream can be consumed a line at a time.
 *
 * Takes the already-selected subject rather than a CpuInfo[], because --json is
 * a format that composes with every view, not a view of its own.
 */
export function renderJson(value: unknown): string
{
    return JSON.stringify(value);
}


/**
 * One label/value row for a probe, or null when the row should not appear.
 *
 * The panel is a diagnostic surface, so a failed read is shown rather than
 * hidden: a silently missing Disk row is indistinguishable from a bug, whereas
 * "unavailable (permission-denied)" is one search away from a fix. The single
 * exception is 'not-applicable', which means the concept does not exist on this
 * platform at all - printing "Loadavg unavailable" on every Windows run would
 * be pure noise.
 */
export function probeRow<T>(label: string, probe: Probe<T>, format: (value: T) => string): string | null
{
    if (isAvailable(probe)) {
        return row(label, format(probe));
    }

    if (probe.reason === 'not-applicable') {
        return null;
    }

    const detail = probe.detail === undefined ? '' : chalk.gray(` — ${probe.detail}`);

    return row(label, `${chalk.gray(`unavailable (${probe.reason})`)}${detail}`);
}


/** compact fixed-width bar, unlike the 100-column one used for per-core rows */
function compactBar(percent: number, width: number): string
{
    const filled = Math.round((percent / 100) * width);

    return `[${chalk.green('█'.repeat(filled))}${chalk.gray('░'.repeat(width - filled))}]`;
}


function sparkline(load: CpuInfo[]): string
{
    return load
        .map(cpu => {
            const percent = cpu.loadPercentage ?? 0;
            // 100% must land on the last character, not one past it
            const index = Math.min(SPARKS.length - 1, Math.floor((percent / 100) * SPARKS.length));
            return SPARKS[index];
        })
        .join('');
}


function row(label: string, value: string): string
{
    return `${chalk.cyan(label.padEnd(LABEL_WIDTH))}${value}`;
}


/**
 * Memory and swap, as a standalone view.
 *
 * `source` is shown because it changes what the numbers mean: on the 'os' path
 * there is no MemAvailable equivalent, so `used` includes the page cache and
 * reads high. Hiding that would make the same command silently mean two
 * different things on two machines.
 */
export function renderMemory(memory: MemoryInfo): string
{
    const lines = [
        row('Memory', `${compactBar(memory.usedPercentage, 16)} ${chalk.yellowBright(`${memory.usedPercentage}%`)}`),
        row('Used', `${bytes(memory.used)} of ${bytes(memory.total)}`),
        row('Available', bytes(memory.available)),
    ];

    if (memory.swapTotal > 0) {
        const swapPercent = Math.floor((memory.swapUsed / memory.swapTotal) * 100);

        lines.push(row('Swap', `${bytes(memory.swapUsed)} of ${bytes(memory.swapTotal)} (${swapPercent}%)`));
    }

    lines.push(row('Source', memory.source === 'os' ? chalk.gray('os (cache counted as used)') : chalk.gray(memory.source)));

    return lines.join('\n');
}


export function renderLoad(probe: Probe<LoadAverage>): string
{
    if (!isAvailable(probe)) {
        return probeRow('Loadavg', probe, () => '') ?? chalk.gray('load average is not available on this platform');
    }

    const figures = `${probe.one.toFixed(2)} ${probe.five.toFixed(2)} ${probe.fifteen.toFixed(2)}`;
    const perCore = `${probe.onePerCore.toFixed(2)} ${probe.fivePerCore.toFixed(2)} ${probe.fifteenPerCore.toFixed(2)}`;

    return [
        row('Loadavg', figures),
        row('Per core', `${perCore}  ${chalk.gray(`over ${probe.cores} cores`)}`),
    ].join('\n');
}


export function renderDisk(probe: Probe<{ disk: DiskInfo }>): string
{
    if (!isAvailable(probe)) {
        return probeRow('Disk', probe, () => '') ?? chalk.gray('disk usage is not available on this platform');
    }

    const { disk } = probe;

    return [
        row('Mount', disk.mount),
        row('Usage', `${compactBar(disk.usedPercentage, 16)} ${chalk.yellowBright(`${disk.usedPercentage}%`)}`),
        row('Used', `${bytes(disk.used)} of ${bytes(disk.size)}`),
        row('Available', bytes(disk.available)),
    ].join('\n');
}


/**
 * An aligned table. Columns are sized to their widest cell, and every column
 * after the first is right-aligned unless told otherwise, which is what keeps
 * a column of byte rates readable.
 */
export function table(headers: string[], rows: string[][], align: ('l' | 'r')[] = []): string
{
    const widths = headers.map((header, i) =>
        Math.max(header.length, ...rows.map(cells => (cells[i] ?? '').length)));

    const line = (cells: string[], paint: (text: string) => string) =>
        cells
            .map((cell, i) => ((align[i] ?? 'r') === 'l'
                ? paint(cell.padEnd(widths[i]))
                : paint(cell.padStart(widths[i]))))
            .join('  ');

    return [
        line(headers, text => chalk.cyan(text)),
        ...rows.map(cells => line(cells, text => text)),
    ].join('\n');
}


export function renderNetwork(probe: Probe<NetworkRates>): string
{
    if (!isAvailable(probe)) {
        return probeRow('Network', probe, () => '') ?? chalk.gray('network counters are not available on this platform');
    }

    if (probe.interfaces.length === 0) {
        return chalk.gray('no interfaces with a full sampling window yet');
    }

    // busiest first, but loopback last regardless: it is almost always the
    // loudest interface and almost never the interesting one
    const sorted = [...probe.interfaces].sort((a, b) => {
        if ((a.name === 'lo') !== (b.name === 'lo')) {
            return a.name === 'lo' ? 1 : -1;
        }

        return (b.rxBytesPerSec + b.txBytesPerSec) - (a.rxBytesPerSec + a.txBytesPerSec);
    });

    return table(
        ['IFACE', 'RX/s', 'TX/s', 'RX total', 'TX total'],
        sorted.map(item => [
            item.name,
            rate(item.rxBytesPerSec),
            rate(item.txBytesPerSec),
            bytes(item.rxBytes),
            bytes(item.txBytes),
        ]),
        ['l', 'r', 'r', 'r', 'r'],
    );
}


export function renderProcesses(probe: Probe<{ processes: ProcessLoad[] }>): string
{
    if (!isAvailable(probe)) {
        return probeRow('Processes', probe, () => '') ?? chalk.gray('per-process figures are not available on this platform');
    }

    if (probe.processes.length === 0) {
        return chalk.gray('no processes with a full sampling window yet');
    }

    return table(
        ['PID', '%CPU', 'RSS', 'THR', 'COMMAND'],
        probe.processes.map(item => [
            String(item.pid),
            item.cpuPercentage.toFixed(1),
            item.rss === undefined ? '-' : bytes(item.rss),
            String(item.threads),
            item.comm,
        ]),
        ['r', 'r', 'r', 'r', 'l'],
    );
}


export function renderContainers(
    probe: Probe<{ containers: ContainerInfo[]; scope: 'host' | 'namespaced' }>,
): string
{
    if (!isAvailable(probe)) {
        return probeRow('Containers', probe, () => '') ?? chalk.gray('containers are not a concept on this platform');
    }

    if (probe.containers.length === 0) {
        return chalk.gray('no container cgroups found');
    }

    const rows = probe.containers.map(item => [
        shortId(item.id),
        item.runtime,
        item.cpuPercentage === undefined ? '-' : item.cpuPercentage.toFixed(1),
        item.limits.cpuLimitCores === null ? 'unlimited' : `${item.limits.cpuLimitCores}`,
        bytes(item.limits.memoryCurrent),
        item.limits.memoryMax === null ? 'unlimited' : bytes(item.limits.memoryMax),
    ]);

    const body = table(
        ['CONTAINER', 'RUNTIME', '%CPU', 'CPUS', 'MEM', 'LIMIT'],
        rows,
        ['l', 'l', 'r', 'r', 'r', 'r'],
    );

    if (probe.scope === 'namespaced') {
        // an empty-looking list here is the namespace, not the machine
        return `${body}\n${chalk.gray('\nrunning inside a container: only this cgroup is visible')}`;
    }

    return body;
}


export type FetchOptions = {
    /** filesystem the Disk row reports on */
    mount?: string;
};


/**
 * The data behind the --fetch panel, for `--fetch --json`.
 *
 * Probes are emitted verbatim, `available: false` and all, so a consumer gets
 * one stable schema whatever the platform can actually read - which is the
 * whole reason collectors return probes rather than throwing.
 */
export function fetchSnapshot(load: CpuInfo[], options: FetchOptions = {})
{
    return {
        version: getVersion(),
        cpu: {
            model: load[0]?.model ?? 'unknown',
            cores: load.length,
            overall: aggregateCpu(load),
            perCore: load,
        },
        arch: os.arch(),
        platform: os.platform(),
        release: os.release(),
        uptime: os.uptime(),
        memory: getMemoryInfo(),
        disk: getDiskUsage(options.mount),
        loadavg: getLoadAverage(),
    };
}


/**
 * A fastfetch-style snapshot: aligned label/value rows, no ASCII logo. Unlike
 * the other renderers this mixes in static system facts, so it is only useful
 * as a one-shot - the runner defaults --fetch to a single sample.
 *
 * The memory figure comes from the collector rather than os.freemem(), so on
 * Linux it counts the page cache as reclaimable and agrees with `free -h`. The
 * old inline reading of total - free ran 10-15 points high on a warm machine.
 */
export function renderFetch(load: CpuInfo[], options: FetchOptions = {}): string
{
    const overall = aggregateCpu(load);
    const percent = overall.loadPercentage ?? 0;

    const memory = getMemoryInfo();

    const lines: (string | null)[] = [
        chalk.bold(`cpumon ${getVersion()}`),
        chalk.gray('─'.repeat(PANEL_WIDTH)),
        row('CPU', load[0]?.model ?? 'unknown'),
        row('Cores', String(load.length)),
        row('Arch', os.arch()),
        row('Platform', `${os.platform()} ${os.release()}`),
        row('Uptime', formatUptime(os.uptime())),
        row('Memory', `${gib(memory.used)} / ${gib(memory.total)} GiB (${memory.usedPercentage}%)`),
        // a machine with no swap configured has nothing to say about it
        memory.swapTotal > 0
            ? row('Swap', `${gib(memory.swapUsed)} / ${gib(memory.swapTotal)} GiB`)
            : null,
        probeRow('Disk', getDiskUsage(options.mount), disk =>
            `${gib(disk.disk.used)} / ${gib(disk.disk.size)} GiB (${disk.disk.usedPercentage}%) on ${disk.disk.mount}`),
        probeRow('Loadavg', getLoadAverage(), avg =>
            `${avg.one.toFixed(2)} ${avg.five.toFixed(2)} ${avg.fifteen.toFixed(2)}  (${avg.onePerCore.toFixed(2)} per core)`),
        row('Load', `${compactBar(percent, 16)} ${chalk.yellowBright(`${percent}%`)}`),
        row('Per-core', chalk.green(sparkline(load))),
    ];

    return lines.filter((line): line is string => line !== null).join('\n');
}
