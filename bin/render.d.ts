/**
 * Output modes for the CLI.
 *
 * Every renderer takes a CpuInfo[] sample and returns a string - none of them
 * write to a stream, so they stay testable and the runner keeps sole control of
 * clearing, ordering and exit.
 *
 * Like utils.ts, this module is NOT re-exported from src/index.ts: it imports
 * chalk, and the barrel deliberately stays colour-library free (see the comment
 * at the top of src/index.ts).
 */
import type { CpuInfo } from './CpuMonitor.js';
import type { Probe } from './types.js';
import type { DiskInfo } from './collectors/disk.js';
import type { LoadAverage } from './collectors/loadavg.js';
import type { MemoryInfo } from './collectors/memory.js';
import type { NetworkRates } from './collectors/network.js';
import type { ProcessLoad } from './collectors/process.js';
import type { ContainerInfo } from './collectors/container.js';
export declare function renderBars(load: CpuInfo[]): string;
export declare function renderOverall(load: CpuInfo[]): string;
/**
 * One sample per line (NDJSON), uncoloured, so `cpumon --json | jq` works and a
 * long-running stream can be consumed a line at a time.
 *
 * Takes the already-selected subject rather than a CpuInfo[], because --json is
 * a format that composes with every view, not a view of its own.
 */
export declare function renderJson(value: unknown): string;
/** auto-scaled size, for values whose magnitude is not known in advance */
export declare function bytes(value: number): string;
export declare function rate(bytesPerSec: number): string;
/**
 * One label/value row for a probe, or null when the row should not appear.
 *
 * The panel is a diagnostic surface, so a failed read is shown rather than
 * hidden: a silently missing Disk row is indistinguishable from a bug, whereas
 * "unavailable (permission-denied)" is one search away from a fix. The single
 * exception is 'not-applicable', which means the concept does not exist on this
 * platform at all - printing "Loadavg unavailable" on every Windows run would
 * be pure noise.
 */
export declare function probeRow<T>(label: string, probe: Probe<T>, format: (value: T) => string): string | null;
/**
 * Memory and swap, as a standalone view.
 *
 * `source` is shown because it changes what the numbers mean: on the 'os' path
 * there is no MemAvailable equivalent, so `used` includes the page cache and
 * reads high. Hiding that would make the same command silently mean two
 * different things on two machines.
 */
export declare function renderMemory(memory: MemoryInfo): string;
export declare function renderLoad(probe: Probe<LoadAverage>): string;
export declare function renderDisk(probe: Probe<{
    disk: DiskInfo;
}>): string;
/**
 * An aligned table. Columns are sized to their widest cell, and every column
 * after the first is right-aligned unless told otherwise, which is what keeps
 * a column of byte rates readable.
 */
export declare function table(headers: string[], rows: string[][], align?: ('l' | 'r')[]): string;
export declare function renderNetwork(probe: Probe<NetworkRates>): string;
export declare function renderProcesses(probe: Probe<{
    processes: ProcessLoad[];
}>): string;
export declare function renderContainers(probe: Probe<{
    containers: ContainerInfo[];
    scope: 'host' | 'namespaced';
}>): string;
export type FetchOptions = {
    /** filesystem the Disk row reports on */
    mount?: string;
};
/**
 * The data behind the --fetch panel, for `--fetch --json`.
 *
 * Probes are emitted verbatim, `available: false` and all, so a consumer gets
 * one stable schema whatever the platform can actually read - which is the
 * whole reason collectors return probes rather than throwing.
 */
export declare function fetchSnapshot(load: CpuInfo[], options?: FetchOptions): {
    version: string;
    cpu: {
        model: string;
        cores: number;
        overall: CpuInfo;
        perCore: CpuInfo[];
    };
    arch: string;
    platform: NodeJS.Platform;
    release: string;
    uptime: number;
    memory: MemoryInfo;
    disk: Probe<{
        disk: DiskInfo;
    }>;
    loadavg: Probe<LoadAverage>;
};
/**
 * A fastfetch-style snapshot: aligned label/value rows, no ASCII logo. Unlike
 * the other renderers this mixes in static system facts, so it is only useful
 * as a one-shot - the runner defaults --fetch to a single sample.
 *
 * The memory figure comes from the collector rather than os.freemem(), so on
 * Linux it counts the page cache as reclaimable and agrees with `free -h`. The
 * old inline reading of total - free ran 10-15 points high on a warm machine.
 */
export declare function renderFetch(load: CpuInfo[], options?: FetchOptions): string;
