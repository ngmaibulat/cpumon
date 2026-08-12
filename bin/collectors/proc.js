import { readFileSync } from "node:fs";
import { unavailable } from "../types.js";
const IS_LINUX = process.platform === "linux";
const DEFAULT_PROC_ROOT = "/proc";
const DEFAULT_SYSFS_ROOT = "/sys/fs/cgroup";
const CLOCK_TICKS = 100;
function procRoot(options) {
  return options?.procRoot ?? DEFAULT_PROC_ROOT;
}
function sysfsRoot(options) {
  return options?.sysfsRoot ?? DEFAULT_SYSFS_ROOT;
}
function clockTicks(options) {
  return options?.clockTicks ?? CLOCK_TICKS;
}
function errnoToUnavailable(err, path) {
  switch (err.code) {
    case "ENOENT":
    case "ENOTDIR":
      return unavailable("not-found", path);
    case "EACCES":
    case "EPERM":
      return unavailable("permission-denied", path);
    case "ENOSYS":
    case "EOPNOTSUPP":
      return unavailable("unsupported-platform", `${path}: ${err.code}`);
    default:
      return unavailable("parse-error", `${path}: ${err.code ?? err.message}`);
  }
}
function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (err) {
    return { ok: false, ...errnoToUnavailable(err, path) };
  }
}
function parseKeyValue(text, separator = ":") {
  const fields = /* @__PURE__ */ new Map();
  for (const line of text.split("\n")) {
    const at = line.indexOf(separator);
    if (at === -1) {
      continue;
    }
    const key = line.slice(0, at).trim();
    if (key !== "") {
      fields.set(key, line.slice(at + 1).trim());
    }
  }
  return fields;
}
function toNumber(raw) {
  if (raw === void 0) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
function firstNumber(raw) {
  return toNumber(raw?.trim().split(/\s+/)[0]);
}
export {
  CLOCK_TICKS,
  DEFAULT_PROC_ROOT,
  DEFAULT_SYSFS_ROOT,
  IS_LINUX,
  clockTicks,
  errnoToUnavailable,
  firstNumber,
  parseKeyValue,
  procRoot,
  readText,
  sysfsRoot,
  toNumber
};
