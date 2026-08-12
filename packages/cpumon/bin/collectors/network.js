import { unavailable } from "../types.js";
import { procRoot, readText } from "./proc.js";
function parseNetDev(text) {
  const interfaces = [];
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    const columns = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (name === "" || columns.length < 16 || columns.some(Number.isNaN)) {
      continue;
    }
    interfaces.push({
      name,
      rxBytes: columns[0],
      rxPackets: columns[1],
      rxErrors: columns[2],
      rxDropped: columns[3],
      txBytes: columns[8],
      txPackets: columns[9],
      txErrors: columns[10],
      txDropped: columns[11]
    });
  }
  return interfaces;
}
function getNetworkCounters(options) {
  const result = readText(`${procRoot(options)}/net/dev`);
  if (!result.ok) {
    return unavailable(result.reason, result.detail);
  }
  const interfaces = parseNetDev(result.text);
  if (interfaces.length === 0) {
    return unavailable("parse-error", "net/dev listed no interfaces");
  }
  return { available: true, interfaces };
}
function diffNetwork(prev, next, elapsedMs) {
  const baseline = new Map(prev.interfaces.map((item) => [item.name, item]));
  const seconds = elapsedMs / 1e3;
  const interfaces = [];
  for (const current of next.interfaces) {
    const before = baseline.get(current.name);
    if (before === void 0) {
      continue;
    }
    const perSecond = (now, then) => {
      const delta = Math.max(0, now - then);
      return seconds > 0 ? delta / seconds : 0;
    };
    interfaces.push({
      ...current,
      rxBytesPerSec: perSecond(current.rxBytes, before.rxBytes),
      txBytesPerSec: perSecond(current.txBytes, before.txBytes)
    });
  }
  return { interfaces, elapsedMs };
}
export {
  diffNetwork,
  getNetworkCounters,
  parseNetDev
};
