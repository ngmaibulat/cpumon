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
function withLoadRatio(info) {
  const loadRatio = info.total > 0 ? info.load / info.total : 0;
  return {
    ...info,
    loadRatio,
    loadPercentage: Math.min(100, Math.max(0, Math.floor(loadRatio * 100)))
  };
}
function aggregateCpu(cores) {
  if (cores.length === 0) {
    throw new Error("aggregateCpu() needs at least one core sample");
  }
  let idle = 0;
  let load = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.idle;
    load += core.load;
    total += core.total;
  }
  return withLoadRatio({ model: cores[0].model, idle, load, total });
}
function getCpuDiff(prev, current) {
  const res = [];
  if (prev.length != current.length) {
    throw new Error("Arrays of same lengths should be supplied to function call: getCpuDiff()");
  }
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const c = current[i];
    res.push(withLoadRatio({
      model: p.model,
      idle: c.idle - p.idle,
      total: c.total - p.total,
      load: c.load - p.load
    }));
  }
  return res;
}
class CpuMonitor extends EventEmitter {
  ms;
  /** null while stopped */
  intervalId;
  current;
  shouldUnref;
  constructor(options) {
    super();
    const opts = typeof options === "number" ? { intervalMs: options } : options;
    this.ms = opts.intervalMs;
    this.shouldUnref = opts.unref ?? false;
    this.current = this.getCpuInfo();
    this.intervalId = null;
    this.start();
  }
  /**
   * Begin sampling. Safe to call on an already-running monitor, and safe to
   * call again after stopMonitor() - the baseline is re-read so the first
   * sample after a restart measures the new window, not the gap.
   */
  start() {
    if (this.intervalId !== null) {
      return;
    }
    this.current = this.getCpuInfo();
    this.intervalId = setInterval(() => this.measureCpu(), this.ms);
    if (this.shouldUnref) {
      this.intervalId.unref();
    }
  }
  /**
   * Stop sampling.
   *
   * Changed in 0.2.0: this no longer calls removeAllListeners(). Detaching
   * handlers the caller registered was surprising, made the monitor
   * single-use, and silently dropped their 'error' listener.
   */
  stopMonitor() {
    if (this.intervalId === null) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
  /** Alias for stopMonitor(), matching the usual Node resource vocabulary. */
  close() {
    this.stopMonitor();
  }
  get running() {
    return this.intervalId !== null;
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
  aggregateCpu,
  getCpuDiff,
  getCpuInfo,
  toCpuInfo,
  withLoadRatio
};
