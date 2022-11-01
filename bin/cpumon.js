#!/usr/bin/env node
import chalk from "chalk";
import { CpuMonitor } from "./CpuMonitor.js";
import { getProgressBar } from "./utils.js";
const mon = new CpuMonitor(1e3);
mon.on("cpudata", (load) => {
  const diags = load.map((cpu) => {
    if (typeof cpu.loadPercentage != "number") {
      throw new Error("loadPercentage must be a number!");
    }
    const symbol = "|";
    return getProgressBar(cpu.loadPercentage, chalk.green(symbol));
  });
  console.clear();
  const fmt = {
    minimumIntegerDigits: 2,
    useGrouping: false
  };
  for (let i = 1; i <= diags.length; i++) {
    console.log(i.toLocaleString("en-US", fmt), diags[i - 1]);
  }
});
