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

import { statSync } from 'node:fs';

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { firstNumber, parseKeyValue, procRoot, readText, sysfsRoot, toNumber } from './proc.js';
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


/**
 * v1 spells "no memory limit" as a very large number rather than as a word:
 * PAGE_COUNTER_MAX, which is 2^63-1 rounded down to a page boundary. Anything
 * at or above this is unlimited, not a 8-exabyte container.
 */
const V1_UNLIMITED = 9223372036854771712;


export function detectCgroupVersion(options?: CollectorOptions): CgroupVersion
{
    try {
        // the unified hierarchy always exposes this file at its root; v1 never does
        statSync(`${sysfsRoot(options)}/cgroup.controllers`);
        return 2;
    }
    catch {
        return 1;
    }
}


/**
 * Parse /proc/self/cgroup.
 *
 * v2 writes a single `0::/path` line. v1 writes one line per controller, and
 * the cpu controller's path is the one that matters here - the controllers can
 * genuinely be mounted at different paths.
 */
export function parseSelfCgroup(text: string): { version: CgroupVersion; path: string } | null
{
    const lines = text.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
        const [hierarchy, controllers, ...rest] = line.split(':');
        const path = rest.join(':');

        if (hierarchy === '0' && controllers === '') {
            return { version: 2, path };
        }
    }

    for (const line of lines) {
        const [, controllers, ...rest] = line.split(':');

        if (controllers !== undefined && controllers.split(',').includes('cpu')) {
            return { version: 1, path: rest.join(':') };
        }
    }

    return null;
}


/** v2's cpu.stat, or v1's cpuacct.usage converted from nanoseconds. */
export function parseCgroupCpuStat(text: string): CgroupCpuStat
{
    const fields = parseKeyValue(text, ' ');
    const value = (key: string) => toNumber(fields.get(key)) ?? 0;

    return {
        usageUsec: value('usage_usec'),
        userUsec: value('user_usec'),
        systemUsec: value('system_usec'),
        nrPeriods: value('nr_periods'),
        nrThrottled: value('nr_throttled'),
        throttledUsec: value('throttled_usec'),
    };
}


/** v2's cpu.max: `<quota|max> <period>`. */
export function parseCpuMax(text: string): { quotaUsec: number | null; periodUsec: number }
{
    const [quota, period] = text.trim().split(/\s+/);

    return {
        quotaUsec: quota === 'max' ? null : toNumber(quota),
        periodUsec: toNumber(period) ?? 100000,
    };
}


/** Either version's memory ceiling, with both spellings of "unlimited". */
export function parseMemoryMax(text: string): number | null
{
    const raw = text.trim();

    if (raw === 'max') {
        return null;
    }

    const value = toNumber(raw);

    return value === null || value >= V1_UNLIMITED ? null : value;
}


function readNumber(path: string): number | null
{
    const result = readText(path);

    return result.ok ? firstNumber(result.text) : null;
}


/**
 * The reclaimable page cache a container is holding, from memory.stat.
 *
 * Subtracting this from memory.current gives the working set - the figure
 * docker stats shows. Without it a container that has merely read a large file
 * looks like it is using far more memory than it would keep under pressure.
 */
function inactiveFile(dir: string, version: CgroupVersion): number
{
    const result = readText(version === 2 ? `${dir}/memory.stat` : `${dir}/memory/memory.stat`);

    if (!result.ok) {
        return 0;
    }

    const fields = parseKeyValue(result.text, ' ');
    // v1 names it total_inactive_file
    const value = toNumber(fields.get('inactive_file') ?? fields.get('total_inactive_file'));

    return value ?? 0;
}


export function readCgroupLimits(dir: string, version: CgroupVersion): Probe<CgroupLimits>
{
    if (version === 2) {
        const cpuMax = readText(`${dir}/cpu.max`);
        const { quotaUsec, periodUsec } = cpuMax.ok
            ? parseCpuMax(cpuMax.text)
            : { quotaUsec: null, periodUsec: 100000 };

        const memoryMaxText = readText(`${dir}/memory.max`);
        const memoryTotal = readNumber(`${dir}/memory.current`) ?? 0;

        return {
            available: true,
            cpuQuotaUsec: quotaUsec,
            cpuPeriodUsec: periodUsec,
            cpuLimitCores: quotaUsec === null ? null : quotaUsec / periodUsec,
            memoryCurrent: Math.max(0, memoryTotal - inactiveFile(dir, 2)),
            memoryTotal,
            memoryMax: memoryMaxText.ok ? parseMemoryMax(memoryMaxText.text) : null,
        };
    }

    // v1 splits the controllers across sibling directories
    const quota = readNumber(`${dir}/cpu/cpu.cfs_quota_us`);
    const period = readNumber(`${dir}/cpu/cpu.cfs_period_us`) ?? 100000;
    const limitText = readText(`${dir}/memory/memory.limit_in_bytes`);
    const memoryTotal = readNumber(`${dir}/memory/memory.usage_in_bytes`) ?? 0;

    // -1 is v1's "no quota"
    const quotaUsec = quota === null || quota < 0 ? null : quota;

    return {
        available: true,
        cpuQuotaUsec: quotaUsec,
        cpuPeriodUsec: period,
        cpuLimitCores: quotaUsec === null ? null : quotaUsec / period,
        memoryCurrent: Math.max(0, memoryTotal - inactiveFile(dir, 1)),
        memoryTotal,
        memoryMax: limitText.ok ? parseMemoryMax(limitText.text) : null,
    };
}


export function readCgroupCpu(dir: string, version: CgroupVersion): Probe<CgroupCpuStat>
{
    if (version === 2) {
        const result = readText(`${dir}/cpu.stat`);

        return result.ok
            ? { available: true, ...parseCgroupCpuStat(result.text) }
            : unavailable(result.reason, result.detail);
    }

    const usage = readNumber(`${dir}/cpuacct/cpuacct.usage`);

    if (usage === null) {
        return unavailable('not-found', `${dir}/cpuacct/cpuacct.usage`);
    }

    return {
        available: true,
        // v1 reports nanoseconds; everything downstream expects microseconds
        usageUsec: usage / 1000,
        userUsec: 0,
        systemUsec: 0,
        nrPeriods: 0,
        nrThrottled: 0,
        throttledUsec: 0,
    };
}


/**
 * This process's own cgroup limits, or null if there are none to read.
 *
 * Returns null rather than a Probe because every caller so far wants to fall
 * back silently: a machine with no cgroups is the normal case, not a failure.
 */
export function readSelfLimits(options?: CollectorOptions): CgroupLimits | null
{
    const self = readSelfCgroup(options);

    if (!self.available) {
        return null;
    }

    const dir = `${sysfsRoot(options)}${self.version === 2 ? self.path : ''}`;
    const limits = readCgroupLimits(dir, self.version);

    if (!limits.available) {
        return null;
    }

    const { available: _flag, ...values } = limits;

    return values;
}


/** The cgroup this process belongs to, as a path under the mount root. */
export function readSelfCgroup(options?: CollectorOptions): Probe<{ version: CgroupVersion; path: string }>
{
    const result = readText(`${procRoot(options)}/self/cgroup`);

    if (!result.ok) {
        return unavailable(result.reason, result.detail);
    }

    const parsed = parseSelfCgroup(result.text);

    return parsed === null
        ? unavailable('parse-error', 'self/cgroup had no usable line')
        : { available: true, ...parsed };
}
