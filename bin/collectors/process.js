import { readdirSync } from "node:fs";
import { unavailable } from "../types.js";
import { parseKeyValue, procRoot, readText } from "./proc.js";
function parsePidStat(text) {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) {
    return null;
  }
  const pid = Number(text.slice(0, open).trim());
  const comm = text.slice(open + 1, close);
  const rest = text.slice(close + 1).trim().split(/\s+/);
  const state = rest[0];
  const ppid = Number(rest[1]);
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  const threads = Number(rest[17]);
  if (!Number.isFinite(pid) || !Number.isFinite(utime) || !Number.isFinite(stime)) {
    return null;
  }
  return {
    pid,
    comm,
    state: state ?? "?",
    ppid: Number.isFinite(ppid) ? ppid : 0,
    utime,
    stime,
    jiffies: utime + stime,
    threads: Number.isFinite(threads) ? threads : 1
  };
}
function parsePidStatus(text) {
  const fields = parseKeyValue(text);
  const rss = Number(fields.get("VmRSS")?.split(/\s+/)[0]);
  return {
    name: fields.get("Name") ?? "",
    // a kernel thread has no VmRSS at all
    rss: Number.isFinite(rss) ? rss * 1024 : 0
  };
}
function parseStatTotal(text) {
  const line = text.split("\n").find((item) => item.startsWith("cpu "));
  if (line === void 0) {
    return null;
  }
  const total = line.trim().split(/\s+/).slice(1).map(Number).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return total > 0 ? total : null;
}
function countCores(text) {
  return text.split("\n").filter((line) => /^cpu\d/.test(line)).length;
}
function getProcessCounters(options) {
  const root = procRoot(options);
  const stat = readText(`${root}/stat`);
  if (!stat.ok) {
    return unavailable(stat.reason, stat.detail);
  }
  const totalJiffies = parseStatTotal(stat.text);
  if (totalJiffies === null) {
    return unavailable("parse-error", "stat has no aggregate cpu line");
  }
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return unavailable("not-found", root);
  }
  const processes = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const result = readText(`${root}/${entry}/stat`);
    if (!result.ok) {
      continue;
    }
    const counters = parsePidStat(result.text);
    if (counters !== null) {
      processes.push(counters);
    }
  }
  return {
    available: true,
    processes,
    totalJiffies,
    cores: Math.max(1, countCores(stat.text))
  };
}
function diffProcesses(prev, next) {
  const baseline = new Map(prev.processes.map((item) => [item.pid, item]));
  const totalDelta = next.totalJiffies - prev.totalJiffies;
  const loads = [];
  for (const current of next.processes) {
    const before = baseline.get(current.pid);
    if (before === void 0) {
      continue;
    }
    const delta = Math.max(0, current.jiffies - before.jiffies);
    const cpuRatio = totalDelta > 0 ? delta / totalDelta * next.cores : 0;
    loads.push({ ...current, cpuRatio, cpuPercentage: cpuRatio * 100 });
  }
  return loads.sort((a, b) => b.cpuRatio - a.cpuRatio);
}
function topProcesses(loads, n) {
  return loads.slice(0, Math.max(0, n));
}
function attachRss(loads, options) {
  const root = procRoot(options);
  return loads.map((load) => {
    const result = readText(`${root}/${load.pid}/status`);
    return result.ok ? { ...load, rss: parsePidStatus(result.text).rss } : load;
  });
}
export {
  attachRss,
  diffProcesses,
  getProcessCounters,
  parsePidStat,
  parsePidStatus,
  parseStatTotal,
  topProcesses
};
