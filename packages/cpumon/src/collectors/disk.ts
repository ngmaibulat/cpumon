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

import { statfsSync } from 'node:fs';
import path from 'node:path';

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { errnoToUnavailable } from './proc.js';


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
export function defaultMount(): string
{
    return path.parse(process.cwd()).root;
}


export function toDiskInfo(mount: string, stats: StatFsLike): DiskInfo
{
    const size = stats.bsize * stats.blocks;
    const free = stats.bsize * stats.bfree;
    const available = stats.bsize * stats.bavail;
    const used = Math.max(0, size - free);

    const denominator = used + available;
    const usedRatio = denominator > 0 ? used / denominator : 0;

    return {
        mount,
        size,
        free,
        available,
        used,
        usedRatio,
        usedPercentage: Math.min(100, Math.max(0, Math.floor(usedRatio * 100))),
    };
}


/**
 * The payload is wrapped in `{ disk }` for the same reason memory is: DiskInfo
 * carries its own `available` - the unprivileged-usable byte count - which would
 * otherwise overwrite the Probe's discriminant.
 */
export function getDiskUsage(mount = defaultMount()): Probe<{ disk: DiskInfo }>
{
    // statfsSync landed in Node 18.15.0 and "engines" says >=18. Bumping the
    // floor over one optional collector would break installs that work today,
    // so feature-detect and report it as any other unavailable metric
    if (typeof statfsSync !== 'function') {
        return unavailable('unsupported-platform', 'fs.statfsSync requires Node >= 18.15');
    }

    try {
        return { available: true, disk: toDiskInfo(mount, statfsSync(mount)) };
    }
    catch (err) {
        // a path the user mistyped is a runtime fact, not a usage error - it
        // comes back as not-found rather than as a non-zero exit
        return errnoToUnavailable(err as NodeJS.ErrnoException, mount);
    }
}
