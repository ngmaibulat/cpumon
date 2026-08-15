// src/collectors/wifi.ts
import { unavailable } from "../types.js";
import { procRoot, readText } from "./proc.js";
import { DBusClient } from "../dbus/client.js";
var IWD_SERVICE = "net.connman.iwd";
var IFACE = {
  adapter: "net.connman.iwd.Adapter",
  device: "net.connman.iwd.Device",
  station: "net.connman.iwd.Station",
  diagnostic: "net.connman.iwd.StationDiagnostic",
  network: "net.connman.iwd.Network",
  known: "net.connman.iwd.KnownNetwork"
};
function text(value) {
  return typeof value === "string" ? value : "";
}
function num(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function centiDbm(value) {
  const raw = num(value);
  return raw === undefined ? undefined : raw / 100;
}
function bitrateMbps(value) {
  const raw = num(value);
  return raw === undefined ? undefined : raw / 10;
}
function isObjects(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseManagedObjects(objects, ordered, diagnostics) {
  if (!isObjects(objects)) {
    return { source: "iwd", devices: [], networks: [] };
  }
  const entries = Object.entries(objects);
  const of = (iface) => entries.filter(([, ifaces]) => ifaces[iface] !== undefined).map(([path, ifaces]) => [path, ifaces[iface]]);
  const adapters = new Map(of(IFACE.adapter));
  const stations = new Map(of(IFACE.station));
  const devices = of(IFACE.device).map(([path, props]) => {
    const station = stations.get(path);
    const adapter = adapters.get(text(props.Adapter));
    const model = text(adapter?.Model);
    return {
      name: text(props.Name),
      address: text(props.Address),
      powered: props.Powered === true,
      mode: text(props.Mode),
      ...model === "" ? {} : { adapterModel: model },
      state: station === undefined ? "unknown" : text(station.State),
      scanning: station?.Scanning === true
    };
  });
  const signals = new Map;
  if (Array.isArray(ordered)) {
    for (const entry of ordered) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue;
      }
      const dbm = centiDbm(entry[1]);
      if (dbm !== undefined) {
        signals.set(text(entry[0]), dbm);
      }
    }
  }
  const knownPaths = new Set(of(IFACE.known).map(([path]) => path));
  const networks = of(IFACE.network).map(([path, props]) => {
    const signal = signals.get(path);
    const knownPath = text(props.KnownNetwork);
    return {
      ssid: text(props.Name),
      security: text(props.Type),
      connected: props.Connected === true,
      known: knownPath !== "" && knownPaths.has(knownPath),
      ...signal === undefined ? {} : { signalDbm: signal }
    };
  });
  networks.sort((a, b) => (b.signalDbm ?? -Infinity) - (a.signalDbm ?? -Infinity));
  const connectedSsid = networks.find((network) => network.connected)?.ssid ?? "";
  const connection = toConnection(diagnostics, connectedSsid);
  return {
    source: "iwd",
    devices,
    ...connection === undefined ? {} : { connection },
    networks
  };
}
function toConnection(diagnostics, ssid) {
  if (diagnostics === null || diagnostics === undefined || typeof diagnostics !== "object" || Array.isArray(diagnostics)) {
    return;
  }
  const props = diagnostics;
  const rssi = num(props.RSSI);
  if (rssi === undefined) {
    return;
  }
  const optional = {
    averageSignalDbm: num(props.AverageRSSI),
    rxMode: text(props.RxMode) || undefined,
    txMode: text(props.TxMode) || undefined,
    rxBitrateMbps: bitrateMbps(props.RxBitrate),
    txBitrateMbps: bitrateMbps(props.TxBitrate),
    connectedSeconds: num(props.ConnectedTime)
  };
  return {
    ssid,
    bssid: text(props.ConnectedBss),
    frequencyMhz: num(props.Frequency) ?? 0,
    channel: num(props.Channel) ?? 0,
    security: text(props.Security),
    signalDbm: rssi,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined))
  };
}
function parseProcWireless(text_) {
  const devices = [];
  for (const line of text_.split(`
`)) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    if (name === "" || /\s/.test(name) || name === "face") {
      continue;
    }
    const columns = line.slice(colon + 1).trim().split(/\s+/).map((item) => item.replace(/\.$/, ""));
    const quality = Number(columns[1]);
    const level = Number(columns[2]);
    devices.push({
      name,
      address: "",
      powered: true,
      mode: "",
      state: "unknown",
      scanning: false,
      ...Number.isFinite(level) ? { signalDbm: level } : {},
      ...Number.isFinite(quality) ? { linkQuality: quality } : {}
    });
  }
  return { source: "proc", devices, networks: [] };
}
async function getWifi(options = {}) {
  const viaIwd = await fromIwd(options);
  if (viaIwd !== null) {
    return { available: true, ...viaIwd };
  }
  const result = readText(`${procRoot(options)}/net/wireless`);
  if (!result.ok) {
    return unavailable(result.reason, `iwd is not reachable and ${result.detail ?? "no /proc/net/wireless"}`);
  }
  const viaProc = parseProcWireless(result.text);
  if (viaProc.devices.length === 0) {
    return unavailable("not-applicable", "no wireless interface on this machine");
  }
  return { available: true, ...viaProc };
}
async function fromIwd(options) {
  let client = null;
  try {
    client = await DBusClient.connect({ address: options.address, timeoutMs: options.timeoutMs });
    const [objects] = await client.call({
      destination: IWD_SERVICE,
      path: "/",
      iface: "org.freedesktop.DBus.ObjectManager",
      member: "GetManagedObjects"
    });
    if (!isObjects(objects)) {
      return null;
    }
    const stationPath = Object.entries(objects).find(([, ifaces]) => ifaces[IFACE.station] !== undefined)?.[0];
    const ordered = stationPath === undefined ? undefined : await tryCall(client, stationPath, IFACE.station, "GetOrderedNetworks");
    const diagnostics = stationPath === undefined ? undefined : await tryCall(client, stationPath, IFACE.diagnostic, "GetDiagnostics");
    return parseManagedObjects(objects, ordered, diagnostics);
  } catch {
    return null;
  } finally {
    client?.close();
  }
}
async function tryCall(client, path, iface, member) {
  try {
    const [value] = await client.call({ destination: IWD_SERVICE, path, iface, member });
    return value;
  } catch {
    return;
  }
}
export {
  parseProcWireless,
  parseManagedObjects,
  getWifi,
  centiDbm,
  bitrateMbps,
  IWD_SERVICE
};
