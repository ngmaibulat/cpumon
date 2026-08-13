# Changelog

## cpumon-tui 0.1.0

**A full-screen dashboard**, in its own package. CPU with per-core detail,
memory and swap with a composition breakdown, filesystem usage, per-interface
network throughput, an interactive process table and container cgroups — all
from cpumon's existing collectors, drawn with Ink.

It is separate on purpose. `cpumon` stays a small library with one runtime
dependency; the dashboard is an application that brings React with it, and
nobody importing `SystemMonitor` should pay for that. See
[the dashboard guide](/guide/tui).

```sh
npx cpumon-tui
```

Needs Node 22. `cpumon` itself still supports Node 18.

## 0.5.0

Groundwork for the dashboard, and useful on its own.

- **`cpumon/format`** — a new subpath exporting `bytes`, `rate`, `gib`,
  `formatUptime`, `shortId`, `percent` and `duration`. These were locked inside
  `render.ts`, which imports chalk and every collector; the new module imports
  nothing at all. Also re-exported from the barrel. `render.ts` keeps exporting
  `bytes` and `rate`, so nothing that worked before changed.
- **`selectProcesses()`** and a sort key on `SystemMonitorOptions` — the top-N
  cut can now be taken on cpu, memory, pid, name or thread count, in either
  direction.

  The ordering rule is the substance of it. `attachRss()` costs a second file
  read per process, so it belongs *after* the cut — except when the sort key is
  resident memory, where cutting first would rank every row by a field none of
  them has yet and hand back the busiest processes presented as the largest. A
  memory sort now pays for a full pass; no other key does.
- The repository is an npm workspace with two packages, `packages/cpumon` and
  `packages/cpumon-tui`. Nothing about the published `cpumon` tarball changed.

## 0.4.0

**cpumon is a system monitor now, not only a CPU monitor.** Six collectors, six
views, and one new class. Nothing that worked before works differently.

- `--mem` reads `/proc/meminfo` on Linux, so `used` matches `free -h` instead of
  the misleading `total - free`, and honours a container's cgroup memory limit.
- `--load` prints the 1/5/15 minute load average, normalised per core.
- `--disk` reports filesystem usage via `fs.statfs`; `--mount <path>` picks the
  filesystem.
- `--net` reports per-interface throughput from `/proc/net/dev`.
- `--proc` lists the busiest processes; `--top <n>` sets how many.
- `--containers` reports cgroup v2 limits and usage, and detects whether cpumon
  is itself running inside a container.
- New `SystemMonitor` class emitting a combined `sample` snapshot, plus the
  `cpumon/system` subpath. `CpuMonitor` and `cpumon/cpu` are unchanged.
- Collectors that cannot succeed on a platform return a `Probe` instead of
  throwing. The shape reserved in 0.3.0 is finally used.
- `--fetch` grew real Disk and Loadavg rows, a Swap row when swap is configured,
  and a Container row when running inside one.

### `--json` is a format now, not a view

It combines with every view, so `cpumon --mem --json` and `cpumon --fetch --json`
work. `cpumon --json` on its own is unchanged — still one `CpuInfo[]` array per
line.

Two flag pairs that exited `2` in 0.3.0 now succeed: `--json --fetch` and
`--json --overall`. No previously working invocation changed its behaviour.

### The `--fetch` memory figure changed on Linux

It used to be `total - free`, which counts the page cache as used. It is now
`total - available`, matching `free -h`. On a warm machine the new number is
typically 10-15 points lower, and correct.

### Metrics that cannot be read exit 0

A view whose metric is unavailable on this platform prints one greyed line and
exits `0` — it is an answer, not a failure. Status `2` remains reserved for
usage errors.

## 0.3.0

**The CLI takes options.** Previously it had none — the interval was fixed at
one second and the only output was the per-core bar view.

- `--help` / `-h` lists every option; `--version` / `-v` prints the version.
- `--interval <ms>` / `-i` sets the sampling interval.
- `--count <n>` / `-n` exits after `n` samples instead of running forever.
- `--json` emits one JSON array per sample (NDJSON) for piping into other tools.
- `--overall` / `-o` prints a single machine-wide load line.
- `--fetch` prints a one-shot system summary panel.
- `--no-color` disables colour; `NO_COLOR` is honoured too.
- Usage errors now exit with status `2` and a hint, instead of being ignored.
- The screen is only cleared when stdout is a terminal, so redirected bar output
  no longer contains escape sequences.

Nothing in the library API changed.

## 0.2.0

**`stopMonitor()` no longer calls `removeAllListeners()`.** Detaching handlers
the caller registered was surprising, made the monitor single-use, and silently
dropped their `error` listener.

- Handlers survive a stop, and a stopped monitor can be restarted with `start()`.
- Added `close()` as an alias for `stopMonitor()`, and a `running` getter.
- Added the `{ intervalMs, unref }` constructor form. `unref: true` stops the
  sampling timer from holding the process open.
- Added `aggregateCpu()` for a machine-wide figure.

If you relied on `stopMonitor()` to detach handlers, call
`removeAllListeners()` yourself. Reported percentages are unchanged.

## 0.1.0

**Reported percentages shifted.** Load is now measured as *all non-idle CPU time
over all CPU time*, which matches what `top` and `htop` call CPU busy. Earlier
versions counted only `user + sys`, so time spent on niced processes and
interrupt handling was reported as 0% load.
