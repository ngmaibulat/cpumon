#!/usr/bin/env node

// src/cpumon.ts
import chalk from "chalk";
import { aggregateCpu } from "./CpuMonitor.js";
import { SystemMonitor, sampleSystem } from "./SystemMonitor.js";
import { CliError, MODE_TRAITS, buildHelp, getVersion, parseCliArgs } from "./cli.js";
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
  renderProcesses
} from "./render.js";
import { getDiskUsage } from "./collectors/disk.js";
import { getLoadAverage } from "./collectors/loadavg.js";
import { getMemoryInfo } from "./collectors/memory.js";
function fail(message, exitCode) {
  console.error(chalk.red(`cpumon: ${message}`));
  console.error("Try 'cpumon --help' for the list of options.");
  process.exit(exitCode);
}
var opts;
try {
  opts = parseCliArgs(process.argv.slice(2));
} catch (err) {
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
  chalk.level = 0;
}
var cpu = (snapshot) => snapshot.cpu ?? [];
var TEXT = {
  bars: (snapshot) => renderBars(cpu(snapshot)),
  overall: (snapshot) => renderOverall(cpu(snapshot)),
  fetch: (snapshot) => renderFetch(cpu(snapshot), { mount: opts.mount }),
  mem: () => renderMemory(getMemoryInfo()),
  load: () => renderLoad(getLoadAverage()),
  disk: () => renderDisk(getDiskUsage(opts.mount)),
  net: (snapshot) => renderNetwork(snapshot.network ?? { available: false, reason: "not-applicable" }),
  proc: (snapshot) => renderProcesses(snapshot.processes ?? { available: false, reason: "not-applicable" }),
  containers: (snapshot) => renderContainers(snapshot.containers ?? { available: false, reason: "not-applicable" })
};
var SUBJECT = {
  bars: (snapshot) => cpu(snapshot),
  overall: (snapshot) => aggregateCpu(cpu(snapshot)),
  fetch: (snapshot) => fetchSnapshot(cpu(snapshot), { mount: opts.mount }),
  mem: () => getMemoryInfo(),
  load: () => getLoadAverage(),
  disk: () => getDiskUsage(opts.mount),
  net: (snapshot) => snapshot.network,
  proc: (snapshot) => snapshot.processes,
  containers: (snapshot) => snapshot.containers
};
var COLLECTORS_FOR = {
  bars: ["cpu"],
  overall: ["cpu"],
  fetch: ["cpu"],
  mem: ["memory"],
  load: ["load"],
  disk: ["disk"],
  net: ["network"],
  proc: ["process"],
  containers: ["container"]
};
var render = opts.format === "json" ? (snapshot) => renderJson(SUBJECT[opts.mode](snapshot)) : TEXT[opts.mode];
if (!MODE_TRAITS[opts.mode].needsWindow) {
  console.log(render(sampleSystem({ collect: COLLECTORS_FOR[opts.mode], mount: opts.mount })));
  process.exit(0);
}
var mon = new SystemMonitor({
  intervalMs: opts.intervalMs,
  collect: COLLECTORS_FOR[opts.mode],
  mount: opts.mount,
  top: opts.top
});
mon.on("error", (err) => {
  console.error(chalk.red(`cpumon: ${err.message}`));
});
var samples = 0;
mon.on("sample", (snapshot) => {
  if (MODE_TRAITS[opts.mode].clears && opts.format === "text" && process.stdout.isTTY) {
    console.clear();
  }
  console.log(render(snapshot));
  samples++;
  if (opts.count !== null && samples >= opts.count) {
    mon.stopMonitor();
  }
});
process.on("SIGINT", () => {
  mon.stopMonitor();
  process.exit(0);
});
