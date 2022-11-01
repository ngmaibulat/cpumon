import { CpuMonitor } from "./CpuMonitor.js";
const monitor = new CpuMonitor(1e3);
monitor.on(
  "cpudata",
  (load) => console.log(load)
);
