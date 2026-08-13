// src/cli.ts
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { defaultMount } from "./collectors/disk.js";
var MODE_TRAITS = {
  bars: { needsWindow: true, oneShot: false, clears: true },
  overall: { needsWindow: true, oneShot: false, clears: false },
  fetch: { needsWindow: true, oneShot: true, clears: false },
  mem: { needsWindow: false, oneShot: true, clears: false },
  load: { needsWindow: false, oneShot: true, clears: false },
  disk: { needsWindow: false, oneShot: true, clears: false },
  net: { needsWindow: true, oneShot: false, clears: true },
  proc: { needsWindow: true, oneShot: false, clears: true },
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
var OPTIONS = [
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
  { long: "no-color", description: "disable coloured output" },
  { long: "version", short: "v", description: "print version and exit" },
  { long: "help", short: "h", description: "show this help and exit" }
];
var MODE_SPECS = OPTIONS.filter((opt) => opt.mode !== undefined);
function toParseArgsConfig() {
  const config = {};
  for (const opt of OPTIONS) {
    config[opt.long] = opt.arg === undefined ? { type: "boolean" } : { type: "string" };
    if (opt.short !== undefined) {
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
  const intervalMs = values.interval === undefined ? 1000 : positiveInteger(values.interval, "--interval");
  const count = values.count === undefined ? MODE_TRAITS[mode].oneShot ? 1 : null : positiveInteger(values.count, "--count");
  return {
    intervalMs,
    count,
    mode,
    format: values.json === true ? "json" : "text",
    mount: values.mount ?? defaultMount(),
    top: values.top === undefined ? 10 : positiveInteger(values.top, "--top"),
    color: values["no-color"] !== true,
    help: values.help === true,
    version: values.version === true
  };
}
function formatFlag(opt) {
  const short = opt.short === undefined ? "    " : `-${opt.short}, `;
  const arg = opt.arg === undefined ? "" : ` <${opt.arg}>`;
  return `  ${short}--${opt.long}${arg}`;
}
function buildHelp() {
  const flags = OPTIONS.map(formatFlag);
  const width = Math.max(...flags.map((flag) => flag.length));
  const lines = OPTIONS.map((opt, i) => {
    const tail = opt.default === undefined ? "" : `  (default: ${opt.default})`;
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
  ].join(`
`);
}
function getVersion() {
  const require2 = createRequire(import.meta.url);
  return require2("../package.json").version;
}
export {
  parseCliArgs,
  getVersion,
  buildHelp,
  OPTIONS,
  MODE_TRAITS,
  CliError
};
