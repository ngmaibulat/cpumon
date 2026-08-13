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
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
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
export declare function parseMeminfo(text: string): Map<string, number>;
export declare function toMemoryInfo(fields: Map<string, number>, source: MemorySource): MemoryInfo;
/**
 * The Linux-only precise read. Exported so it can be tested against a fixture.
 *
 * The payload is wrapped in `{ memory }` rather than flattened, because
 * MemoryInfo has its own `available` field - the kernel's MemAvailable - which
 * would otherwise overwrite the Probe's `available: true` discriminant. Flatten
 * only when the payload's field names cannot collide with it.
 */
export declare function readMeminfo(options?: CollectorOptions): Probe<{
    memory: MemoryInfo;
}>;
/**
 * The portable fallback.
 *
 * os.freemem() is genuinely free memory, with no equivalent of MemAvailable, so
 * `used` here counts the page cache and reads high. That is a real limitation of
 * the platform rather than of this code, which is why `source` is on the type.
 */
export declare function osMemoryInfo(): MemoryInfo;
/**
 * Rewrite a machine-level reading as the container's own budget.
 *
 * Only applied when the cgroup ceiling is finite AND strictly below what
 * meminfo reported. The strict comparison matters: lxcfs already presents a
 * container-scoped /proc/meminfo, so without it a container would be corrected
 * twice, and an unlimited cgroup would otherwise clobber a perfectly good
 * machine-level reading.
 */
export declare function withCgroupLimit(memory: MemoryInfo, limit: CgroupLimits | null): MemoryInfo;
export declare function getMemoryInfo(options?: CollectorOptions): MemoryInfo;
