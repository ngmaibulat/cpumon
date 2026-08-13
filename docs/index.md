---
layout: home

hero:
  name: cpumon
  text: The machine, at a glance
  tagline: A zero-config CLI and a small ESM library for CPU, memory, disk, network, processes and containers in Node.js.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: CLI reference
      link: /guide/cli
    - theme: alt
      text: Dashboard
      link: /guide/tui
    - theme: alt
      text: API
      link: /api/

features:
  - title: Run it with no install
    details: npx cpumon@latest draws a live bar per core. Flags for memory, load average, disk, network throughput, the busiest processes, and container limits.
  - title: Everything composes with --json
    details: --json is a format, not a view, so any metric can be piped into jq. Machine-readable output has one stable schema on every platform.
  - title: Use it as a library
    details: CpuMonitor and SystemMonitor are plain EventEmitters. Collectors are pure functions you can call directly, and their parsers work on captured data.
  - title: Honest about what it cannot read
    details: /proc is Linux-only and a container can deny a read that works on the host. A collector that cannot answer reports why instead of throwing or inventing a number.
  - title: Numbers that match your other tools
    details: Memory agrees with free -h, disk with df, per-process CPU with top, and container memory with docker stats.
  - title: Small
    details: One runtime dependency, ESM only, Node 18+.
  - title: Or a full-screen dashboard
    details: npx etop draws per-core graphs, a memory breakdown, network throughput and a sortable, filterable process table. A separate package, so the library stays small.
---

```sh
npx cpumon@latest --fetch
```

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

Or pick one metric, in whichever form you need it:

```sh
cpumon --proc --top 5           # the busiest processes, like top
cpumon --net -i 500             # per-interface throughput
cpumon --containers             # cgroup limits and usage
cpumon --mem --json | jq .usedPercentage
```
