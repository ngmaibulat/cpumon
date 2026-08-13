/**
 * Shared plumbing for the /proc and /sys/fs/cgroup collectors.
 *
 * Two rules hold across every collector built on this module:
 *
 * 1. Readers never throw. A missing file, a denied read and a kernel that does
 *    not implement the interface are all ordinary answers, so they come back as
 *    an Unavailable rather than as an exception the caller has to catch.
 * 2. Readers never parse and parsers never read. Every collector splits into a
 *    pure parseX(text) and a thin reader, which is what lets the parsers be
 *    tested with fixture strings on a machine that has no /proc at all.
 *
 * The root paths are options rather than constants so the *readers* are testable
 * too - point procRoot at test/fixtures/proc and getMemoryInfo() runs end to end
 * on macOS. That is the difference between "Linux-only code" and "code with a
 * Linux-only default path".
 */

import { readFileSync } from 'node:fs';

import { unavailable } from '../types.js';
import type { Unavailable } from '../types.js';


export const IS_LINUX = process.platform === 'linux';

export const DEFAULT_PROC_ROOT = '/proc';
export const DEFAULT_SYSFS_ROOT = '/sys/fs/cgroup';

/**
 * USER_HZ - the unit of the utime/stime counters in /proc/[pid]/stat.
 *
 * Node exposes no sysconf(_SC_CLK_TCK) binding, so this cannot be read at
 * runtime. 100 is the value on every mainstream Linux build. Where a percentage
 * can be derived as a ratio against the same window's total jiffies the constant
 * cancels out entirely and should be preferred; this is the fallback.
 */
export const CLOCK_TICKS = 100;


export type CollectorOptions = {
    /** root of procfs; overridable so tests can point at a fixture tree */
    procRoot?: string;
    /** root of the unified cgroup mount */
    sysfsRoot?: string;
    /** USER_HZ, if it ever needs overriding */
    clockTicks?: number;
};


export type ReadResult =
    | { ok: true; text: string }
    | ({ ok: false } & Unavailable);


export function procRoot(options?: CollectorOptions): string
{
    return options?.procRoot ?? DEFAULT_PROC_ROOT;
}


export function sysfsRoot(options?: CollectorOptions): string
{
    return options?.sysfsRoot ?? DEFAULT_SYSFS_ROOT;
}


export function clockTicks(options?: CollectorOptions): number
{
    return options?.clockTicks ?? CLOCK_TICKS;
}


/**
 * Map an errno onto the vocabulary in types.ts.
 *
 * ENOSYS/EOPNOTSUPP mean the kernel does not implement the interface at all,
 * which is the same situation as running on the wrong platform - hence
 * 'unsupported-platform' rather than 'not-found'.
 */
export function errnoToUnavailable(err: NodeJS.ErrnoException, path: string): Unavailable
{
    switch (err.code) {
        case 'ENOENT':
        case 'ENOTDIR':
            return unavailable('not-found', path);

        case 'EACCES':
        case 'EPERM':
            return unavailable('permission-denied', path);

        case 'ENOSYS':
        case 'EOPNOTSUPP':
            return unavailable('unsupported-platform', `${path}: ${err.code}`);

        default:
            return unavailable('parse-error', `${path}: ${err.code ?? err.message}`);
    }
}


/**
 * Read a pseudo-file synchronously.
 *
 * Sync is the right call here and not a shortcut: /proc and /sys are
 * memory-backed, so this is a read(2) against kernel-generated text with no
 * block device behind it. Going async would force every renderer - which today
 * is a pure CpuInfo[] -> string function - to become async for no measurable
 * gain, and would introduce overlapping ticks when a sample outlives its
 * interval.
 */
export function readText(path: string): ReadResult
{
    try {
        return { ok: true, text: readFileSync(path, 'utf8') };
    }
    catch (err) {
        return { ok: false, ...errnoToUnavailable(err as NodeJS.ErrnoException, path) };
    }
}


/**
 * Parse the `Key: value` shape shared by /proc/meminfo, /proc/[pid]/status and
 * the cgroup stat files (which use a space rather than a colon).
 *
 * Values are returned as raw strings - unit handling differs per file and
 * belongs to the caller, not here.
 */
export function parseKeyValue(text: string, separator = ':'): Map<string, string>
{
    const fields = new Map<string, string>();

    for (const line of text.split('\n')) {
        const at = line.indexOf(separator);

        if (at === -1) {
            continue;
        }

        const key = line.slice(0, at).trim();

        if (key !== '') {
            fields.set(key, line.slice(at + 1).trim());
        }
    }

    return fields;
}


/**
 * Number() with the cases that matter here rejected rather than coerced:
 * Number('') is 0 and Number(undefined) is NaN, and a pseudo-file that has gone
 * empty must not read as a legitimate zero.
 */
export function toNumber(raw: string | undefined): number | null
{
    if (raw === undefined) {
        return null;
    }

    const trimmed = raw.trim();

    if (trimmed === '') {
        return null;
    }

    const value = Number(trimmed);

    return Number.isFinite(value) ? value : null;
}


/**
 * First whitespace-separated token of a value, as a number.
 *
 * /proc/meminfo values are `17952 kB` and cgroup's cpu.max is `max 100000`, so
 * the unit or the second field has to be dropped before Number() sees it.
 */
export function firstNumber(raw: string | undefined): number | null
{
    return toNumber(raw?.trim().split(/\s+/)[0]);
}
