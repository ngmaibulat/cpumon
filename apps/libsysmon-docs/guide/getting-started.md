# Getting started

`libsysmon` is two things in one package: a command line tool that shows CPU
load per core, and a small library that reports the same numbers to your own
code.

The package is `libsysmon`; the command it installs is `cpumon`. So
`npm i -g libsysmon` gives you `cpumon` on your path, and a one-off run needs
`npx -p libsysmon cpumon` rather than `npx cpumon`.

## Requirements

- **Node 18 or newer.** The package declares `"engines": { "node": ">=18" }`.
- **ESM only.** There is no CommonJS build — use `import`, not `require()`.
- TypeScript users need `@types/node` installed, because `CpuMonitor` extends
  the standard `EventEmitter`.

## Run the CLI

No install required:

```sh
npx -p libsysmon cpumon
```

That draws one bar per core and refreshes every second until you press Ctrl-C.
Every option is listed by:

```sh
npx -p libsysmon cpumon --help
```

See the [CLI reference](./cli) for what each flag does.

To install it permanently:

```sh
npm install -g libsysmon
cpumon --fetch
```

## Install as a dependency

```sh
npm install libsysmon
```

## First sample

```javascript
import { CpuMonitor } from 'libsysmon';

const monitor = new CpuMonitor(1000);

monitor.on('cpudata', (load) => {
    console.log(load[0].loadPercentage);
});
```

`cpudata` fires once per interval with one entry per core. The constructor
argument is the sampling interval in milliseconds, and monitoring starts
immediately — there is no separate `start()` call to make.

In TypeScript, the payload is typed:

```typescript
import { CpuMonitor } from 'libsysmon';
import type { CpuInfo } from 'libsysmon';

const monitor = new CpuMonitor(1000);

monitor.on('cpudata', (load: CpuInfo[]) => console.log(load));
```

## What "load" means

A sample compares two readings of the kernel's CPU tick counters. Load is
**all non-idle time over all time** in that window — user, nice, sys and irq —
which is the same figure `top` and `htop` call CPU busy.

The first `cpudata` event therefore arrives one interval after construction, not
immediately: there is nothing to compare against until then.

## Where to go next

- [CLI reference](./cli) — every flag, with examples and exit codes.
- [Library guide](./library) — lifecycle, error handling, aggregate load.
- [API reference](/api/) — every exported function and type.
