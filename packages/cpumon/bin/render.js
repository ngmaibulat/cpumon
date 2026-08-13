// src/render.ts
import os from "os";
import chalk from "chalk";
import { aggregateCpu } from "./CpuMonitor.js";
import { isAvailable } from "./types.js";
import { getDiskUsage } from "./collectors/disk.js";
import { getLoadAverage } from "./collectors/loadavg.js";
import { getMemoryInfo } from "./collectors/memory.js";
import { getProgressBar } from "./utils.js";
import { getVersion } from "./cli.js";
import { bytes, formatUptime, gib, rate, shortId } from "./format.js";
import { bytes as bytes2, rate as rate2 } from "./format.js";
var BAR_SYMBOL = "|";
var SPARKS = "▁▂▃▄▅▆▇█";
var PANEL_WIDTH = 46;
var LABEL_WIDTH = 10;
function renderBars(load) {
  const fmt = {
    minimumIntegerDigits: 2,
    useGrouping: false
  };
  return load.map((cpu, i) => {
    const label = (i + 1).toLocaleString("en-US", fmt);
    return `${label} ${getProgressBar(cpu.loadPercentage ?? 0, BAR_SYMBOL)}`;
  }).join(`
`);
}
function renderOverall(load) {
  const overall = aggregateCpu(load);
  return `all ${getProgressBar(overall.loadPercentage ?? 0, BAR_SYMBOL)}`;
}
function renderJson(value) {
  return JSON.stringify(value);
}
function probeRow(label, probe, format) {
  if (isAvailable(probe)) {
    return row(label, format(probe));
  }
  if (probe.reason === "not-applicable") {
    return null;
  }
  const detail = probe.detail === undefined ? "" : chalk.gray(` — ${probe.detail}`);
  return row(label, `${chalk.gray(`unavailable (${probe.reason})`)}${detail}`);
}
function compactBar(percent, width) {
  const filled = Math.round(percent / 100 * width);
  return `[${chalk.green("█".repeat(filled))}${chalk.gray("░".repeat(width - filled))}]`;
}
function sparkline(load) {
  return load.map((cpu) => {
    const percent = cpu.loadPercentage ?? 0;
    const index = Math.min(SPARKS.length - 1, Math.floor(percent / 100 * SPARKS.length));
    return SPARKS[index];
  }).join("");
}
function row(label, value) {
  return `${chalk.cyan(label.padEnd(LABEL_WIDTH))}${value}`;
}
function renderMemory(memory) {
  const lines = [
    row("Memory", `${compactBar(memory.usedPercentage, 16)} ${chalk.yellowBright(`${memory.usedPercentage}%`)}`),
    row("Used", `${bytes(memory.used)} of ${bytes(memory.total)}`),
    row("Available", bytes(memory.available))
  ];
  if (memory.swapTotal > 0) {
    const swapPercent = Math.floor(memory.swapUsed / memory.swapTotal * 100);
    lines.push(row("Swap", `${bytes(memory.swapUsed)} of ${bytes(memory.swapTotal)} (${swapPercent}%)`));
  }
  lines.push(row("Source", memory.source === "os" ? chalk.gray("os (cache counted as used)") : chalk.gray(memory.source)));
  return lines.join(`
`);
}
function renderLoad(probe) {
  if (!isAvailable(probe)) {
    return probeRow("Loadavg", probe, () => "") ?? chalk.gray("load average is not available on this platform");
  }
  const figures = `${probe.one.toFixed(2)} ${probe.five.toFixed(2)} ${probe.fifteen.toFixed(2)}`;
  const perCore = `${probe.onePerCore.toFixed(2)} ${probe.fivePerCore.toFixed(2)} ${probe.fifteenPerCore.toFixed(2)}`;
  return [
    row("Loadavg", figures),
    row("Per core", `${perCore}  ${chalk.gray(`over ${probe.cores} cores`)}`)
  ].join(`
`);
}
function renderDisk(probe) {
  if (!isAvailable(probe)) {
    return probeRow("Disk", probe, () => "") ?? chalk.gray("disk usage is not available on this platform");
  }
  const { disk } = probe;
  return [
    row("Mount", disk.mount),
    row("Usage", `${compactBar(disk.usedPercentage, 16)} ${chalk.yellowBright(`${disk.usedPercentage}%`)}`),
    row("Used", `${bytes(disk.used)} of ${bytes(disk.size)}`),
    row("Available", bytes(disk.available))
  ].join(`
`);
}
function table(headers, rows, align = []) {
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((cells) => (cells[i] ?? "").length)));
  const line = (cells, paint) => cells.map((cell, i) => (align[i] ?? "r") === "l" ? paint(cell.padEnd(widths[i])) : paint(cell.padStart(widths[i]))).join("  ");
  return [
    line(headers, (text) => chalk.cyan(text)),
    ...rows.map((cells) => line(cells, (text) => text))
  ].join(`
`);
}
function renderNetwork(probe) {
  if (!isAvailable(probe)) {
    return probeRow("Network", probe, () => "") ?? chalk.gray("network counters are not available on this platform");
  }
  if (probe.interfaces.length === 0) {
    return chalk.gray("no interfaces with a full sampling window yet");
  }
  const sorted = [...probe.interfaces].sort((a, b) => {
    if (a.name === "lo" !== (b.name === "lo")) {
      return a.name === "lo" ? 1 : -1;
    }
    return b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec);
  });
  return table(["IFACE", "RX/s", "TX/s", "RX total", "TX total"], sorted.map((item) => [
    item.name,
    rate(item.rxBytesPerSec),
    rate(item.txBytesPerSec),
    bytes(item.rxBytes),
    bytes(item.txBytes)
  ]), ["l", "r", "r", "r", "r"]);
}
function renderProcesses(probe) {
  if (!isAvailable(probe)) {
    return probeRow("Processes", probe, () => "") ?? chalk.gray("per-process figures are not available on this platform");
  }
  if (probe.processes.length === 0) {
    return chalk.gray("no processes with a full sampling window yet");
  }
  return table(["PID", "%CPU", "RSS", "THR", "COMMAND"], probe.processes.map((item) => [
    String(item.pid),
    item.cpuPercentage.toFixed(1),
    item.rss === undefined ? "-" : bytes(item.rss),
    String(item.threads),
    item.comm
  ]), ["r", "r", "r", "r", "l"]);
}
function renderContainers(probe) {
  if (!isAvailable(probe)) {
    return probeRow("Containers", probe, () => "") ?? chalk.gray("containers are not a concept on this platform");
  }
  if (probe.containers.length === 0) {
    return chalk.gray("no container cgroups found");
  }
  const rows = probe.containers.map((item) => [
    shortId(item.id),
    item.runtime,
    item.cpuPercentage === undefined ? "-" : item.cpuPercentage.toFixed(1),
    item.limits.cpuLimitCores === null ? "unlimited" : `${item.limits.cpuLimitCores}`,
    bytes(item.limits.memoryCurrent),
    item.limits.memoryMax === null ? "unlimited" : bytes(item.limits.memoryMax)
  ]);
  const body = table(["CONTAINER", "RUNTIME", "%CPU", "CPUS", "MEM", "LIMIT"], rows, ["l", "l", "r", "r", "r", "r"]);
  if (probe.scope === "namespaced") {
    return `${body}
${chalk.gray(`
running inside a container: only this cgroup is visible`)}`;
  }
  return body;
}
function fetchSnapshot(load, options = {}) {
  return {
    version: getVersion(),
    cpu: {
      model: load[0]?.model ?? "unknown",
      cores: load.length,
      overall: aggregateCpu(load),
      perCore: load
    },
    arch: os.arch(),
    platform: os.platform(),
    release: os.release(),
    uptime: os.uptime(),
    memory: getMemoryInfo(),
    disk: getDiskUsage(options.mount),
    loadavg: getLoadAverage()
  };
}
function renderFetch(load, options = {}) {
  const overall = aggregateCpu(load);
  const percent = overall.loadPercentage ?? 0;
  const memory = getMemoryInfo();
  const lines = [
    chalk.bold(`cpumon ${getVersion()}`),
    chalk.gray("─".repeat(PANEL_WIDTH)),
    row("CPU", load[0]?.model ?? "unknown"),
    row("Cores", String(load.length)),
    row("Arch", os.arch()),
    row("Platform", `${os.platform()} ${os.release()}`),
    row("Uptime", formatUptime(os.uptime())),
    row("Memory", `${gib(memory.used)} / ${gib(memory.total)} GiB (${memory.usedPercentage}%)`),
    memory.swapTotal > 0 ? row("Swap", `${gib(memory.swapUsed)} / ${gib(memory.swapTotal)} GiB`) : null,
    probeRow("Disk", getDiskUsage(options.mount), (disk) => `${gib(disk.disk.used)} / ${gib(disk.disk.size)} GiB (${disk.disk.usedPercentage}%) on ${disk.disk.mount}`),
    probeRow("Loadavg", getLoadAverage(), (avg) => `${avg.one.toFixed(2)} ${avg.five.toFixed(2)} ${avg.fifteen.toFixed(2)}  (${avg.onePerCore.toFixed(2)} per core)`),
    row("Load", `${compactBar(percent, 16)} ${chalk.yellowBright(`${percent}%`)}`),
    row("Per-core", chalk.green(sparkline(load)))
  ];
  return lines.filter((line) => line !== null).join(`
`);
}
export {
  table,
  renderProcesses,
  renderOverall,
  renderNetwork,
  renderMemory,
  renderLoad,
  renderJson,
  renderFetch,
  renderDisk,
  renderContainers,
  renderBars,
  rate2 as rate,
  probeRow,
  fetchSnapshot,
  bytes2 as bytes
};
