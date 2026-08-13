// src/collectors/cgroup.ts
import { statSync } from "node:fs";
import { unavailable } from "../types.js";
import { firstNumber, parseKeyValue, procRoot, readText, sysfsRoot, toNumber } from "./proc.js";
var V1_UNLIMITED = 9223372036854772000;
function detectCgroupVersion(options) {
  try {
    statSync(`${sysfsRoot(options)}/cgroup.controllers`);
    return 2;
  } catch {
    return 1;
  }
}
function parseSelfCgroup(text) {
  const lines = text.split(`
`).filter((line) => line.trim() !== "");
  for (const line of lines) {
    const [hierarchy, controllers, ...rest] = line.split(":");
    const path = rest.join(":");
    if (hierarchy === "0" && controllers === "") {
      return { version: 2, path };
    }
  }
  for (const line of lines) {
    const [, controllers, ...rest] = line.split(":");
    if (controllers !== undefined && controllers.split(",").includes("cpu")) {
      return { version: 1, path: rest.join(":") };
    }
  }
  return null;
}
function parseCgroupCpuStat(text) {
  const fields = parseKeyValue(text, " ");
  const value = (key) => toNumber(fields.get(key)) ?? 0;
  return {
    usageUsec: value("usage_usec"),
    userUsec: value("user_usec"),
    systemUsec: value("system_usec"),
    nrPeriods: value("nr_periods"),
    nrThrottled: value("nr_throttled"),
    throttledUsec: value("throttled_usec")
  };
}
function parseCpuMax(text) {
  const [quota, period] = text.trim().split(/\s+/);
  return {
    quotaUsec: quota === "max" ? null : toNumber(quota),
    periodUsec: toNumber(period) ?? 1e5
  };
}
function parseMemoryMax(text) {
  const raw = text.trim();
  if (raw === "max") {
    return null;
  }
  const value = toNumber(raw);
  return value === null || value >= V1_UNLIMITED ? null : value;
}
function readNumber(path) {
  const result = readText(path);
  return result.ok ? firstNumber(result.text) : null;
}
function inactiveFile(dir, version) {
  const result = readText(version === 2 ? `${dir}/memory.stat` : `${dir}/memory/memory.stat`);
  if (!result.ok) {
    return 0;
  }
  const fields = parseKeyValue(result.text, " ");
  const value = toNumber(fields.get("inactive_file") ?? fields.get("total_inactive_file"));
  return value ?? 0;
}
function readCgroupLimits(dir, version) {
  if (version === 2) {
    const cpuMax = readText(`${dir}/cpu.max`);
    const { quotaUsec: quotaUsec2, periodUsec } = cpuMax.ok ? parseCpuMax(cpuMax.text) : { quotaUsec: null, periodUsec: 1e5 };
    const memoryMaxText = readText(`${dir}/memory.max`);
    const memoryTotal2 = readNumber(`${dir}/memory.current`) ?? 0;
    return {
      available: true,
      cpuQuotaUsec: quotaUsec2,
      cpuPeriodUsec: periodUsec,
      cpuLimitCores: quotaUsec2 === null ? null : quotaUsec2 / periodUsec,
      memoryCurrent: Math.max(0, memoryTotal2 - inactiveFile(dir, 2)),
      memoryTotal: memoryTotal2,
      memoryMax: memoryMaxText.ok ? parseMemoryMax(memoryMaxText.text) : null
    };
  }
  const quota = readNumber(`${dir}/cpu/cpu.cfs_quota_us`);
  const period = readNumber(`${dir}/cpu/cpu.cfs_period_us`) ?? 1e5;
  const limitText = readText(`${dir}/memory/memory.limit_in_bytes`);
  const memoryTotal = readNumber(`${dir}/memory/memory.usage_in_bytes`) ?? 0;
  const quotaUsec = quota === null || quota < 0 ? null : quota;
  return {
    available: true,
    cpuQuotaUsec: quotaUsec,
    cpuPeriodUsec: period,
    cpuLimitCores: quotaUsec === null ? null : quotaUsec / period,
    memoryCurrent: Math.max(0, memoryTotal - inactiveFile(dir, 1)),
    memoryTotal,
    memoryMax: limitText.ok ? parseMemoryMax(limitText.text) : null
  };
}
function readCgroupCpu(dir, version) {
  if (version === 2) {
    const result = readText(`${dir}/cpu.stat`);
    return result.ok ? { available: true, ...parseCgroupCpuStat(result.text) } : unavailable(result.reason, result.detail);
  }
  const usage = readNumber(`${dir}/cpuacct/cpuacct.usage`);
  if (usage === null) {
    return unavailable("not-found", `${dir}/cpuacct/cpuacct.usage`);
  }
  return {
    available: true,
    usageUsec: usage / 1000,
    userUsec: 0,
    systemUsec: 0,
    nrPeriods: 0,
    nrThrottled: 0,
    throttledUsec: 0
  };
}
function readSelfLimits(options) {
  const self = readSelfCgroup(options);
  if (!self.available) {
    return null;
  }
  const dir = `${sysfsRoot(options)}${self.version === 2 ? self.path : ""}`;
  const limits = readCgroupLimits(dir, self.version);
  if (!limits.available) {
    return null;
  }
  const { available: _flag, ...values } = limits;
  return values;
}
function readSelfCgroup(options) {
  const result = readText(`${procRoot(options)}/self/cgroup`);
  if (!result.ok) {
    return unavailable(result.reason, result.detail);
  }
  const parsed = parseSelfCgroup(result.text);
  return parsed === null ? unavailable("parse-error", "self/cgroup had no usable line") : { available: true, ...parsed };
}
export {
  readSelfLimits,
  readSelfCgroup,
  readCgroupLimits,
  readCgroupCpu,
  parseSelfCgroup,
  parseMemoryMax,
  parseCpuMax,
  parseCgroupCpuStat,
  detectCgroupVersion
};
