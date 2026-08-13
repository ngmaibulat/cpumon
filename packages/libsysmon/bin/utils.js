// src/utils.ts
import chalk from "chalk";
function getProgressBar(progress, symbol) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error("getProgressBar(): progress should be in range of from 0 to 100");
  }
  const filled = chalk.green(symbol.repeat(progress));
  const blank = " ".repeat(100 - progress);
  const percent = chalk.yellowBright(`${progress}%`);
  return `[${filled}${blank}${percent}]`;
}
export {
  getProgressBar
};
