/**
 * Pure value formatting: numbers and durations in, display strings out.
 *
 * Unlike render.ts this module imports nothing at all - not chalk, not os, not
 * a collector. That is the point of its existence. The renderers here are the
 * only part of the presentation layer worth sharing with an out-of-tree UI
 * (cpumon-tui), and sharing them through render.ts would drag a colour library
 * and every collector into a consumer that wants one function.
 *
 * It is exported both from the barrel and as the 'cpumon/format' subpath. The
 * build emits one file per source module rather than a bundle, so the subpath
 * loads exactly this file while the barrel would statically pull in all ~15
 * collectors alongside it.
 */
/** auto-scaled size, for values whose magnitude is not known in advance */
export declare function bytes(value: number): string;
export declare function rate(bytesPerSec: number): string;
/** fixed GiB, for the panel rows where a column of mixed units would not align */
export declare function gib(value: number): string;
/**
 * Coarse uptime: `4d 3h 12m`. Leading units are dropped when zero, but an hours
 * figure is kept whenever there are days, so `4d 0h 12m` does not read as `4d
 * 12m` and invite the 12 to be mistaken for hours.
 */
export declare function formatUptime(seconds: number): string;
/**
 * A cgroup path or container id, trimmed to the 12 hex characters every docker
 * command shows. `docker-<64 hex>.scope` is unreadable in a table, and the
 * prefix is the only part anyone types.
 */
export declare function shortId(id: string): string;
/**
 * A ratio as a percentage string. Takes 0..1 rather than 0..100 because that is
 * what every `usedRatio`/`cpuRatio` field on a collector carries; the callers
 * that already hold a percentage do not need this.
 */
export declare function percent(ratio: number, digits?: number): string;
/**
 * A short elapsed time: `820ms`, `4.2s`, `3m 20s`, `2h 5m`.
 *
 * Deliberately different from formatUptime, which is for a machine that has
 * been up for days and has no use for seconds.
 */
export declare function duration(ms: number): string;
