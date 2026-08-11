#!/usr/bin/env node
import chalk from "chalk";
import { CpuMonitor } from "./CpuMonitor.js";
import { getProgressBar } from "./utils.js";
const mon = new CpuMonitor(1e3);
mon.on("error", (err) => {
  console.error(chalk.red(`cpumon: ${err.message}`));
});
mon.on("cpudata", (load) => {
  const symbol = "|";
  const diags = load.map((cpu) => {
    var _a;
    return getProgressBar((_a = cpu.loadPercentage) != null ? _a : 0, symbol);
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
