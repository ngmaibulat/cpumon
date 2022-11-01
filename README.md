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

### Install as dependency

```sh
npm i cpumon
```

### Use in JS:

```javascript
import { CpuMonitor } from 'cpumon';

const monitor = new CpuMonitor(1000);

monitor.on(
    'cpudata',
    (load) => console.log(load)
);
```

### Use in TS

```javascript
import { CpuInfo, CpuMonitor } from 'cpumon';

const monitor = new CpuMonitor(1000);

monitor.on(
    'cpudata',
    (load: CpuInfo[]) => console.log(load)
);
```

### Stop Monitoring

You can stop monitoring cpu by calling `.stopMonitor()` method.
For example, to stop monitoring after 5 min, you can use the following code:

```javascript
setTimeout(() => monitor.stopMonitor(), 5*60*1000);
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
