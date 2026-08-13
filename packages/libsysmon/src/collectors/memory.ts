/**
 * Memory and swap usage.
 *
 * Unlike every other collector here, this one does NOT return a Probe. It can
 * never legitimately fail: os.totalmem()/os.freemem() work on every platform
 * Node supports, so a Probe<MemoryInfo> would force callers through an
 * isAvailable() branch that can never be taken. Fidelity is reported in
 * `source` instead, and getMemoryInfo() degrades meminfo -> os.
 *
 * The definition of "used" is the whole point of reading /proc/meminfo rather
 * than settling for os.freemem(). `total - free` counts the page cache as used,
 * which on a warm Linux box reads 20-30 points high and disagrees with every
 * other tool the user has. `total - available` is what `free -h` calls used, and
 * MemAvailable is the kernel's own estimate of what a new allocation could take
 * without swapping.
 */

import os from 'os';

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { firstNumber, parseKeyValue, procRoot, readText } from './proc.js';
import type { CollectorOptions } from './proc.js';
import { readSelfLimits } from './cgroup.js';
import type { CgroupLimits } from './cgroup.js';


export type MemorySource = 'meminfo' | 'cgroup' | 'os';


export type MemoryInfo = {
    /** how the numbers were obtained; 'os' cannot tell cache from used */
    source: MemorySource;
    total: number;
    free: number;
    /** MemAvailable, or free + buffers + cached on kernels too old to report it */
    available: number;
    buffers: number;
    cached: number;
    /** total - available: what `free -h` calls used */
    used: number;
    usedRatio: number;
    usedPercentage: number;
    swapTotal: number;
    swapFree: number;
    swapUsed: number;
};


/**
 * Parse /proc/meminfo into bytes.
 *
 * Every value the kernel writes there is in kB except a handful of HugePages
 * counters, which are plain counts. Converting on the presence of the unit
 * rather than on a key allowlist keeps unknown future keys correct, and means
 * this returns everything rather than only the fields MemoryInfo happens to use.
 */
export function parseMeminfo(text: string): Map<string, number>
{
    const fields = new Map<string, number>();

    for (const [key, raw] of parseKeyValue(text)) {
        const value = firstNumber(raw);

        if (value === null) {
            continue;
        }

        fields.set(key, raw.endsWith('kB') ? value * 1024 : value);
    }

    return fields;
}


function ratioFields(total: number, used: number)
{
    // a cgroup can report a zero limit, and a fixture can be empty - neither
    // should divide into NaN
    const usedRatio = total > 0 ? used / total : 0;

    return {
        usedRatio,
        usedPercentage: Math.min(100, Math.max(0, Math.floor(usedRatio * 100))),
    };
}


export function toMemoryInfo(fields: Map<string, number>, source: MemorySource): MemoryInfo
{
    const total = fields.get('MemTotal') ?? 0;
    const free = fields.get('MemFree') ?? 0;
    const buffers = fields.get('Buffers') ?? 0;
    const cached = fields.get('Cached') ?? 0;

    // MemAvailable arrived in Linux 3.14; before that the closest estimate is
    // free plus the reclaimable caches
    const available = fields.get('MemAvailable') ?? (free + buffers + cached);

    const used = Math.max(0, total - available);

    const swapTotal = fields.get('SwapTotal') ?? 0;
    const swapFree = fields.get('SwapFree') ?? 0;

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
        swapUsed: Math.max(0, swapTotal - swapFree),
    };
}


/**
 * The Linux-only precise read. Exported so it can be tested against a fixture.
 *
 * The payload is wrapped in `{ memory }` rather than flattened, because
 * MemoryInfo has its own `available` field - the kernel's MemAvailable - which
 * would otherwise overwrite the Probe's `available: true` discriminant. Flatten
 * only when the payload's field names cannot collide with it.
 */
export function readMeminfo(options?: CollectorOptions): Probe<{ memory: MemoryInfo }>
{
    const result = readText(`${procRoot(options)}/meminfo`);

    if (!result.ok) {
        return unavailable(result.reason, result.detail);
    }

    const fields = parseMeminfo(result.text);

    if (!fields.has('MemTotal')) {
        return unavailable('parse-error', 'meminfo has no MemTotal');
    }

    return { available: true, memory: toMemoryInfo(fields, 'meminfo') };
}


/**
 * The portable fallback.
 *
 * os.freemem() is genuinely free memory, with no equivalent of MemAvailable, so
 * `used` here counts the page cache and reads high. That is a real limitation of
 * the platform rather than of this code, which is why `source` is on the type.
 */
export function osMemoryInfo(): MemoryInfo
{
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);

    return {
        source: 'os',
        total,
        free,
        available: free,
        buffers: 0,
        cached: 0,
        used,
        ...ratioFields(total, used),
        swapTotal: 0,
        swapFree: 0,
        swapUsed: 0,
    };
}


/**
 * Rewrite a machine-level reading as the container's own budget.
 *
 * Only applied when the cgroup ceiling is finite AND strictly below what
 * meminfo reported. The strict comparison matters: lxcfs already presents a
 * container-scoped /proc/meminfo, so without it a container would be corrected
 * twice, and an unlimited cgroup would otherwise clobber a perfectly good
 * machine-level reading.
 */
export function withCgroupLimit(memory: MemoryInfo, limit: CgroupLimits | null): MemoryInfo
{
    if (limit === null || limit.memoryMax === null || limit.memoryMax >= memory.total) {
        return memory;
    }

    const total = limit.memoryMax;
    const used = Math.min(total, limit.memoryCurrent);
    const available = Math.max(0, total - used);

    return {
        ...memory,
        source: 'cgroup',
        total,
        free: available,
        available,
        used,
        ...ratioFields(total, used),
    };
}


export function getMemoryInfo(options?: CollectorOptions): MemoryInfo
{
    const probe = readMeminfo(options);
    const memory = probe.available ? probe.memory : osMemoryInfo();

    return withCgroupLimit(memory, readSelfLimits(options));
}
