# Getting started

`cpumon` is two things in one package: a command line tool that shows CPU load
per core, and a small library that reports the same numbers to your own code.

## Requirements

- **Node 18 or newer.** The package declares `"engines": { "node": ">=18" }`.
- **ESM only.** There is no CommonJS build — use `import`, not `require()`.
- TypeScript users need `@types/node` installed, because `CpuMonitor` extends
  the standard `EventEmitter`.

## Run the CLI

No install required:

```sh
npx cpumon@latest
```

That draws one bar per core and refreshes every second until you press Ctrl-C.
Every option is listed by:

```sh
npx cpumon@latest --help
```

See the [CLI reference](./cli) for what each flag does.

To install it permanently:

```sh
npm install -g cpumon
cpumon --fetch
```

## Install as a dependency

```sh
npm install cpumon
```

## First sample

```javascript
import { CpuMonitor } from 'cpumon';

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
import { CpuMonitor } from 'cpumon';
import type { CpuInfo } from 'cpumon';

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
