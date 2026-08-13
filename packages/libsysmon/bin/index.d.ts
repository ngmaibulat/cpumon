/**
 * Public API surface.
 *
 * Every type re-export below MUST use `export type`. esbuild transpiles each
 * file in isolation and cannot tell a type from a value, so a plain
 * `export { CpuInfo } from './CpuMonitor.js'` emits a live re-export and Node
 * throws "does not provide an export named 'CpuInfo'" at import time - while
 * the build itself reports success. tsconfig's verbatimModuleSyntax makes the
 * compiler reject the unsafe form, and test/index.test.js catches it at runtime.
 *
 * Renderers are deliberately NOT re-exported here: they pull in chalk, and
 * keeping them out means a consumer who only wants the numbers does not pay for
 * a terminal-colour library. Import 'libsysmon/cpu' or the CLI for those.
 *
 * Every collector's pure parseX() is exported alongside its reader. They are
 * the part worth reusing when the data comes from somewhere other than this
 * machine's /proc - a log, a fixture, a remote agent - and exporting them is
 * what lets the test suite cover the parsers on a runner with no /proc at all.
 */
export { CpuMonitor, getCpuInfo, getCpuDiff, toCpuInfo, withLoadRatio, aggregateCpu, } from './CpuMonitor.js';
export type { CpuInfo, CpuTimes, CpuMonitorOptions, } from './CpuMonitor.js';
export { unavailable, isAvailable, } from './types.js';
export type { Probe, Unavailable, UnavailableReason, } from './types.js';
export { SystemMonitor, sampleSystem, } from './SystemMonitor.js';
export type { CollectorName, SystemMonitorOptions, SystemSnapshot, } from './SystemMonitor.js';
export type { CollectorOptions } from './collectors/proc.js';
export { bytes, duration, formatUptime, gib, percent, rate, shortId, } from './format.js';
export { getMemoryInfo, osMemoryInfo, parseMeminfo, readMeminfo, toMemoryInfo, withCgroupLimit, } from './collectors/memory.js';
export type { MemoryInfo, MemorySource, } from './collectors/memory.js';
export { getLoadAverage, toLoadAverage, } from './collectors/loadavg.js';
export type { LoadAverage } from './collectors/loadavg.js';
export { defaultMount, getDiskUsage, toDiskInfo, } from './collectors/disk.js';
export type { DiskInfo, StatFsLike, } from './collectors/disk.js';
export { diffNetwork, getNetworkCounters, parseNetDev, } from './collectors/network.js';
export type { InterfaceCounters, InterfaceRate, NetworkCounters, NetworkRates, } from './collectors/network.js';
export { attachRss, diffProcesses, getProcessCounters, parsePidStat, parsePidStatus, parseStatTotal, selectProcesses, sortNeedsRss, sortProcesses, topProcesses, } from './collectors/process.js';
export type { ProcessCounters, ProcessLoad, ProcessSnapshot, ProcessSortKey, SelectOptions, } from './collectors/process.js';
export { detectCgroupVersion, parseCgroupCpuStat, parseCpuMax, parseMemoryMax, parseSelfCgroup, readCgroupCpu, readCgroupLimits, readSelfCgroup, readSelfLimits, } from './collectors/cgroup.js';
export type { CgroupCpuStat, CgroupLimits, CgroupVersion, } from './collectors/cgroup.js';
export { detectContainer, diffContainerCpu, getContainerInfo, listContainers, } from './collectors/container.js';
export type { ContainerInfo, ContainerRuntime, ContainerRuntimeInfo, } from './collectors/container.js';
