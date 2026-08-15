// src/collectors/systemd.ts
import { unavailable } from "../types.js";
import { IS_LINUX } from "./proc.js";
import { checkUnixSocket } from "./socket.js";
import { systemBusAddress } from "../dbus/address.js";
import { DBusClient, DBusError } from "../dbus/client.js";
var SYSTEMD_SERVICE = "org.freedesktop.systemd1";
var SYSTEMD_PATH = "/org/freedesktop/systemd1";
var SYSTEMD_MANAGER = "org.freedesktop.systemd1.Manager";
function unitType(name) {
  const at = name.lastIndexOf(".");
  return at === -1 ? "" : name.slice(at + 1);
}
function parseListUnits(rows) {
  const units = [];
  for (const entry of rows) {
    if (!Array.isArray(entry) || entry.length < 10) {
      continue;
    }
    const name = String(entry[0]);
    if (name === "") {
      continue;
    }
    const jobType = String(entry[8]);
    units.push({
      name,
      description: String(entry[1]),
      loadState: String(entry[2]),
      activeState: String(entry[3]),
      subState: String(entry[4]),
      type: unitType(name),
      ...jobType === "" ? {} : { jobType }
    });
  }
  return units;
}
async function getSystemdUnits(options = {}) {
  if (!IS_LINUX) {
    return unavailable("unsupported-platform", "systemd is Linux-only");
  }
  const address = systemBusAddress(options.address);
  if (address === null) {
    return unavailable("not-found", "no unix system bus address");
  }
  if (address.kind === "path") {
    const unusable = checkUnixSocket(address.path, {
      missing: "no system bus socket; does this machine run systemd?",
      denied: "the system bus refused a connection"
    });
    if (unusable !== null) {
      return unusable;
    }
  }
  let client = null;
  try {
    client = await DBusClient.connect({ address: options.address, timeoutMs: options.timeoutMs });
    const reply = await client.call({
      destination: SYSTEMD_SERVICE,
      path: SYSTEMD_PATH,
      iface: SYSTEMD_MANAGER,
      member: "ListUnits"
    });
    const rows = reply[0];
    if (!Array.isArray(rows)) {
      return unavailable("parse-error", "ListUnits did not return an array");
    }
    return { available: true, units: parseListUnits(rows) };
  } catch (err) {
    return failure(err);
  } finally {
    client?.close();
  }
}
function failure(err) {
  if (err instanceof DBusError) {
    return unavailable("parse-error", err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  const code = err.code;
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTSOCK" || /no unix bus address/.test(message)) {
    return unavailable("not-found", `no system bus: ${message}`);
  }
  if (code === "EACCES" || code === "EPERM" || /authentication rejected/.test(message)) {
    return unavailable("permission-denied", message);
  }
  return unavailable("parse-error", message);
}
export {
  unitType,
  parseListUnits,
  getSystemdUnits,
  SYSTEMD_SERVICE,
  SYSTEMD_PATH,
  SYSTEMD_MANAGER
};
