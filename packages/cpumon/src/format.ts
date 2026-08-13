/**
 * Pure value formatting: numbers and durations in, display strings out.
 *
 * Unlike render.ts this module imports nothing at all - not chalk, not os, not
 * a collector. That is the point of its existence. The renderers here are the
 * only part of the presentation layer worth sharing with an out-of-tree UI
 * (etop), and sharing them through render.ts would drag a colour library
 * and every collector into a consumer that wants one function.
 *
 * It is exported both from the barrel and as the 'cpumon/format' subpath. The
 * build emits one file per source module rather than a bundle, so the subpath
 * loads exactly this file while the barrel would statically pull in all ~15
 * collectors alongside it.
 */


const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];


/** auto-scaled size, for values whose magnitude is not known in advance */
export function bytes(value: number): string
{
    let scaled = Math.abs(value);
    let unit = 0;

    while (scaled >= 1024 && unit < UNITS.length - 1) {
        scaled /= 1024;
        unit++;
    }

    // whole bytes never want a decimal point
    const digits = unit === 0 ? 0 : 1;

    return `${(value < 0 ? -scaled : scaled).toFixed(digits)} ${UNITS[unit]}`;
}


export function rate(bytesPerSec: number): string
{
    return `${bytes(bytesPerSec)}/s`;
}


/** fixed GiB, for the panel rows where a column of mixed units would not align */
export function gib(value: number): string
{
    return (value / 1024 ** 3).toFixed(1);
}


/**
 * Coarse uptime: `4d 3h 12m`. Leading units are dropped when zero, but an hours
 * figure is kept whenever there are days, so `4d 0h 12m` does not read as `4d
 * 12m` and invite the 12 to be mistaken for hours.
 */
export function formatUptime(seconds: number): string
{
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days}d`);
    }

    if (days > 0 || hours > 0) {
        parts.push(`${hours}h`);
    }

    parts.push(`${minutes}m`);

    return parts.join(' ');
}


/**
 * A cgroup path or container id, trimmed to the 12 hex characters every docker
 * command shows. `docker-<64 hex>.scope` is unreadable in a table, and the
 * prefix is the only part anyone types.
 */
export function shortId(id: string): string
{
    const hex = id.match(/^(?:docker-|libpod-|crio-|cri-containerd-)([0-9a-f]{12})/);

    return hex === null ? id : hex[1];
}


/**
 * A ratio as a percentage string. Takes 0..1 rather than 0..100 because that is
 * what every `usedRatio`/`cpuRatio` field on a collector carries; the callers
 * that already hold a percentage do not need this.
 */
export function percent(ratio: number, digits = 0): string
{
    return `${(ratio * 100).toFixed(digits)}%`;
}


/**
 * A short elapsed time: `820ms`, `4.2s`, `3m 20s`, `2h 5m`.
 *
 * Deliberately different from formatUptime, which is for a machine that has
 * been up for days and has no use for seconds.
 */
export function duration(ms: number): string
{
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }

    const seconds = ms / 1000;

    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${minutes}m ${Math.floor(seconds % 60)}s`;
    }

    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
