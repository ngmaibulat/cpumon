// src/dbus/address.ts
var DEFAULT_SYSTEM_BUS = "/run/dbus/system_bus_socket";
function unescape(text) {
  return text.replace(/%([0-9a-fA-F]{2})/g, (_all, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function parseBusAddress(address) {
  for (const entry of address.split(";")) {
    const at = entry.indexOf(":");
    if (at === -1 || entry.slice(0, at).trim() !== "unix") {
      continue;
    }
    const keys = new Map;
    for (const pair of entry.slice(at + 1).split(",")) {
      const eq = pair.indexOf("=");
      if (eq !== -1) {
        keys.set(pair.slice(0, eq).trim(), unescape(pair.slice(eq + 1)));
      }
    }
    const path = keys.get("path");
    if (path !== undefined && path !== "") {
      return { kind: "path", path };
    }
    const abstract = keys.get("abstract");
    if (abstract !== undefined && abstract !== "") {
      return { kind: "abstract", path: abstract };
    }
  }
  return null;
}
function systemBusAddress(override, env = process.env) {
  if (override !== undefined && override !== "") {
    return override.includes(":") ? parseBusAddress(override) : { kind: "path", path: override };
  }
  const fromEnv = env.DBUS_SYSTEM_BUS_ADDRESS;
  if (fromEnv !== undefined && fromEnv !== "") {
    return parseBusAddress(fromEnv);
  }
  return { kind: "path", path: DEFAULT_SYSTEM_BUS };
}
function connectPath(address) {
  return address.kind === "abstract" ? `\x00${address.path}` : address.path;
}
export {
  systemBusAddress,
  parseBusAddress,
  connectPath,
  DEFAULT_SYSTEM_BUS
};
