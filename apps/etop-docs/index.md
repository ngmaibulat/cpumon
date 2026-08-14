---
layout: home

hero:
  name: etop
  text: The machine, full screen
  tagline: CPU per core, memory and swap, disks, network throughput, an interactive process table and container cgroups — in your terminal.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Keys
      link: /guide/keys
    - theme: alt
      text: GitHub
      link: https://github.com/ngmaibulat/cpumon

features:
  - title: Every panel, one screen
    details: Per-core CPU graphs, a memory composition breakdown, filesystem usage, per-interface throughput, the busiest processes and container limits — laid out to fit whatever terminal you have.
  - title: An interactive process table
    details: Sort by cpu, memory, pid, name or threads. Filter incrementally by name or pid. Expand a row for the full picture. Send a signal, if you started with --allow-kill.
  - title: It adapts, rather than assuming
    details: Truecolor, 256-colour, 16-colour and monochrome themes. Block, braille or ASCII graphs. Panels are dropped whole rather than squeezed, and a non-UTF-8 locale gets a frame with nothing outside ASCII in it.
  - title: Honest about what it cannot see
    details: A panel disappears only when the concept does not exist on your platform. A read that failed for a reason you could act on keeps its panel and says what happened.
---

```sh
npx @aibulat/etop
```

Node 22 or newer. Built on [`libsysmon`](https://github.com/ngmaibulat/cpumon/tree/main/packages/libsysmon)'s
collectors — the same numbers its `cpumon` CLI reports, drawn rather than printed.
