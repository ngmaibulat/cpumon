// src/collectors/loadavg.ts
import os from "os";
import { unavailable } from "../types.js";
function toLoadAverage(avg, cores) {
  const perCore = (value) => cores > 0 ? value / cores : 0;
  const [one, five, fifteen] = avg;
  return {
    one,
    five,
    fifteen,
    cores,
    onePerCore: perCore(one),
    fivePerCore: perCore(five),
    fifteenPerCore: perCore(fifteen)
  };
}
function getLoadAverage() {
  if (process.platform === "win32") {
    return unavailable("not-applicable", "Windows has no load average");
  }
  const [one, five, fifteen] = os.loadavg();
  return { available: true, ...toLoadAverage([one, five, fifteen], os.cpus().length) };
}
export {
  toLoadAverage,
  getLoadAverage
};
