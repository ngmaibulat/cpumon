import { CpuInfo, CpuMonitor } from './CpuMonitor.js';

const monitor = new CpuMonitor(1000);

monitor.on(
    'cpudata',
    (load: CpuInfo[]) => console.log(load)
);

setTimeout(() => monitor.stopMonitor(), 3000);
