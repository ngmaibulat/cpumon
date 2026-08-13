# Library guide

`CpuMonitor` is a standard Node `EventEmitter` that samples `os.cpus()` on an
interval and reports the difference between consecutive readings.

## Events

### `cpudata`

Fires once per interval with a `CpuInfo[]` — one entry per logical core, in the
order the operating system reports them.

```javascript
import { CpuMonitor } from 'libsysmon';

const monitor = new CpuMonitor(1000);

monitor.on('cpudata', (load) => {
    load.forEach((cpu, i) => console.log(`core ${i}: ${cpu.loadPercentage}%`));
});
```

Each entry describes the **window**, not the machine's lifetime: `idle`, `load`
and `total` are tick deltas since the previous sample.

### `error`

Sampling failures are reported through the standard `error` event rather than
thrown from the internal timer. As usual for an `EventEmitter`, an `error` event
with no listener is rethrown and will crash the process, so attach one:

```javascript
monitor.on('error', (err) => console.error(err.message));
```

## How load is measured

Every field of the kernel's tick counters — `user`, `nice`, `sys`, `irq`,
`idle` — counts towards `total`, and load is everything that is not idle. That
matches what `top` and `htop` call CPU busy, and it means niced processes and
interrupt handling are not silently reported as idle.

Two details follow from that:

- The **first** `cpudata` arrives one interval after construction. There is no
  earlier reading to diff against.
- A window shorter than one clock tick can be empty. That reports `0`, not
  `NaN` — the division is guarded.

If the core count changes mid-run (CPU hotplug, a cgroup change), the monitor
resyncs its baseline and skips that one tick rather than comparing arrays of
different lengths.

## Lifecycle

Monitoring starts in the constructor. After that:

```javascript
monitor.stopMonitor();   // stop sampling
monitor.running;         // false
monitor.start();         // resume, re-reading the baseline first
monitor.close();         // alias for stopMonitor()
```

`start()` is idempotent — calling it on a running monitor does nothing rather
than stacking a second interval. Restarting re-reads the baseline, so the first
sample after a restart measures the new window and not the gap.

Stop after five minutes:

```javascript
setTimeout(() => monitor.stopMonitor(), 5 * 60 * 1000);
```

::: warning Changed in 0.2.0
`stopMonitor()` no longer calls `removeAllListeners()`. Your handlers survive a
stop, and a stopped monitor can be restarted. If you relied on the old behaviour
to detach handlers, call `removeAllListeners()` yourself.
:::

## Keeping the process alive, or not

By default the sampling timer holds the process open, exactly like a plain
`setInterval`. If you are observing an application you do not own and do not want
to change when it exits, pass `unref`:

```javascript
const monitor = new CpuMonitor({ intervalMs: 1000, unref: true });
```

The constructor accepts either a number (interval in ms) or an options object,
so existing `new CpuMonitor(1000)` code is unaffected.

## Overall load across all cores

`cpudata` reports each core separately. To collapse that into one machine-wide
number, use `aggregateCpu` — it sums the raw tick counts rather than averaging
the per-core percentages, so a core that was busy for a short window does not
count the same as one busy for a long one:

```javascript
import { CpuMonitor, aggregateCpu } from 'libsysmon';

const monitor = new CpuMonitor(1000);

monitor.on('cpudata', (load) => {
    console.log(`overall: ${aggregateCpu(load).loadPercentage}%`);
});
```

## One-off readings without a monitor

If you do not want an interval at all, sample twice yourself:

```javascript
import { getCpuInfo, getCpuDiff, aggregateCpu } from 'libsysmon';

const before = getCpuInfo();

setTimeout(() => {
    const load = getCpuDiff(before, getCpuInfo());
    console.log(aggregateCpu(load).loadPercentage);
}, 1000);
```

`getCpuInfo()` on its own returns counters since boot, which describe the
machine's whole uptime — rarely what you want. The interesting number is always
a difference between two readings.

## Beyond CPU

Point-in-time metrics need no sampling window and no monitor at all:

```javascript
import { getMemoryInfo, getLoadAverage, getDiskUsage, isAvailable } from 'libsysmon';

console.log(getMemoryInfo().usedPercentage);   // always answers

const disk = getDiskUsage('/home');

if (isAvailable(disk)) {
    console.log(disk.disk.usedPercentage);
}
```

Counters — network bytes, per-process jiffies, cgroup CPU time — need two
readings and the time between them. `SystemMonitor` owns that bookkeeping:

```javascript
import { SystemMonitor, isAvailable } from 'libsysmon';

const monitor = new SystemMonitor({
    intervalMs: 1000,
    collect: ['cpu', 'memory', 'network', 'process'],
    top: 5,
});

monitor.on('sample', (snapshot) => {
    console.log(snapshot.cpuOverall.loadPercentage, snapshot.memory.usedPercentage);

    if (isAvailable(snapshot.processes)) {
        for (const p of snapshot.processes.processes) {
            console.log(p.comm, p.cpuPercentage.toFixed(1));
        }
    }
});

monitor.on('error', (err) => console.error(err.message));
```

The event is **`sample`**, not `cpudata`. The lifecycle — `start()`,
`stopMonitor()`, `close()`, `running`, `unref` — is identical to `CpuMonitor`'s,
including that stopping leaves your listeners attached.

`collect` is worth setting: it stops `--net`-style work from scanning every
process, and vice versa. It defaults to `['cpu', 'memory', 'load']`.

## Handling metrics that are not available

`/proc` is Linux-only, `statfs` needs Node 18.15, and a container can deny a
read that works on the host. Rather than throw — which would make one missing
file fatal to an entire snapshot — those collectors return a `Probe`:

```javascript
import { getNetworkCounters, isAvailable } from 'libsysmon';

const net = getNetworkCounters();

if (isAvailable(net)) {
    console.log(net.interfaces.length);
}
else {
    console.log(`no network counters: ${net.reason}`);   // e.g. unsupported-platform
}
```

`isAvailable` is a type guard, so the success branch narrows properly in
TypeScript. See [`Probe<T>`](/api/#probe-t) for the two shapes it cannot wrap.

Memory is the exception: it is **not** a `Probe`, because `os.totalmem()` and
`os.freemem()` work everywhere. Check `memory.source` to know how good the
numbers are — `meminfo` is the precise Linux read, `cgroup` is scoped to a
container's limit, and `os` is the portable fallback.

## Working with captured data

Every collector splits into a reader and a pure parser, and both are exported.
The parsers take text, so they work on data from anywhere — a remote agent, a
log, a fixture:

```javascript
import { parseMeminfo, toMemoryInfo, parsePidStat } from 'libsysmon';

const memory = toMemoryInfo(parseMeminfo(capturedMeminfoText), 'meminfo');
const counters = parsePidStat(capturedStatLine);
```

Readers accept a `CollectorOptions` with `procRoot` and `sysfsRoot`, so a whole
collector can be pointed at a captured tree:

```javascript
getMemoryInfo({ procRoot: './fixtures/proc' });
```

## Entry points

| Import | Contents |
| --- | --- |
| `libsysmon` | The public API: both monitors, every collector, and the shared types |
| `libsysmon/cpu` | The `CpuMonitor` module directly |
| `libsysmon/system` | The `SystemMonitor` module directly |

The renderers are deliberately **not** part of the public API: they import
`chalk`, and keeping them out of the barrel means a consumer who only wants the
numbers does not pay for a terminal colour library. Use the [CLI](./cli) if you
want the rendered output.
