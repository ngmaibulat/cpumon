### Library and a CLI tool to monitor CPU usage

### The goal:
The goal is to provide simple API to monitor CPU usage accross all
available CPU cores. You can provide sampling interval in ms to the constructor.
The `CpuMonitor` class is based on standard NodeJS `EventEmitter`.


You can subscribe to `cpudata` events which would be generated
according to the provided sampling interval. The event would
also have the data of cpu usage percentage for each cpu core.

There is no CJS build provided. Only ESM is provided, so use `import` - not `require`.

### Use CLI tool:

```sh
npx cpumon@latest
```

### Use the Library:

```javascript
import { CpuInfo, CpuMonitor } from './CpuMonitor.js';

const monitor = new CpuMonitor(1000);

monitor.on(
    'cpudata',
    (load: CpuInfo[]) => console.log(load)
);
```

### Data Types:

```javascript
type CpuInfo = {
    model: string;
    idle: number;
    load: number;
    total: number;
    loadRatio?: number;
    loadPercentage?: number;
}
```
