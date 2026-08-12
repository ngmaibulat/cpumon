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

import { readdirSync } from 'node:fs';

import { unavailable } from '../types.js';
import type { Probe } from '../types.js';
import { parseKeyValue, procRoot, readText } from './proc.js';
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
export function parsePidStat(text: string): ProcessCounters | null
{
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');

    if (open === -1 || close === -1 || close < open) {
        return null;
    }

    const pid = Number(text.slice(0, open).trim());
    const comm = text.slice(open + 1, close);
    const rest = text.slice(close + 1).trim().split(/\s+/);

    // rest[0] is field 3 (state), so field N is at rest[N - 3]
    const state = rest[0];
    const ppid = Number(rest[1]);
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    const threads = Number(rest[17]);

    if (!Number.isFinite(pid) || !Number.isFinite(utime) || !Number.isFinite(stime)) {
        return null;
    }

    return {
        pid,
        comm,
        state: state ?? '?',
        ppid: Number.isFinite(ppid) ? ppid : 0,
        utime,
        stime,
        jiffies: utime + stime,
        threads: Number.isFinite(threads) ? threads : 1,
    };
}


/** VmRSS out of /proc/[pid]/status, converted from kB to bytes. */
export function parsePidStatus(text: string): { name: string; rss: number }
{
    const fields = parseKeyValue(text);
    const rss = Number(fields.get('VmRSS')?.split(/\s+/)[0]);

    return {
        name: fields.get('Name') ?? '',
        // a kernel thread has no VmRSS at all
        rss: Number.isFinite(rss) ? rss * 1024 : 0,
    };
}


/**
 * Total jiffies across every core, from the aggregate `cpu` line of /proc/stat.
 * This is the denominator that makes per-process percentages independent of
 * USER_HZ.
 */
export function parseStatTotal(text: string): number | null
{
    const line = text.split('\n').find(item => item.startsWith('cpu '));

    if (line === undefined) {
        return null;
    }

    const total = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map(Number)
        .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);

    return total > 0 ? total : null;
}


function countCores(text: string): number
{
    return text.split('\n').filter(line => /^cpu\d/.test(line)).length;
}


export function getProcessCounters(options?: CollectorOptions): Probe<ProcessSnapshot>
{
    const root = procRoot(options);

    const stat = readText(`${root}/stat`);

    if (!stat.ok) {
        return unavailable(stat.reason, stat.detail);
    }

    const totalJiffies = parseStatTotal(stat.text);

    if (totalJiffies === null) {
        return unavailable('parse-error', 'stat has no aggregate cpu line');
    }

    let entries: string[];

    try {
        entries = readdirSync(root);
    }
    catch {
        return unavailable('not-found', root);
    }

    const processes: ProcessCounters[] = [];

    for (const entry of entries) {
        // /proc holds far more than pids; only the all-digit names are processes
        if (!/^\d+$/.test(entry)) {
            continue;
        }

        const result = readText(`${root}/${entry}/stat`);

        // the process exited between the readdir and this read. that is normal
        // on any busy machine and must not fail the whole scan
        if (!result.ok) {
            continue;
        }

        const counters = parsePidStat(result.text);

        if (counters !== null) {
            processes.push(counters);
        }
    }

    return {
        available: true,
        processes,
        totalJiffies,
        cores: Math.max(1, countCores(stat.text)),
    };
}


/**
 * Turn two counter snapshots into per-process CPU shares.
 *
 * The percentage is scaled so that one fully-occupied core reads 100, which is
 * what top does - a four-thread build job legitimately shows 400%.
 */
export function diffProcesses(prev: ProcessSnapshot, next: ProcessSnapshot): ProcessLoad[]
{
    const baseline = new Map(prev.processes.map(item => [item.pid, item]));
    const totalDelta = next.totalJiffies - prev.totalJiffies;

    const loads: ProcessLoad[] = [];

    for (const current of next.processes) {
        const before = baseline.get(current.pid);

        // a process that started during this window has no baseline; it gets a
        // figure on the next one rather than a bogus one now
        if (before === undefined) {
            continue;
        }

        const delta = Math.max(0, current.jiffies - before.jiffies);

        // totalDelta is summed across every core, so dividing by it gives the
        // share of the whole machine; multiplying by the core count restores
        // the per-core scale top uses
        const cpuRatio = totalDelta > 0 ? (delta / totalDelta) * next.cores : 0;

        loads.push({ ...current, cpuRatio, cpuPercentage: cpuRatio * 100 });
    }

    return loads.sort((a, b) => b.cpuRatio - a.cpuRatio);
}


export function topProcesses(loads: ProcessLoad[], n: number): ProcessLoad[]
{
    return loads.slice(0, Math.max(0, n));
}


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
export function sortNeedsRss(key: ProcessSortKey): boolean
{
    return key === 'mem';
}


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
export function sortProcesses(
    loads: ProcessLoad[],
    key: ProcessSortKey = 'cpu',
    reverse = false,
): ProcessLoad[]
{
    const direction = reverse ? -1 : 1;

    const compare = (a: ProcessLoad, b: ProcessLoad): number => {
        switch (key) {
            case 'cpu':
                return b.cpuRatio - a.cpuRatio;
            case 'mem':
                return (b.rss ?? 0) - (a.rss ?? 0);
            case 'threads':
                return b.threads - a.threads;
            case 'name':
                return a.comm.localeCompare(b.comm);
            case 'pid':
                return a.pid - b.pid;
        }
    };

    return [...loads].sort((a, b) => {
        const result = compare(a, b) * direction;

        return result !== 0 ? result : a.pid - b.pid;
    });
}


/**
 * Fill in resident memory, which needs a second file per process.
 *
 * Called after the top-N cut so the cost is bounded by what is actually shown
 * rather than by how many processes the machine happens to be running.
 */
export function attachRss(loads: ProcessLoad[], options?: CollectorOptions): ProcessLoad[]
{
    const root = procRoot(options);

    return loads.map(load => {
        const result = readText(`${root}/${load.pid}/status`);

        return result.ok
            ? { ...load, rss: parsePidStatus(result.text).rss }
            : load;
    });
}


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
export function selectProcesses(loads: ProcessLoad[], options: SelectOptions = {}): ProcessLoad[]
{
    const key = options.sort ?? 'cpu';
    const n = options.top ?? 10;

    if (sortNeedsRss(key)) {
        return topProcesses(sortProcesses(attachRss(loads, options), key, options.sortReverse), n);
    }

    return attachRss(topProcesses(sortProcesses(loads, key, options.sortReverse), n), options);
}
