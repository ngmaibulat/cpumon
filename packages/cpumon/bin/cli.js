import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { defaultMount } from "./collectors/disk.js";
const MODE_TRAITS = {
  bars: { needsWindow: true, oneShot: false, clears: true },
  overall: { needsWindow: true, oneShot: false, clears: false },
  fetch: { needsWindow: true, oneShot: true, clears: false },
  // nothing to diff, so these print at once rather than making the user wait
  // an interval for the equivalent of `free` or `df`
  mem: { needsWindow: false, oneShot: true, clears: false },
  load: { needsWindow: false, oneShot: true, clears: false },
  disk: { needsWindow: false, oneShot: true, clears: false },
  // counters, so a rate needs a window; top-shaped, so they refresh
  net: { needsWindow: true, oneShot: false, clears: true },
  proc: { needsWindow: true, oneShot: false, clears: true },
  // waits one window so the cgroup CPU figures are real, then exits
  containers: { needsWindow: true, oneShot: true, clears: false }
};
class CliError extends Error {
  exitCode;
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
const OPTIONS = [
  { long: "interval", short: "i", arg: "ms", description: "sampling interval in milliseconds", default: "1000" },
  { long: "count", short: "n", arg: "n", description: "exit after n samples", default: "run until Ctrl-C" },
  { long: "json", description: "emit JSON instead of formatted text" },
  { long: "overall", short: "o", mode: "overall", description: "print a single machine-wide load line" },
  { long: "fetch", mode: "fetch", description: "print a one-shot system summary panel and exit" },
  { long: "mem", mode: "mem", description: "print memory and swap usage and exit" },
  { long: "load", mode: "load", description: "print the 1/5/15 minute load average and exit" },
  { long: "disk", mode: "disk", description: "print filesystem usage and exit" },
  { long: "net", mode: "net", description: "show per-interface network throughput" },
  { long: "proc", mode: "proc", description: "show the busiest processes" },
  { long: "containers", mode: "containers", description: "show cgroup limits and container usage" },
  { long: "mount", arg: "path", description: "filesystem to report disk usage for", default: "the current filesystem root" },
  { long: "top", arg: "n", description: "how many rows the table views show", default: "10" },
  // parseArgs has no --no-x negation, so the option is literally named
  // "no-color" - without declaring it, strict mode rejects the flag outright
  { long: "no-color", description: "disable coloured output" },
  { long: "version", short: "v", description: "print version and exit" },
  { long: "help", short: "h", description: "show this help and exit" }
];
const MODE_SPECS = OPTIONS.filter(
  (opt) => opt.mode !== void 0
);
function toParseArgsConfig() {
  const config = {};
  for (const opt of OPTIONS) {
    config[opt.long] = opt.arg === void 0 ? { type: "boolean" } : { type: "string" };
    if (opt.short !== void 0) {
      config[opt.long].short = opt.short;
    }
  }
  return config;
}
function positiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new CliError(`${flag} expects a positive whole number, got "${raw}"`);
  }
  return value;
}
function parseCliArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: toParseArgsConfig(),
      strict: true,
      allowPositionals: false
    }));
  } catch (err) {
    throw new CliError(err.message);
  }
  const selected = MODE_SPECS.filter((spec) => values[spec.long] === true);
  if (selected.length > 1) {
    throw new CliError(`--${selected[0].long} and --${selected[1].long} cannot be combined`);
  }
  const mode = selected[0]?.mode ?? "bars";
  const intervalMs = values.interval === void 0 ? 1e3 : positiveInteger(values.interval, "--interval");
  const count = values.count === void 0 ? MODE_TRAITS[mode].oneShot ? 1 : null : positiveInteger(values.count, "--count");
  return {
    intervalMs,
    count,
    mode,
    format: values.json === true ? "json" : "text",
    // an unreadable path is a runtime fact reported as an unavailable
    // probe, not a usage error, so it is not validated here
    mount: values.mount ?? defaultMount(),
    top: values.top === void 0 ? 10 : positiveInteger(values.top, "--top"),
    color: values["no-color"] !== true,
    help: values.help === true,
    version: values.version === true
  };
}
function formatFlag(opt) {
  const short = opt.short === void 0 ? "    " : `-${opt.short}, `;
  const arg = opt.arg === void 0 ? "" : ` <${opt.arg}>`;
  return `  ${short}--${opt.long}${arg}`;
}
function buildHelp() {
  const flags = OPTIONS.map(formatFlag);
  const width = Math.max(...flags.map((flag) => flag.length));
  const lines = OPTIONS.map((opt, i) => {
    const tail = opt.default === void 0 ? "" : `  (default: ${opt.default})`;
    return `${flags[i].padEnd(width)}  ${opt.description}${tail}`;
  });
  return [
    "cpumon - monitor CPU load and system resources",
    "",
    "Usage:  cpumon [options]",
    "",
    "Options:",
    ...lines,
    "",
    "View flags select what to show and cannot be combined with each other:",
    `  ${MODE_SPECS.map((spec) => `--${spec.long}`).join(" ")}`,
    "",
    "--json selects how it is shown, and combines with any view.",
    "",
    "Examples:",
    "  cpumon -i 500                 refresh twice a second",
    "  cpumon --json -n 5            five samples as JSON, then exit",
    "  cpumon --overall              one line for the whole machine",
    "  cpumon --fetch                a one-shot system summary",
    "  cpumon --fetch --json         the same summary, machine readable",
    ""
  ].join("\n");
}
function getVersion() {
  const require2 = createRequire(import.meta.url);
  return require2("../package.json").version;
}
export {
  CliError,
  MODE_TRAITS,
  OPTIONS,
  buildHelp,
  getVersion,
  parseCliArgs
};
