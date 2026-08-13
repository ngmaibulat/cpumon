# cpumon

System monitor library and CLI tool for Node.js. CPU, memory, disk, network,
processes and containers — from the terminal, as JSON, or from your own code.

Requires Node 18 or newer. ESM only — use `import`, not `require`.

> Looking for a full-screen dashboard rather than a stream of lines? That is
> [`cpumon-tui`](https://www.npmjs.com/package/cpumon-tui) — per-core graphs, a
> memory breakdown, network throughput and a sortable, filterable process
> table, built on these same collectors. It is a separate package so that this
> one stays small.
>
> ```sh
> npx cpumon-tui
> ```

## CLI

```sh
npx cpumon@latest
```

One bar per core, refreshed every second, until Ctrl-C.

```sh
npx cpumon@latest --help
```

```
Options:
  -i, --interval <ms>  sampling interval in milliseconds  (default: 1000)
  -n, --count <n>      exit after n samples  (default: run until Ctrl-C)
      --json           emit JSON instead of formatted text
  -o, --overall        print a single machine-wide load line
      --fetch          print a one-shot system summary panel and exit
      --mem            print memory and swap usage and exit
      --load           print the 1/5/15 minute load average and exit
      --disk           print filesystem usage and exit
      --net            show per-interface network throughput
      --proc           show the busiest processes
      --containers     show cgroup limits and container usage
      --mount <path>   filesystem to report disk usage for  (default: the current filesystem root)
      --top <n>        how many rows the table views show  (default: 10)
      --no-color       disable coloured output
  -v, --version        print version and exit
  -h, --help           show this help and exit
```

View flags select *what* to show and are mutually exclusive. `--json` selects
*how*, and combines with any of them — `cpumon --mem --json`, `cpumon --fetch --json`.

`cpumon --fetch` prints a one-shot summary:

```
cpumon 0.4.0
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

`cpumon --proc` is `top`-shaped, with `%CPU` on top's scale:

```
    PID  %CPU        RSS  THR  COMMAND
1542616  99.4    2.3 MiB    1  yes
 587244   5.9  382.3 MiB   19  claude
```

Metrics that a platform cannot provide say so and still exit `0` — `/proc` is
Linux-only, and a container can deny a read that works on the host:

```sh
$ cpumon --net --json          # on macOS
{"available":false,"reason":"unsupported-platform","detail":"/proc/net/dev is Linux-only"}
```

## Library

```sh
npm i cpumon
```

```javascript
import { CpuMonitor, aggregateCpu } from 'cpumon';

const monitor = new CpuMonitor(1000);

monitor.on('cpudata', (load) => {
    console.log(`overall: ${aggregateCpu(load).loadPercentage}%`);
});

monitor.on('error', (err) => console.error(err.message));
```

`cpudata` fires once per sampling interval with one `CpuInfo` per core. Load is
measured as all non-idle CPU time over all CPU time — the figure `top` and
`htop` report. Stop with `monitor.stopMonitor()`; listeners stay attached and
`start()` resumes.

For anything beyond CPU, `SystemMonitor` samples several collectors at once and
owns the baseline bookkeeping that counters like network bytes require:

```javascript
import { SystemMonitor, getMemoryInfo, isAvailable } from 'cpumon';

// point-in-time metrics need no sampling window
console.log(getMemoryInfo().usedPercentage);

const monitor = new SystemMonitor({
    intervalMs: 1000,
    collect: ['cpu', 'memory', 'network'],
});

monitor.on('sample', (snapshot) => {
    if (isAvailable(snapshot.network)) {
        for (const iface of snapshot.network.interfaces) {
            console.log(iface.name, iface.rxBytesPerSec);
        }
    }
});
```

Collectors that cannot succeed everywhere return a `Probe` rather than throwing,
so one missing file never takes down a whole snapshot. Narrow it with
`isAvailable(probe)`, or read `probe.reason` to find out why.

## Documentation

Full docs — CLI reference, library guide, and API reference — live in `docs/`
and are built with [VitePress](https://vitepress.dev):

```sh
npm install
npm run docs:dev      # serve locally
npm run docs:build    # build to docs/.vitepress/dist
```

## Breaking changes

> **0.2.0** — `stopMonitor()` no longer calls `removeAllListeners()`. Your
> handlers now survive a stop, and a stopped monitor can be restarted with
> `start()`. If you relied on `stopMonitor()` to detach handlers, call
> `removeAllListeners()` yourself. Reported percentages are unchanged.

> **0.1.0** — reported percentages have shifted. Load is now measured as *all
> non-idle CPU time over all CPU time*, which matches what `top` and `htop` call
> CPU busy. Earlier versions counted only `user + sys`, so time spent on niced
> processes and interrupt handling was reported as 0% load.

## License

MIT
