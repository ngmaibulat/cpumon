/**
 * Filesystem usage, via fs.statfs.
 *
 * `used` follows df's rule rather than the naive one. A filesystem reserves a
 * slice of itself for root (5% by default on ext4), which is counted in `bfree`
 * but not in `bavail`. Computing the ratio as used / (used + available) means
 * the reserve is not presented to an unprivileged user as free space they can
 * actually have - and it is what makes these numbers agree with `df`.
 *
 * The byte figures match `df -B1` exactly. usedPercentage can read one point
 * lower, because df rounds the percentage up and every percentage in this
 * package floors it, as withLoadRatio() has always done. Consistency across
 * collectors is worth more here than matching df's rounding in particular.
 */
import type { Probe } from '../types.js';
export type StatFsLike = {
    bsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
};
export type DiskInfo = {
    mount: string;
    size: number;
    /** includes the root-reserved blocks */
    free: number;
    /** what an unprivileged process can actually allocate */
    available: number;
    used: number;
    /** used / (used + available), so the reserve is not counted as free */
    usedRatio: number;
    usedPercentage: number;
};
/**
 * The filesystem a bare `--disk` reports on.
 *
 * Not a hardcoded '/': path.parse().root yields '/' on Linux and macOS and
 * 'C:\' on Windows, which is the only form that is correct everywhere.
 */
export declare function defaultMount(): string;
export declare function toDiskInfo(mount: string, stats: StatFsLike): DiskInfo;
/**
 * The payload is wrapped in `{ disk }` for the same reason memory is: DiskInfo
 * carries its own `available` - the unprivileged-usable byte count - which would
 * otherwise overwrite the Probe's discriminant.
 */
export declare function getDiskUsage(mount?: string): Probe<{
    disk: DiskInfo;
}>;
