#!/usr/bin/env node

/**
 * The `cpumon` binary.
 *
 * Thin by design: parsing lives in cli.ts, formatting in render.ts, and this
 * file only wires argv to a monitor and decides when to stop.
 */

import chalk from 'chalk';

import { aggregateCpu } from './CpuMonitor.js';
import { SystemMonitor, sampleSystem } from './SystemMonitor.js';
import type { CollectorName, SystemSnapshot } from './SystemMonitor.js';
import { CliError, MODE_TRAITS, buildHelp, getVersion, parseCliArgs } from './cli.js';
import type { CliMode, CliOptions } from './cli.js';
import {
    fetchSnapshot,
    renderBars,
    renderContainers,
    renderDisk,
    renderFetch,
    renderJson,
    renderLoad,
    renderMemory,
    renderNetwork,
    renderOverall,
    renderProcesses,
} from './render.js';
import { getDiskUsage } from './collectors/disk.js';
import { getLoadAverage } from './collectors/loadavg.js';
import { getMemoryInfo } from './collectors/memory.js';


function fail(message: string, exitCode: number): never
{
    console.error(chalk.red(`cpumon: ${message}`));
    console.error("Try 'cpumon --help' for the list of options.");
    process.exit(exitCode);
}


let opts: CliOptions;

try {
    opts = parseCliArgs(process.argv.slice(2));
}
catch (err) {
    if (err instanceof CliError) {
        fail(err.message, err.exitCode);
    }

    throw err;
}


if (opts.help) {
    console.log(buildHelp());
    process.exit(0);
}


if (opts.version) {
    console.log(getVersion());
    process.exit(0);
}


if (!opts.color) {
    // do not rely on chalk sniffing argv itself - the flag is ours
    chalk.level = 0;
}


/**
 * How each subject looks as text, and what it serialises to as JSON.
 *
 * Two exhaustive Records over CliMode means a newly added mode fails to compile
 * twice over until it is fully wired, rather than falling through to undefined
 * at runtime.
 */
const cpu = (snapshot: SystemSnapshot) => snapshot.cpu ?? [];

const TEXT: Record<CliMode, (snapshot: SystemSnapshot) => string> = {
    bars: snapshot => renderBars(cpu(snapshot)),
    overall: snapshot => renderOverall(cpu(snapshot)),
    fetch: snapshot => renderFetch(cpu(snapshot), { mount: opts.mount }),
    mem: () => renderMemory(getMemoryInfo()),
    load: () => renderLoad(getLoadAverage()),
    disk: () => renderDisk(getDiskUsage(opts.mount)),
    net: snapshot => renderNetwork(snapshot.network ?? { available: false, reason: 'not-applicable' }),
    proc: snapshot => renderProcesses(snapshot.processes ?? { available: false, reason: 'not-applicable' }),
    containers: snapshot => renderContainers(snapshot.containers ?? { available: false, reason: 'not-applicable' }),
};

const SUBJECT: Record<CliMode, (snapshot: SystemSnapshot) => unknown> = {
    // unchanged from 0.3.0: the bare CpuInfo[] array, one line per sample, so
    // the documented `cpumon --json | jq '[.[].loadPercentage]'` recipe holds
    bars: snapshot => cpu(snapshot),
    overall: snapshot => aggregateCpu(cpu(snapshot)),
    fetch: snapshot => fetchSnapshot(cpu(snapshot), { mount: opts.mount }),
    mem: () => getMemoryInfo(),
    load: () => getLoadAverage(),
    disk: () => getDiskUsage(opts.mount),
    net: snapshot => snapshot.network,
    proc: snapshot => snapshot.processes,
    containers: snapshot => snapshot.containers,
};

/** what each subject actually needs sampled, so no view pays for the others */
const COLLECTORS_FOR: Record<CliMode, CollectorName[]> = {
    bars: ['cpu'],
    overall: ['cpu'],
    fetch: ['cpu'],
    mem: ['memory'],
    load: ['load'],
    disk: ['disk'],
    net: ['network'],
    proc: ['process'],
    containers: ['container'],
};

const render = opts.format === 'json'
    ? (snapshot: SystemSnapshot) => renderJson(SUBJECT[opts.mode](snapshot))
    : TEXT[opts.mode];


// a view with nothing to diff has no reason to start a timer and wait an
// interval - `cpumon --mem` should answer as fast as `free` does
if (!MODE_TRAITS[opts.mode].needsWindow) {
    console.log(render(sampleSystem({ collect: COLLECTORS_FOR[opts.mode], mount: opts.mount })));
    process.exit(0);
}

const mon = new SystemMonitor({
    intervalMs: opts.intervalMs,
    collect: COLLECTORS_FOR[opts.mode],
    mount: opts.mount,
    top: opts.top,
});


// EventEmitter rethrows an 'error' event that has no listener, so without
// this a bad sample would kill the CLI instead of skipping a frame
mon.on('error', (err: Error) => {
    console.error(chalk.red(`cpumon: ${err.message}`));
});


let samples = 0;

mon.on('sample', (snapshot: SystemSnapshot) => {
    // clearing is for the live views only, and only on a terminal in text
    // format - piping it would push escape sequences into the consumer's stream
    if (MODE_TRAITS[opts.mode].clears && opts.format === 'text' && process.stdout.isTTY) {
        console.clear();
    }

    console.log(render(snapshot));

    samples++;

    if (opts.count !== null && samples >= opts.count) {
        // dropping the interval leaves nothing keeping the loop alive, so the
        // process exits on its own with status 0
        mon.stopMonitor();
    }
});


process.on('SIGINT', () => {
    mon.stopMonitor();
    process.exit(0);
});
