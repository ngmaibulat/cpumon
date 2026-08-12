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
export type ProcessSortKey = 'cpu' | 'mem' | 'pid' | 'name' | 'threads';
/**
 * Whether a sort key can be applied before resident memory has been read.
 *
 * Everything diffProcesses() produces is already in hand, so cpu/pid/name/thread
 * ordering is free. 'mem' is not: rss arrives from a second file per process,
 * and ordering by a field that is undefined on every row would silently degrade
 * to "whatever order the cut left them in". The caller has to pay for a full
 * attachRss() pass before the top-N cut, which is why this is a question worth
 * asking rather than something sortProcesses() hides.
 */
export declare function sortNeedsRss(key: ProcessSortKey): boolean;
/**
 * Order a diffed process list, most interesting first.
 *
 * "Most interesting" is per key rather than uniformly descending: the numeric
 * keys mean "biggest first", but nobody asking to sort by name wants to start
 * at z, and pid ascending is roughly boot order. `reverse` flips whichever
 * direction the key defaults to.
 *
 * pid is the tiebreaker throughout. It is the only field guaranteed unique, and
 * without it a machine full of identically-named workers reshuffles its rows
 * every tick for no reason the user can see.
 */
export declare function sortProcesses(loads: ProcessLoad[], key?: ProcessSortKey, reverse?: boolean): ProcessLoad[];
/**
 * Fill in resident memory, which needs a second file per process.
 *
 * Called after the top-N cut so the cost is bounded by what is actually shown
 * rather than by how many processes the machine happens to be running.
 */
export declare function attachRss(loads: ProcessLoad[], options?: CollectorOptions): ProcessLoad[];
export type SelectOptions = CollectorOptions & {
    /** how many rows to keep; default 10 */
    top?: number;
    /** the column the cut is taken on; default 'cpu' */
    sort?: ProcessSortKey;
    /** flip the sort direction before the cut, so `top` keeps the other end */
    sortReverse?: boolean;
};
/**
 * Sort, cut to the top N, and fill in resident memory - in whichever order is
 * both correct and cheapest.
 *
 * The order matters. attachRss() costs a second file read per process, so it
 * belongs *after* the cut. The exception is a sort on resident memory itself:
 * cutting first would rank the rows by a field none of them has yet, every
 * comparison would tie, and the fallback ordering would hand back the busiest
 * processes presented as the largest - wrong, and wrong in a way that looks
 * entirely plausible on screen. So a memory sort pays for a full pass over
 * every process, and no other key does.
 */
export declare function selectProcesses(loads: ProcessLoad[], options?: SelectOptions): ProcessLoad[];
