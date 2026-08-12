import { statfsSync } from "node:fs";
import path from "node:path";
import { unavailable } from "../types.js";
import { errnoToUnavailable } from "./proc.js";
function defaultMount() {
  return path.parse(process.cwd()).root;
}
function toDiskInfo(mount, stats) {
  const size = stats.bsize * stats.blocks;
  const free = stats.bsize * stats.bfree;
  const available = stats.bsize * stats.bavail;
  const used = Math.max(0, size - free);
  const denominator = used + available;
  const usedRatio = denominator > 0 ? used / denominator : 0;
  return {
    mount,
    size,
    free,
    available,
    used,
    usedRatio,
    usedPercentage: Math.min(100, Math.max(0, Math.floor(usedRatio * 100)))
  };
}
function getDiskUsage(mount = defaultMount()) {
  if (typeof statfsSync !== "function") {
    return unavailable("unsupported-platform", "fs.statfsSync requires Node >= 18.15");
  }
  try {
    return { available: true, disk: toDiskInfo(mount, statfsSync(mount)) };
  } catch (err) {
    return errnoToUnavailable(err, mount);
  }
}
export {
  defaultMount,
  getDiskUsage,
  toDiskInfo
};
