/**
 * Low-level cgroup reads, normalised across v1 and v2.
 *
 * The two versions disagree about almost everything - file names, directory
 * layout, units, and how "unlimited" is spelled - so every difference is
 * absorbed here and callers see one shape. The divergences worth knowing:
 *
 *              cgroup v2                     cgroup v1
 *   self       0::/path                      N:subsys:/path, one line per subsys
 *   cpu usage  cpu.stat usage_usec (us)      cpuacct.usage (NANOseconds)
 *   cpu limit  cpu.max "quota period"        cpu.cfs_quota_us (-1) + cpu.cfs_period_us
 *   mem limit  memory.max ("max")            memory.limit_in_bytes (2^63-4096)
 *   mem usage  memory.current                memory.usage_in_bytes
 *
 * This module deliberately knows nothing about containers; that reading lives
 * in container.ts, which builds on these primitives.
 */
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
export type CgroupVersion = 1 | 2;
export type CgroupCpuStat = {
    /** cumulative CPU time in microseconds, normalised from v1's nanoseconds */
    usageUsec: number;
    userUsec: number;
    systemUsec: number;
    nrPeriods: number;
    nrThrottled: number;
    throttledUsec: number;
};
export type CgroupLimits = {
    /** null when unlimited */
    cpuQuotaUsec: number | null;
    cpuPeriodUsec: number;
    /** quota / period - the effective core count, or null when unlimited */
    cpuLimitCores: number | null;
    /**
     * Working set: memory.current less the reclaimable page cache, which is
     * what `docker stats` and Kubernetes both call a container's memory use.
     * Raw memory.current counts cache the kernel would drop under pressure,
     * and reads high for the same reason `total - free` does at machine level.
     */
    memoryCurrent: number;
    /** memory.current as the kernel reports it, cache included */
    memoryTotal: number;
    /** null when unlimited */
    memoryMax: number | null;
};
export declare function detectCgroupVersion(options?: CollectorOptions): CgroupVersion;
/**
 * Parse /proc/self/cgroup.
 *
 * v2 writes a single `0::/path` line. v1 writes one line per controller, and
 * the cpu controller's path is the one that matters here - the controllers can
 * genuinely be mounted at different paths.
 */
export declare function parseSelfCgroup(text: string): {
    version: CgroupVersion;
    path: string;
} | null;
/** v2's cpu.stat, or v1's cpuacct.usage converted from nanoseconds. */
export declare function parseCgroupCpuStat(text: string): CgroupCpuStat;
/** v2's cpu.max: `<quota|max> <period>`. */
export declare function parseCpuMax(text: string): {
    quotaUsec: number | null;
    periodUsec: number;
};
/** Either version's memory ceiling, with both spellings of "unlimited". */
export declare function parseMemoryMax(text: string): number | null;
export declare function readCgroupLimits(dir: string, version: CgroupVersion): Probe<CgroupLimits>;
export declare function readCgroupCpu(dir: string, version: CgroupVersion): Probe<CgroupCpuStat>;
/**
 * This process's own cgroup limits, or null if there are none to read.
 *
 * Returns null rather than a Probe because every caller so far wants to fall
 * back silently: a machine with no cgroups is the normal case, not a failure.
 */
export declare function readSelfLimits(options?: CollectorOptions): CgroupLimits | null;
/** The cgroup this process belongs to, as a path under the mount root. */
export declare function readSelfCgroup(options?: CollectorOptions): Probe<{
    version: CgroupVersion;
    path: string;
}>;
