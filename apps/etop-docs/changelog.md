# Changelog

::: info The dashboard was renamed before its first release
It was developed as `cpumon-tui` and is published as `etop`. Nothing shipped
under the old name, so there is no migration to do.

The library it is built on was renamed at the same time, from `cpumon` to
[`libsysmon`](https://github.com/ngmaibulat/cpumon/tree/main/packages/libsysmon).
The command that library installs is still `cpumon`, which is why `etop` points
at `cpumon --json` when it cannot draw.
:::

## 0.1.0

**A full-screen dashboard**, in its own package. CPU with per-core detail,
memory and swap with a composition breakdown, filesystem usage, per-interface
network throughput, an interactive process table and container cgroups — all
from libsysmon's existing collectors, drawn with Ink.

It is separate on purpose. `libsysmon` stays a small library with one runtime
dependency; the dashboard is an application that brings React with it, and
nobody importing `SystemMonitor` should pay for that. See
[getting started](/guide/getting-started).

```sh
npx etop
```

Needs Node 22. `libsysmon` itself still supports Node 18.
