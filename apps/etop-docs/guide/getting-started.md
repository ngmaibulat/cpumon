# Getting started

`etop` is a full-screen terminal dashboard built on the same collectors as the
`cpumon` CLI: CPU with per-core detail, memory and swap, filesystem usage,
per-interface network throughput, an interactive process table, and container
cgroups.

```sh
npx @aibulat/etop
```

## Install (optional)

The `npx` line above needs no install. If you want a shorter command:

```sh
npm install -g @aibulat/etop     # then just: etop
```

Node 22 or newer. `libsysmon` itself still supports Node 18.

## Why it is a separate package

`libsysmon` is a small library with one runtime dependency; the dashboard is an
application that brings React and a terminal renderer with it, and nobody
importing `SystemMonitor` should have to carry that weight.

`etop` depends on `libsysmon`; nothing depends on the dashboard.

If you want output you can pipe or script against rather than a screen to look
at, use the `cpumon` CLI that `libsysmon` installs —
`npx -p libsysmon cpumon --json` is a stream of samples as NDJSON, and
`npx -p libsysmon cpumon --fetch` is a one-shot summary. (The package is
`libsysmon` but the command is `cpumon`, so `npx cpumon` on its own does not
reach it.)

## Where to go next

- [Options](/guide/options) — the command line flags
- [Keys](/guide/keys) — everything you can press, also available on `?`
- [Using the dashboard](/guide/panels) — pausing, filtering and sending signals
- [Terminals and platforms](/guide/terminals) — what adapts, and what disappears
