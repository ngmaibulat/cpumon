// src/SystemMonitor.ts
import EventEmitter from "events";
import { aggregateCpu, getCpuDiff, getCpuInfo } from "./CpuMonitor.js";
import { getDiskUsage } from "./collectors/disk.js";
import { getLoadAverage } from "./collectors/loadavg.js";
import { getMemoryInfo } from "./collectors/memory.js";
import { diffNetwork, getNetworkCounters } from "./collectors/network.js";
import { diffProcesses, getProcessCounters, selectProcesses } from "./collectors/process.js";
import { diffContainerCpu, listContainers } from "./collectors/container.js";
import { getConnections } from "./collectors/connections.js";
var DEFAULT_COLLECTORS = ["cpu", "memory", "load"];
function readBaseline(collect, options) {
  return {
    cpu: collect.has("cpu") ? getCpuInfo() : [],
    network: collect.has("network") ? getNetworkCounters(options) : null,
    processes: collect.has("process") ? getProcessCounters(options) : null,
    containers: collect.has("container") ? listContainers(options) : null,
    at: Date.now()
  };
}
function pairwise(before, after, diff) {
  if (before === null || after === null) {
    return { available: false, reason: "not-applicable" };
  }
  if (!after.available) {
    return after;
  }
  if (!before.available) {
    return before;
  }
  return diff(before, after);
}
function withContainerCpu(before, after, elapsedMs) {
  const baseline = new Map(before.map((item) => [item.path, item]));
  return after.map((item) => {
    const previous = baseline.get(item.path);
    if (previous === undefined) {
      return item;
    }
    return { ...item, ...diffContainerCpu(previous.cpu, item.cpu, elapsedMs) };
  });
}
function sampleSystem(options = {}) {
  const collect = new Set(options.collect ?? DEFAULT_COLLECTORS);
  const snapshot = { timestamp: Date.now(), elapsedMs: 0 };
  if (collect.has("memory")) {
    snapshot.memory = getMemoryInfo(options);
  }
  if (collect.has("load")) {
    snapshot.load = getLoadAverage();
  }
  if (collect.has("disk")) {
    snapshot.disk = getDiskUsage(options.mount);
  }
  if (collect.has("connection")) {
    snapshot.connections = getConnections(options);
  }
  return snapshot;
}

class SystemMonitor extends EventEmitter {
  ms;
  intervalId;
  collect;
  options;
  shouldUnref;
  baseline;
  constructor(options) {
    super();
    const opts = typeof options === "number" ? { intervalMs: options } : options;
    this.ms = opts.intervalMs;
    this.options = opts;
    this.collect = new Set(opts.collect ?? DEFAULT_COLLECTORS);
    this.shouldUnref = opts.unref ?? false;
    this.baseline = readBaseline(this.collect, opts);
    this.intervalId = null;
    this.start();
  }
  start() {
    if (this.intervalId !== null) {
      return;
    }
    this.baseline = readBaseline(this.collect, this.options);
    this.intervalId = setInterval(() => this.measure(), this.ms);
    if (this.shouldUnref) {
      this.intervalId.unref();
    }
  }
  stopMonitor() {
    if (this.intervalId === null) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
  close() {
    this.stopMonitor();
  }
  get running() {
    return this.intervalId !== null;
  }
  measure() {
    try {
      const now = Date.now();
      const elapsedMs = now - this.baseline.at;
      const snapshot = sampleSystem({ ...this.options, collect: [...this.collect] });
      snapshot.timestamp = now;
      snapshot.elapsedMs = elapsedMs;
      const next = readBaseline(this.collect, this.options);
      if (this.collect.has("cpu")) {
        if (next.cpu.length !== this.baseline.cpu.length) {
          this.baseline = next;
          return;
        }
        snapshot.cpu = getCpuDiff(this.baseline.cpu, next.cpu);
        snapshot.cpuOverall = aggregateCpu(snapshot.cpu);
      }
      if (this.collect.has("network")) {
        snapshot.network = pairwise(this.baseline.network, next.network, (before, after) => ({ available: true, ...diffNetwork(before, after, elapsedMs) }));
      }
      if (this.collect.has("process")) {
        snapshot.processes = pairwise(this.baseline.processes, next.processes, (before, after) => ({
          available: true,
          processes: selectProcesses(diffProcesses(before, after), this.options)
        }));
      }
      if (this.collect.has("container")) {
        snapshot.containers = pairwise(this.baseline.containers, next.containers, (before, after) => ({
          available: true,
          scope: after.scope,
          containers: withContainerCpu(before.containers, after.containers, elapsedMs)
        }));
      }
      this.baseline = next;
      this.emit("sample", snapshot);
    } catch (err) {
      this.emit("error", err);
    }
  }
}
export {
  sampleSystem,
  SystemMonitor
};
