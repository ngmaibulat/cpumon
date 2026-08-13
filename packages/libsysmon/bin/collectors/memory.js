// src/collectors/memory.ts
import os from "os";
import { unavailable } from "../types.js";
import { firstNumber, parseKeyValue, procRoot, readText } from "./proc.js";
import { readSelfLimits } from "./cgroup.js";
function parseMeminfo(text) {
  const fields = new Map;
  for (const [key, raw] of parseKeyValue(text)) {
    const value = firstNumber(raw);
    if (value === null) {
      continue;
    }
    fields.set(key, raw.endsWith("kB") ? value * 1024 : value);
  }
  return fields;
}
function ratioFields(total, used) {
  const usedRatio = total > 0 ? used / total : 0;
  return {
    usedRatio,
    usedPercentage: Math.min(100, Math.max(0, Math.floor(usedRatio * 100)))
  };
}
function toMemoryInfo(fields, source) {
  const total = fields.get("MemTotal") ?? 0;
  const free = fields.get("MemFree") ?? 0;
  const buffers = fields.get("Buffers") ?? 0;
  const cached = fields.get("Cached") ?? 0;
  const available = fields.get("MemAvailable") ?? free + buffers + cached;
  const used = Math.max(0, total - available);
  const swapTotal = fields.get("SwapTotal") ?? 0;
  const swapFree = fields.get("SwapFree") ?? 0;
  return {
    source,
    total,
    free,
    available,
    buffers,
    cached,
    used,
    ...ratioFields(total, used),
    swapTotal,
    swapFree,
    swapUsed: Math.max(0, swapTotal - swapFree)
  };
}
function readMeminfo(options) {
  const result = readText(`${procRoot(options)}/meminfo`);
  if (!result.ok) {
    return unavailable(result.reason, result.detail);
  }
  const fields = parseMeminfo(result.text);
  if (!fields.has("MemTotal")) {
    return unavailable("parse-error", "meminfo has no MemTotal");
  }
  return { available: true, memory: toMemoryInfo(fields, "meminfo") };
}
function osMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    source: "os",
    total,
    free,
    available: free,
    buffers: 0,
    cached: 0,
    used,
    ...ratioFields(total, used),
    swapTotal: 0,
    swapFree: 0,
    swapUsed: 0
  };
}
function withCgroupLimit(memory, limit) {
  if (limit === null || limit.memoryMax === null || limit.memoryMax >= memory.total) {
    return memory;
  }
  const total = limit.memoryMax;
  const used = Math.min(total, limit.memoryCurrent);
  const available = Math.max(0, total - used);
  return {
    ...memory,
    source: "cgroup",
    total,
    free: available,
    available,
    used,
    ...ratioFields(total, used)
  };
}
function getMemoryInfo(options) {
  const probe = readMeminfo(options);
  const memory = probe.available ? probe.memory : osMemoryInfo();
  return withCgroupLimit(memory, readSelfLimits(options));
}
export {
  withCgroupLimit,
  toMemoryInfo,
  readMeminfo,
  parseMeminfo,
  osMemoryInfo,
  getMemoryInfo
};
