var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import os from "os";
import EventEmitter from "events";
function toCpuInfo(model, times) {
  const total = Object.values(times).reduce((sum, ticks) => sum + ticks, 0);
  return {
    model,
    idle: times.idle,
    load: total - times.idle,
    total
  };
}
function getCpuInfo() {
  return os.cpus().map((item) => toCpuInfo(item.model, item.times));
}
function getCpuDiff(prev, current) {
  const res = [];
  if (prev.length != current.length) {
    throw new Error("Arrays of same lengths should be supplied to function call: getCpuDiff()");
  }
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const c = current[i];
    const newitem = {
      model: p.model,
      idle: c.idle - p.idle,
      total: c.total - p.total,
      load: c.load - p.load
    };
    newitem.loadRatio = newitem.total > 0 ? newitem.load / newitem.total : 0;
    newitem.loadPercentage = Math.min(100, Math.max(0, Math.floor(newitem.loadRatio * 100)));
    res.push(newitem);
  }
  return res;
}
class CpuMonitor extends EventEmitter {
  constructor(ms) {
    super();
    __publicField(this, "ms");
    __publicField(this, "intervalId");
    __publicField(this, "current");
    this.ms = ms;
    this.current = this.getCpuInfo();
    this.intervalId = setInterval(() => this.measureCpu(), this.ms);
  }
  stopMonitor() {
    clearInterval(this.intervalId);
    this.removeAllListeners();
  }
  getCpuInfo() {
    return getCpuInfo();
  }
  getCpuDiff(prev, current) {
    return getCpuDiff(prev, current);
  }
  measureCpu() {
    try {
      const next = getCpuInfo();
      if (next.length !== this.current.length) {
        this.current = next;
        return;
      }
      const load = getCpuDiff(this.current, next);
      this.current = next;
      this.emit("cpudata", load);
    } catch (err) {
      this.emit("error", err);
    }
  }
}
export {
  CpuMonitor,
  getCpuDiff,
  getCpuInfo,
  toCpuInfo
};
