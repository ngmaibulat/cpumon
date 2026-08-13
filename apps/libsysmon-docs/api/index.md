# API reference

Everything on this page is exported from the package root:

```javascript
import { CpuMonitor, getCpuInfo, aggregateCpu } from 'libsysmon';
```

## `CpuMonitor`

An `EventEmitter` that samples CPU tick counters on an interval.

```typescript
new CpuMonitor(options: number | CpuMonitorOptions)
```

A number is treated as the interval in milliseconds. **Sampling starts
immediately** — the constructor calls `start()` for you.

```javascript
new CpuMonitor(1000);
new CpuMonitor({ intervalMs: 1000, unref: true });
```

### Events

| Event | Payload | When |
| --- | --- | --- |
| `cpudata` | `CpuInfo[]` | Once per interval, one entry per core |
| `error` | `Error` | A sample failed; the next tick continues normally |

An `error` event with no listener is rethrown by `EventEmitter` and crashes the
process — always attach a handler.

### Methods

#### `start(): void`

Begin sampling. Safe on an already-running monitor: it returns without stacking
a second interval. After a `stopMonitor()`, it re-reads the baseline so the first
sample measures the new window rather than the idle gap.

#### `stopMonitor(): void`

Stop sampling. Listeners stay attached and the monitor can be restarted.

#### `close(): void`

Alias for `stopMonitor()`, matching the usual Node resource vocabulary.

#### `getCpuInfo(): CpuInfo[]`

Instance form of the [free function](#getcpuinfo) of the same name.

#### `getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[]`

Instance form of the [free function](#getcpudiff) of the same name.

#### `measureCpu(): void`

Take one sample and emit the result. Called by the internal timer; you rarely
need it, but it is public and safe — it never throws, it emits `error` instead.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `running` | `boolean` | Whether the timer is active (getter) |
| `ms` | `number` | The configured interval |
| `intervalId` | `NodeJS.Timeout \| null` | The timer handle, `null` while stopped |
| `current` | `CpuInfo[]` | The last raw reading, used as the next baseline |

## Functions

### `getCpuInfo()`

```typescript
getCpuInfo(): CpuInfo[]
```

One `CpuInfo` per logical core, straight from `os.cpus()`. These are **counters
since boot** — subtract two readings with `getCpuDiff` to get a usable load
figure. `loadRatio` and `loadPercentage` are absent here, because a single
reading has no window to compute them over.

### `getCpuDiff()`

```typescript
getCpuDiff(prev: CpuInfo[], current: CpuInfo[]): CpuInfo[]
```

Subtracts two readings and fills in `loadRatio` and `loadPercentage` for the
window between them. Throws if the two arrays have different lengths — a core
count change means the entries no longer line up.

### `toCpuInfo()`

```typescript
toCpuInfo(model: string, times: CpuTimes): CpuInfo
```

Converts one raw `os.cpus()` entry into a `CpuInfo`. Every field of `times`
counts towards `total`, so `nice` and `irq` are included and a future Node
release adding a field is picked up automatically. `load` is `total - idle`.

### `withLoadRatio()`

```typescript
withLoadRatio(info: CpuInfo): CpuInfo
```

Returns a copy with `loadRatio` and `loadPercentage` derived from the tick
counts. `loadPercentage` is floored and clamped to `0..100`. An empty window
(`total === 0`) reports `0` rather than dividing into `NaN`.

Used internally by `getCpuDiff` and `aggregateCpu` so per-core and aggregate
figures always round identically.

### `aggregateCpu()`

```typescript
aggregateCpu(cores: CpuInfo[]): CpuInfo
```

Collapses per-core samples into one machine-wide figure by summing the raw tick
counts — not by averaging the percentages, which would weight an idle core the
same as a saturated one. Throws on an empty array. `model` is taken from the
first core.

```javascript
monitor.on('cpudata', (load) => {
    console.log(aggregateCpu(load).loadPercentage);
});
```

### `unavailable()`

```typescript
unavailable(reason: UnavailableReason, detail?: string): Unavailable
```

Builds the failure branch of a [`Probe`](#probe-t). `detail` is omitted from the
result entirely when not supplied.

### `isAvailable()`

```typescript
isAvailable<T>(probe: Probe<T>): probe is { available: true } & T
```

Type guard that narrows a `Probe<T>` to its success branch.

## Types

### `CpuInfo`

```typescript
type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
};
```

`idle`, `load` and `total` are tick counts. In a `cpudata` payload they describe
the sampling window; in a bare `getCpuInfo()` result they are counters since
boot. The two optional fields are present only once a window has been computed,
which is why CLI code writes `cpu.loadPercentage ?? 0`.

### `CpuTimes`

```typescript
type CpuTimes = {
    user: number;
    nice: number;
    sys: number;
    idle: number;
    irq: number;
};
```

The shape of `os.cpus()[n].times`.

### `CpuMonitorOptions`

```typescript
type CpuMonitorOptions = {
    intervalMs: number;
    unref?: boolean;
};
```

`unref` defaults to `false`, so a monitor keeps the process alive exactly like a
plain `setInterval`. Set it to `true` to let the process exit while monitoring.

### `Probe<T>`

```typescript
type Probe<T> = ({ available: true } & T) | Unavailable;
```

Shared vocabulary for collectors that cannot succeed everywhere — `/proc` and
`/sys` are Linux-only, and a container can deny a read that works on the host.
Rather than throwing, such a collector returns a `Probe` and lets the caller
decide.

The success branch is flattened rather than nested under a `value` key, so JSON
output and CLI templates can address fields directly (`mem.usedRatio`, not
`mem.value.usedRatio`), and `available` doubles as the discriminant.

::: warning Two things `Probe<T>` cannot wrap
**An array.** `Probe<Foo[]>` type-checks — it resolves to
`{ available: true } & Foo[]` — but `JSON.stringify` of an array drops every
non-index property, so `available` disappears exactly where a `--json` consumer
needs it.

**A payload with its own `available` field.** The spread overwrites the
discriminant. [`MemoryInfo`](#memoryinfo) is the live example: it carries the
kernel's `MemAvailable` under that name.

In both cases, wrap the payload in a named key —
`Probe<{ processes: ProcessLoad[] }>`, `Probe<{ disk: DiskInfo }>`. In practice
wrapping wins nearly every time; treat flattening as the exception to justify.
:::

### `Unavailable`

```typescript
type Unavailable = {
    available: false;
    reason: UnavailableReason;
    detail?: string;
};
```

### `UnavailableReason`

```typescript
type UnavailableReason =
    | 'unsupported-platform'
    | 'permission-denied'
    | 'not-found'
    | 'parse-error'
    | 'not-applicable';
```

## Collectors

Every collector splits into a pure `parseX(text)` and a thin reader that does no
parsing. Both halves are exported: the parsers are the reusable part when the
data comes from somewhere other than this machine's `/proc`, and they are what
lets the test suite run on a machine that has no `/proc` at all.

Readers never throw. A missing file, a denied read and an unimplemented kernel
interface all come back as an [`Unavailable`](#unavailable).

### `CollectorOptions`

```typescript
type CollectorOptions = {
    procRoot?: string;    // default '/proc'
    sysfsRoot?: string;   // default '/sys/fs/cgroup'
    clockTicks?: number;  // default 100
};
```

Every reader accepts this. Pointing `procRoot` at a fixture directory runs the
whole collector against captured data, on any platform.

### Memory

```typescript
function getMemoryInfo(options?: CollectorOptions): MemoryInfo;
function readMeminfo(options?: CollectorOptions): Probe<{ memory: MemoryInfo }>;
function parseMeminfo(text: string): Map<string, number>;
function toMemoryInfo(fields: Map<string, number>, source: MemorySource): MemoryInfo;
function withCgroupLimit(memory: MemoryInfo, limit: CgroupLimits | null): MemoryInfo;
function osMemoryInfo(): MemoryInfo;
```

`getMemoryInfo` is **not** a `Probe`: `os.totalmem()`/`os.freemem()` work
everywhere, so there is no failure branch for a caller to handle. Fidelity is
reported in `source` instead, degrading `meminfo` → `cgroup` → `os`.

#### `MemoryInfo`

```typescript
type MemorySource = 'meminfo' | 'cgroup' | 'os';

type MemoryInfo = {
    source: MemorySource;
    total: number;      // bytes
    free: number;
    available: number;  // MemAvailable
    buffers: number;
    cached: number;
    used: number;       // total - available, as `free -h` defines it
    usedRatio: number;
    usedPercentage: number;
    swapTotal: number;
    swapFree: number;
    swapUsed: number;
};
```

`used` is `total - available`, not `total - free`. The latter counts the page
cache and reads 10-15 points high on a warm machine.

The `cgroup` source is applied only when the container's `memory.max` is finite
**and strictly below** what meminfo reported — lxcfs already scopes
`/proc/meminfo` inside a container, and without the strict comparison the
figures would be corrected twice.

### Load average

```typescript
function getLoadAverage(): Probe<LoadAverage>;
function toLoadAverage(avg: readonly [number, number, number], cores: number): LoadAverage;

type LoadAverage = {
    one: number; five: number; fifteen: number;
    cores: number;
    onePerCore: number; fivePerCore: number; fifteenPerCore: number;
};
```

Unavailable with reason `not-applicable` on Windows, where `os.loadavg()`
returns `[0, 0, 0]` and would render as a permanently idle machine.

### Disk

```typescript
function getDiskUsage(mount?: string): Probe<{ disk: DiskInfo }>;
function toDiskInfo(mount: string, stats: StatFsLike): DiskInfo;
function defaultMount(): string;
```

`defaultMount()` is the root of the current filesystem, so a bare `getDiskUsage()`
is correct on Windows too. `usedRatio` is `used / (used + available)`, df's rule,
which keeps root-reserved blocks out of the free figure.

Requires `fs.statfsSync`, added in Node 18.15. On anything older this reports
`unsupported-platform` rather than throwing — `engines` stays at `>=18`.

### Network

```typescript
function getNetworkCounters(options?: CollectorOptions): Probe<NetworkCounters>;
function parseNetDev(text: string): InterfaceCounters[];
function diffNetwork(prev: NetworkCounters, next: NetworkCounters, elapsedMs: number): NetworkRates;
```

`diffNetwork` matches interfaces by name and deliberately does **not** require
the two samples to line up, the way [`getCpuDiff`](#getcpudiff) does — veth and
tunnel interfaces appear and vanish constantly. An interface with no baseline is
skipped until the next window, and a negative delta (counter reset on link
down/up) is clamped to zero.

### Processes

```typescript
function getProcessCounters(options?: CollectorOptions): Probe<ProcessSnapshot>;
function parsePidStat(text: string): ProcessCounters | null;
function parsePidStatus(text: string): { name: string; rss: number };
function parseStatTotal(text: string): number | null;
function diffProcesses(prev: ProcessSnapshot, next: ProcessSnapshot): ProcessLoad[];
function topProcesses(loads: ProcessLoad[], n: number): ProcessLoad[];
function attachRss(loads: ProcessLoad[], options?: CollectorOptions): ProcessLoad[];
```

`cpuPercentage` is on top's scale — 100 is one fully-occupied core — and is
derived as a ratio against the machine's own total jiffies over the same window,
which cancels `USER_HZ` out of the arithmetic entirely.

`parsePidStat` extracts the process name as everything between the **first** `(`
and the **last** `)`. A name can contain spaces and close-parens, and splitting
the line on whitespace shifts every later field, silently corrupting `utime` and
`stime` rather than failing.

`attachRss` is separate because resident memory needs a second file per process;
call it after `topProcesses` so the cost is bounded by what you display.

### Cgroups and containers

```typescript
function detectContainer(options?: CollectorOptions): Probe<ContainerRuntimeInfo>;
function getContainerInfo(options?: CollectorOptions): Probe<ContainerInfo>;
function listContainers(options?: CollectorOptions): Probe<{ containers: ContainerInfo[]; scope: 'host' | 'namespaced' }>;
function diffContainerCpu(prev: CgroupCpuStat, next: CgroupCpuStat, elapsedMs: number): { cpuRatio: number; cpuPercentage: number };

function detectCgroupVersion(options?: CollectorOptions): CgroupVersion;
function readSelfLimits(options?: CollectorOptions): CgroupLimits | null;
function parseSelfCgroup(text: string): { version: CgroupVersion; path: string } | null;
function parseCpuMax(text: string): { quotaUsec: number | null; periodUsec: number };
function parseMemoryMax(text: string): number | null;
```

v1 and v2 differ in file names, layout, units and how "unlimited" is spelled;
all of it is normalised so callers see one shape.

|  | cgroup v2 | cgroup v1 |
| --- | --- | --- |
| self | `0::/path` | `N:subsys:/path` per controller |
| cpu usage | `cpu.stat` `usage_usec` (µs) | `cpuacct.usage` (**ns**) |
| cpu limit | `cpu.max` | `cpu.cfs_quota_us` (`-1`) + `cpu.cfs_period_us` |
| mem limit | `memory.max` (`max`) | `memory.limit_in_bytes` (`2^63-4096`) |

`CgroupLimits.memoryCurrent` is the working set — `memory.current` less the
reclaimable page cache — matching `docker stats` and Kubernetes.
`memoryTotal` is the raw kernel figure.

`listContainers` reports `scope`. Inside a cgroup namespace — the normal case
for Docker, Podman and Kubernetes — `/sys/fs/cgroup` *is* your own cgroup and
every other container is invisible. That is reported as `scope: 'namespaced'`
with your own entry, never as an empty host. Sibling enumeration requires
cgroup v2.

## `SystemMonitor`

```typescript
import { SystemMonitor } from 'libsysmon';        // or 'libsysmon/system'

const mon = new SystemMonitor({ intervalMs: 1000, collect: ['cpu', 'memory', 'network'] });

mon.on('sample', snapshot => console.log(snapshot.network));
mon.on('error', err => console.error(err));
```

Network bytes, per-process jiffies and cgroup CPU time are cumulative counters:
a single reading says nothing, and a rate needs two plus the time between them.
`SystemMonitor` owns that baseline bookkeeping so the collectors can stay pure.

The event is **`sample`**, not `cpudata` — a different payload under a familiar
name would be a trap for anyone swapping the two classes.
[`CpuMonitor`](#cpumonitor) is untouched and remains the cheap CPU-only path.

`elapsedMs` on each snapshot is measured from the clock rather than assumed from
`intervalMs`, because `setInterval` drifts and every derived rate would inherit
the error.

Lifecycle — `start()`, `stopMonitor()`, `close()`, `running`, `unref` — matches
`CpuMonitor` exactly, including that stopping does not detach your listeners.

### `sampleSystem(options?)`

A one-shot snapshot of everything that needs no window, for `memory`, `load` and
`disk`. No timer is created and nothing is awaited.

## Subpath exports

| Specifier | Contents |
| --- | --- |
| `libsysmon` | Everything on this page |
| `libsysmon/cpu` | The `CpuMonitor` module directly |
| `libsysmon/system` | The `SystemMonitor` module directly |
| `libsysmon/package.json` | The manifest |
