// Run with: npm run build && node examples/demo.js
// Prints three batches of cpudata, then exits on its own.

import { CpuMonitor } from '../bin/CpuMonitor.js';

const monitor = new CpuMonitor(1000);

monitor.on('error', (err) => console.error('demo:', err.message));

monitor.on('cpudata', (load) => console.log(load));

setTimeout(() => monitor.stopMonitor(), 3000);
