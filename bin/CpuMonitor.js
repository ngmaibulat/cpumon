var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import os from "os";
import EventEmitter from "events";
import { sleep } from "./utils.js";
class CpuMonitor extends EventEmitter {
  constructor(ms) {
    super();
    __publicField(this, "ms");
    __publicField(this, "current");
    this.ms = ms;
    this.current = [];
    setInterval(() => this.emit("tick"), this.ms);
    this.on("tick", this.measureCpu);
  }
  getCpuInfo() {
    const cpus = os.cpus();
    return cpus.map((item) => {
      const newitem = {
        model: item.model,
        idle: item.times.idle,
        load: item.times.user + item.times.sys,
        total: item.times.idle + item.times.user + item.times.sys
      };
      return newitem;
    });
  }
  async getCpuLoad(prev, ms) {
    if (!prev.length) {
      prev = this.getCpuInfo();
    }
    await sleep(ms);
    const current = this.getCpuInfo();
    const load = this.getCpuDiff(prev, current);
    return { current, load };
  }
  getCpuDiff(prev, current) {
    let res = [];
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
      newitem.loadRatio = newitem.load / newitem.total;
      newitem.loadPercentage = Math.floor(newitem.loadRatio * 100);
      res.push(newitem);
    }
    return res;
  }
  async onTick() {
    const { current, load } = await this.getCpuLoad([], 1e3);
    const str = load.reduce((prev, current2) => {
      return `${prev} ${current2.loadPercentage}`;
    }, "cpu: ");
    const fmt = {
      minimumIntegerDigits: 2,
      useGrouping: false
    };
    const arrdata = load.map((item) => item.loadPercentage);
    console.clear();
    console.table({ load: arrdata });
  }
  async measureCpu() {
    const { current, load } = await this.getCpuLoad(this.current, this.ms);
    this.current = current;
    this.emit("cpudata", { current, load });
  }
}
export {
  CpuMonitor
};
