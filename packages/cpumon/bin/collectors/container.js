// src/collectors/container.ts
import { existsSync, readdirSync } from "node:fs";
import { unavailable } from "../types.js";
import {
  detectCgroupVersion,
  readCgroupCpu,
  readCgroupLimits,
  readSelfCgroup
} from "./cgroup.js";
import { sysfsRoot } from "./proc.js";
var PATH_MARKERS = [
  [/kubepods/, "kubernetes"],
  [/libpod-|libpod_/, "podman"],
  [/docker[-/]/, "docker"],
  [/lxc[./]/, "lxc"],
  [/machine\.slice/, "systemd"]
];
function runtimeFromPath(path) {
  for (const [pattern, runtime] of PATH_MARKERS) {
    if (pattern.test(path)) {
      return runtime;
    }
  }
  return null;
}
function detectContainer(options) {
  if (process.platform !== "linux") {
    return unavailable("unsupported-platform", "containers are a Linux concept");
  }
  if (existsSync("/.dockerenv")) {
    return { available: true, inContainer: true, runtime: "docker", detail: "/.dockerenv" };
  }
  if (existsSync("/run/.containerenv")) {
    return { available: true, inContainer: true, runtime: "podman", detail: "/run/.containerenv" };
  }
  if (process.env.KUBERNETES_SERVICE_HOST !== undefined) {
    return { available: true, inContainer: true, runtime: "kubernetes", detail: "KUBERNETES_SERVICE_HOST" };
  }
  const self = readSelfCgroup(options);
  if (!self.available) {
    return self;
  }
  const runtime = runtimeFromPath(self.path);
  if (runtime !== null) {
    return { available: true, inContainer: true, runtime, detail: self.path };
  }
  return { available: true, inContainer: false, runtime: "unknown", detail: self.path };
}
function getContainerInfo(options) {
  if (process.platform !== "linux") {
    return unavailable("unsupported-platform", "cgroups are a Linux concept");
  }
  const self = readSelfCgroup(options);
  if (!self.available) {
    return self;
  }
  const version = self.version;
  const dir = `${sysfsRoot(options)}${version === 2 ? self.path : ""}`;
  const limits = readCgroupLimits(dir, version);
  if (!limits.available) {
    return limits;
  }
  const cpu = readCgroupCpu(dir, version);
  if (!cpu.available) {
    return cpu;
  }
  const { available: _limitsFlag, ...limitValues } = limits;
  const { available: _cpuFlag, ...cpuValues } = cpu;
  const detected = detectContainer(options);
  const runtime = runtimeFromPath(self.path) ?? (detected.available && detected.inContainer ? detected.runtime : "unknown");
  return {
    available: true,
    id: self.path.split("/").filter(Boolean).pop() ?? "self",
    path: self.path,
    version,
    runtime,
    limits: limitValues,
    cpu: cpuValues
  };
}
var CONTAINER_DIRS = [
  /^docker-[0-9a-f]{12,}\.scope$/,
  /^libpod-[0-9a-f]{12,}\.scope$/,
  /^crio-[0-9a-f]{12,}\.scope$/,
  /^cri-containerd-[0-9a-f]{12,}\.scope$/,
  /^lxc\.payload\..+$/
];
var SEARCH_ROOTS = ["", "/system.slice", "/machine.slice", "/kubepods.slice", "/docker"];
function isContainerDir(name) {
  return CONTAINER_DIRS.some((pattern) => pattern.test(name));
}
function listContainers(options) {
  if (process.platform !== "linux") {
    return unavailable("unsupported-platform", "containers are a Linux concept");
  }
  const version = detectCgroupVersion(options);
  if (version === 1) {
    return unavailable("unsupported-platform", "sibling enumeration requires cgroup v2");
  }
  const root = sysfsRoot(options);
  const inside = detectContainer(options);
  const scope = inside.available && inside.inContainer ? "namespaced" : "host";
  const containers = [];
  for (const searchRoot of SEARCH_ROOTS) {
    let entries;
    try {
      entries = readdirSync(`${root}${searchRoot}`);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!isContainerDir(name)) {
        continue;
      }
      const path = `${searchRoot}/${name}`;
      const dir = `${root}${path}`;
      const limits = readCgroupLimits(dir, version);
      const cpu = readCgroupCpu(dir, version);
      if (!limits.available || !cpu.available) {
        continue;
      }
      const { available: _l, ...limitValues } = limits;
      const { available: _c, ...cpuValues } = cpu;
      containers.push({
        id: name,
        path,
        version,
        runtime: runtimeFromPath(path) ?? "unknown",
        limits: limitValues,
        cpu: cpuValues
      });
    }
  }
  if (containers.length === 0 && scope === "namespaced") {
    const self = getContainerInfo(options);
    if (self.available) {
      const { available: _s, ...info } = self;
      containers.push(info);
    }
  }
  return { available: true, containers, scope };
}
function diffContainerCpu(prev, next, elapsedMs) {
  const deltaUsec = Math.max(0, next.usageUsec - prev.usageUsec);
  const windowUsec = elapsedMs * 1000;
  const cpuRatio = windowUsec > 0 ? deltaUsec / windowUsec : 0;
  return { cpuRatio, cpuPercentage: cpuRatio * 100 };
}
export {
  listContainers,
  getContainerInfo,
  diffContainerCpu,
  detectContainer
};
