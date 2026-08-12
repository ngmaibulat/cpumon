/**
 * Per-process CPU and memory, from /proc/[pid]/stat and /proc/[pid]/status.
 *
 * Two design notes worth reading before changing anything here.
 *
 * The CPU percentage is derived as a ratio against the machine's own total
 * jiffies over the same window, taken from the aggregate line of /proc/stat.
 * That cancels USER_HZ out of the arithmetic entirely - which matters, because
 * Node exposes no sysconf(_SC_CLK_TCK) and every alternative would have to
 * assume it.
 *
 * The scan reads only /proc/[pid]/stat, one small file per process. Resident
 * memory lives in /proc/[pid]/status and is fetched by attachRss() for the
 * handful of processes that survive the top-N cut, so a 500-process host costs
 * ~500 reads per tick rather than ~1000.
 */
import type { Probe } from '../types.js';
import type { CollectorOptions } from './proc.js';
export type ProcessCounters = {
    pid: number;
    comm: string;
    state: string;
    ppid: number;
    /** cumulative user jiffies */
    utime: number;
    /** cumulative kernel jiffies */
    stime: number;
    /** utime + stime, the figure the delta is taken on */
    jiffies: number;
    threads: number;
};
export type ProcessSnapshot = {
    processes: ProcessCounters[];
    /** aggregate jiffies across every core, from the `cpu` line of /proc/stat */
    totalJiffies: number;
    cores: number;
};
export type ProcessLoad = ProcessCounters & {
    /** may exceed 1 for a multithreaded process, exactly as top reports it */
    cpuRatio: number;
    cpuPercentage: number;
    /** resident set size in bytes; only filled in by attachRss() */
    rss?: number;
};
/**
 * Parse one /proc/[pid]/stat line.
 *
 * The second field is the executable name in parentheses, and it can contain
 * both spaces and close-parens - a process really can be called "(my) app".
 * Splitting the line on whitespace is the classic bug here: it shifts every
 * subsequent field, silently corrupting utime and stime rather than failing.
 * The reliable rule is to take everything between the FIRST '(' and the LAST
 * ')' as the name, and parse only what follows.
 */
export declare function parsePidStat(text: string): ProcessCounters | null;
/** VmRSS out of /proc/[pid]/status, converted from kB to bytes. */
export declare function parsePidStatus(text: string): {
    name: string;
    rss: number;
};
/**
 * Total jiffies across every core, from the aggregate `cpu` line of /proc/stat.
 * This is the denominator that makes per-process percentages independent of
 * USER_HZ.
 */
export declare function parseStatTotal(text: string): number | null;
export declare function getProcessCounters(options?: CollectorOptions): Probe<ProcessSnapshot>;
/**
 * Turn two counter snapshots into per-process CPU shares.
 *
 * The percentage is scaled so that one fully-occupied core reads 100, which is
 * what top does - a four-thread build job legitimately shows 400%.
 */
export declare function diffProcesses(prev: ProcessSnapshot, next: ProcessSnapshot): ProcessLoad[];
export declare function topProcesses(loads: ProcessLoad[], n: number): ProcessLoad[];
/**
 * Fill in resident memory, which needs a second file per process.
 *
 * Called after the top-N cut so the cost is bounded by what is actually shown
 * rather than by how many processes the machine happens to be running.
 */
export declare function attachRss(loads: ProcessLoad[], options?: CollectorOptions): ProcessLoad[];
