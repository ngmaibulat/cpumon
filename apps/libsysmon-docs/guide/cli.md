# CLI reference

```sh
cpumon [options]
```

With no options, `cpumon` clears the screen and redraws one bar per core every
second until interrupted.

```
01 [|||||||||                                                                       9%]
02 [||||||||||||||||||||||                                                         22%]
03 [|||                                                                             3%]
...
```

## Options

| Flag | Argument | Default | Description |
| --- | --- | --- | --- |
| `-i`, `--interval` | `<ms>` | `1000` | Sampling interval in milliseconds |
| `-n`, `--count` | `<n>` | run until Ctrl-C | Exit after `n` samples |
| `--json` | | | Emit JSON instead of formatted text |
| `-o`, `--overall` | | | Print a single machine-wide load line |
| `--fetch` | | | Print a one-shot system summary panel and exit |
| `--mem` | | | Print memory and swap usage and exit |
| `--load` | | | Print the 1/5/15 minute load average and exit |
| `--disk` | | | Print filesystem usage and exit |
| `--net` | | | Show per-interface network throughput |
| `--proc` | | | Show the busiest processes |
| `--containers` | | | Show cgroup limits and container usage |
| `--mount` | `<path>` | current filesystem root | Filesystem for `--disk` |
| `--top` | `<n>` | `10` | Rows shown by the table views |
| `--no-color` | | | Disable coloured output |
| `-v`, `--version` | | | Print version and exit |
| `-h`, `--help` | | | Show help and exit |

## Views and formats

Flags fall on two independent axes.

A **view** selects *what* to show: `--overall`, `--fetch`, `--mem`, `--load`,
`--disk`, `--net`, `--proc`, `--containers`, or the per-core bars you get with
no view flag at all. Views are mutually exclusive.

A **format** selects *how* to show it. There is one format flag, `--json`, and
it combines with every view.

```sh
cpumon --mem --json | jq .usedPercentage
cpumon --fetch --json                      # the whole summary, machine readable
```

::: tip Changed in 0.4.0
`--json` used to be a view, which meant `--mem --json` could not be expressed at
all. It is now a format. `cpumon --json` on its own is unchanged — still one
`CpuInfo[]` array per line — but `--json` paired with another view no longer
exits 2.
:::

Three views — `--mem`, `--load` and `--disk` — have nothing to diff, so they
answer immediately instead of waiting a sampling interval. The rest measure a
window and so take at least one `--interval` before their first output.

## Metrics that are not available everywhere

`/proc` is Linux-only, and a container can deny a read that works on the host.
Rather than crash or invent a number, a collector that cannot answer reports why:

```sh
$ cpumon --disk --mount /nope
Disk      unavailable (not-found) — /nope

$ cpumon --disk --json --mount /nope
{"available":false,"reason":"not-found","detail":"/nope"}
```

**This is not an error — it exits 0.** Exit code 2 stays reserved for usage
mistakes. In JSON the probe is emitted verbatim, so a script gets the same
schema on every platform and can branch on `available`.

| View | Linux | macOS | Windows |
| --- | --- | --- | --- |
| `--mem` | `/proc/meminfo`, cgroup-aware | `os` fallback | `os` fallback |
| `--load` | yes | yes | `not-applicable` |
| `--disk` | yes | yes | yes |
| `--net` | yes | `unsupported-platform` | `unsupported-platform` |
| `--proc` | yes | `unsupported-platform` | `unsupported-platform` |
| `--containers` | cgroup v2, v1 partial | `unsupported-platform` | `unsupported-platform` |

### `-i, --interval <ms>`

How long each measurement window is. Shorter intervals react faster but are
noisier — a window shorter than one kernel clock tick can read as 0%.

```sh
cpumon -i 250
```

Must be a positive whole number.

### `-n, --count <n>`

Take `n` samples and exit with status 0, instead of running forever. Useful in
scripts and in CI, where an unbounded process would hang the job.

```sh
cpumon -n 5
```

Remember that each sample costs one interval, so `-i 1000 -n 5` takes about five
seconds.

### `--json`

Writes one JSON array per sample, one sample per line (NDJSON), with no colour
and no screen clearing. Each array holds one object per core.

```sh
cpumon --json -n 1
```

```json
[{"model":"AMD Ryzen 7 7730U","idle":90,"total":100,"load":10,"loadRatio":0.1,"loadPercentage":10}]
```

Because it is line-oriented, it streams into other tools directly:

```sh
cpumon --json -i 500 | jq '[.[].loadPercentage] | add / length'
```

### `-o, --overall`

Collapses all cores into a single figure using
[`aggregateCpu`](/api/#aggregatecpu), which sums raw tick counts rather than
averaging per-core percentages.

```sh
cpumon --overall -i 500
```

```
all [||||||||||||||||                                                              16%]
```

### `--fetch`

A one-shot, fastfetch-style summary of the machine and its current load, then
exit. Implies `--count 1`, so it still waits one interval for a real measurement
window before printing.

```sh
cpumon --fetch
```

```
cpumon 0.5.0
──────────────────────────────────────────────
CPU       AMD Ryzen 7 7730U with Radeon Graphics
Cores     16
Arch      x64
Platform  linux 6.18.32-1-lts
Uptime    4d 19h 20m
Memory    18.7 / 22.3 GiB (83%)
Disk      909.1 / 952.4 GiB (95%) on /
Loadavg   0.43 0.59 0.50  (0.03 per core)
Load      [█░░░░░░░░░░░░░░░] 6%
Per-core  ▁▁▁▁█▁▁▁██▁▁█▁▁▁
```

A `Swap` row appears when swap is configured, and a `Container` row when cpumon
is running inside one. Rows for metrics this platform cannot read are shown
greyed rather than dropped, so a missing figure is never mistaken for a bug.

Pair it with a short interval for a near-instant panel:

```sh
cpumon --fetch -i 200
```

### `--mem`

Memory and swap. On Linux this reads `/proc/meminfo`, so `used` means
`MemTotal - MemAvailable` — the same figure `free -h` reports — rather than
`total - free`, which counts the page cache and reads 10-15 points high on a
warm machine.

```sh
cpumon --mem
```

```
Memory    [██████████████░░] 86%
Used      19.2 GiB of 22.3 GiB
Available 3.1 GiB
Source    meminfo
```

`Source` is shown because it changes what the numbers mean: `meminfo` is the
precise Linux read, `cgroup` means the figures are scoped to a container's own
limit, and `os` is the portable fallback, which has no `MemAvailable` equivalent
and therefore reads high.

Inside a container with a memory limit, the budget is the container's:

```sh
$ docker run --rm -m 512m … cpumon --mem
Memory    [█░░░░░░░░░░░░░░░] 8%
Used      44.8 MiB of 512.0 MiB
Available 467.2 MiB
Source    cgroup
```

### `--load`

The 1/5/15 minute load average, and the same figures divided by core count,
where `1.00` means exactly committed regardless of machine size.

```sh
cpumon --load
```

```
Loadavg   0.44 0.60 0.43
Per core  0.03 0.04 0.03  over 16 cores
```

Not available on Windows, which has no load average at all.

### `--disk` and `--mount <path>`

Filesystem usage for one mount point, defaulting to the root of the current
filesystem — `/` on Linux and macOS, `C:\` on Windows.

```sh
cpumon --disk --mount /home
```

```
Mount     /home
Usage     [███████████████░] 95%
Used      908.3 GiB of 952.4 GiB
Available 44.1 GiB
```

`Used` follows df's rule: the percentage is `used / (used + available)`, so the
blocks a filesystem reserves for root are not offered to you as free space. The
byte figures match `df -B1` exactly; the percentage can read one point lower,
because df rounds up and cpumon floors every percentage it prints.

### `--net`

Per-interface throughput, derived from `/proc/net/dev` over the sampling
interval. Busiest first, with loopback last.

```sh
cpumon --net -i 500
```

```
IFACE                   RX/s         TX/s   RX total   TX total
wlan0            150.4 KiB/s   16.0 KiB/s    6.3 GiB   13.0 GiB
tun0             136.3 KiB/s   10.2 KiB/s  984.8 MiB  687.3 MiB
enp1s0                 0 B/s        0 B/s        0 B        0 B
```

Interfaces come and go — veth, wireguard, docker0 — and an interface that
appeared during the window has no baseline to measure against, so it is skipped
until the next one rather than reported as a spike.

### `--proc` and `--top <n>`

The busiest processes, refreshing like `top`.

```sh
cpumon --proc --top 5
```

```
    PID  %CPU        RSS  THR  COMMAND
1542616  99.4    2.3 MiB    1  yes
1542617  99.4    2.2 MiB    1  yes
 587244   5.9  382.3 MiB   19  claude
   6248   3.9  159.2 MiB   17  gnome-software
```

`%CPU` is on top's scale: 100 is one fully-occupied core, so a multithreaded
process legitimately exceeds 100.

This is the most expensive view — it reads one file per process on every tick.
Resident memory needs a second file per process, so it is fetched only for the
rows that survive the `--top` cut.

### `--containers`

cgroup limits and usage, for every container cgroup this process can see.

```sh
cpumon --containers
```

```
CONTAINER                RUNTIME  %CPU  CPUS       MEM      LIMIT
lxc.payload.super-hound  lxc       0.0  unlimited  27.4 MiB  unlimited
101204468cc9             docker    0.0  unlimited   1.0 GiB  unlimited
158f6c8498ec             docker    0.3  unlimited   2.1 MiB  unlimited
```

`MEM` is the working set — `memory.current` less the reclaimable page cache —
which is what `docker stats` and Kubernetes both report.

Run from **inside** a container, only that container's own cgroup is visible.
That is a property of the cgroup namespace, not an absence of other containers,
and cpumon says so rather than printing an empty list:

```
CONTAINER  RUNTIME  %CPU  CPUS       MEM      LIMIT
self       docker    0.7   1.5  45.3 MiB  512.0 MiB

running inside a container: only this cgroup is visible
```

Sibling enumeration needs cgroup v2; on v1 only the process's own cgroup is
reported.

### `--no-color`

Disables all ANSI colour. The standard `NO_COLOR` environment variable is
honoured as well, so `NO_COLOR=1 cpumon` has the same effect.

```sh
cpumon --no-color -n 1 > load.txt
```

### `-v, --version` and `-h, --help`

Print the installed version, or the full option list, and exit 0.

## Behaviour worth knowing

- **Screen clearing only happens on a terminal.** In the default bar mode the
  screen is cleared before each frame, but only when stdout is a TTY — piping or
  redirecting the output keeps escape sequences out of the destination.
- **Ctrl-C exits cleanly** with status 0.
- **Sampling errors do not kill the process.** A failed sample prints
  `cpumon: <message>` to stderr and the next frame carries on.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Finished normally — `--help`, `--version`, `--count` reached, Ctrl-C, or a metric this platform cannot read |
| `2` | Usage error — unknown flag, missing value, invalid number, or two view flags |

Usage errors print the problem and a hint to stderr:

```sh
$ cpumon --bogus
cpumon: Unknown option '--bogus'
Try 'cpumon --help' for the list of options.
```

## Recipes

Average load across all cores, once:

```sh
cpumon --json -n 1 | jq '[.[].loadPercentage] | add / length'
```

Fail a script if the machine is busier than 80%:

```sh
load=$(cpumon --json -n 1 | jq '[.[].loadPercentage] | add / length')
[ "${load%.*}" -lt 80 ] || { echo "machine too busy"; exit 1; }
```

Log a machine-wide line every five seconds:

```sh
cpumon --overall -i 5000 --no-color >> cpu.log
```

Memory pressure as a single number:

```sh
cpumon --mem --json | jq .usedPercentage
```

Fail a deploy when the root filesystem is nearly full, handling the case where
the metric cannot be read at all:

```sh
disk=$(cpumon --disk --json)
if [ "$(echo "$disk" | jq .available)" = "true" ]; then
    [ "$(echo "$disk" | jq .disk.usedPercentage)" -lt 90 ] || { echo "disk nearly full"; exit 1; }
fi
```

Record the whole machine once a minute as newline-delimited JSON:

```sh
while sleep 60; do cpumon --fetch --json -i 200; done >> system.ndjson
```

The single busiest process right now:

```sh
cpumon --proc --json --top 1 -n 1 | jq -r '.processes[0] | "\(.comm) \(.cpuPercentage)"'
```
