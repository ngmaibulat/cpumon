// src/collectors/connections.ts
import { readdirSync, readlinkSync } from "node:fs";
import { unavailable } from "../types.js";
import { procRoot, readText } from "./proc.js";
import { parsePidStat } from "./process.js";
var TCP_STATES = {
  "01": "ESTABLISHED",
  "02": "SYN_SENT",
  "03": "SYN_RECV",
  "04": "FIN_WAIT1",
  "05": "FIN_WAIT2",
  "06": "TIME_WAIT",
  "07": "CLOSE",
  "08": "CLOSE_WAIT",
  "09": "LAST_ACK",
  "0A": "LISTEN",
  "0B": "CLOSING"
};
var PROTOCOL_FILES = {
  tcp: "net/tcp",
  tcp6: "net/tcp6",
  udp: "net/udp",
  udp6: "net/udp6"
};
var SOCKET_PROTOCOLS = Object.keys(PROTOCOL_FILES);
var HEX = /^[0-9A-Fa-f]+$/;
function swapWord(word) {
  const bytes = [];
  for (let at = 6;at >= 0; at -= 2) {
    bytes.push(parseInt(word.slice(at, at + 2), 16));
  }
  return bytes;
}
function formatIpv6(bytes) {
  const groups = [];
  for (let at = 0;at < 16; at += 2) {
    groups.push(bytes[at] << 8 | bytes[at + 1]);
  }
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;
  for (let at = 0;at < 8; at++) {
    if (groups[at] !== 0) {
      start = -1;
      length = 0;
      continue;
    }
    if (start === -1) {
      start = at;
    }
    length++;
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  }
  const text = groups.map((group) => group.toString(16));
  if (bestLength < 2) {
    return text.join(":");
  }
  return `${text.slice(0, bestStart).join(":")}::${text.slice(bestStart + bestLength).join(":")}`;
}
function decodeAddress(hex) {
  if (!HEX.test(hex)) {
    return null;
  }
  if (hex.length === 8) {
    return swapWord(hex).join(".");
  }
  if (hex.length === 32) {
    const bytes = [];
    for (let word = 0;word < 4; word++) {
      bytes.push(...swapWord(hex.slice(word * 8, word * 8 + 8)));
    }
    return formatIpv6(bytes);
  }
  return null;
}
function decodeEndpoint(field) {
  const colon = field.indexOf(":");
  if (colon === -1) {
    return null;
  }
  const address = decodeAddress(field.slice(0, colon));
  const portHex = field.slice(colon + 1);
  if (address === null || !HEX.test(portHex)) {
    return null;
  }
  return { address, port: parseInt(portHex, 16) };
}
function parseNetSockets(text, protocol) {
  const connections = [];
  for (const line of text.split(`
`)) {
    const columns = line.trim().split(/\s+/);
    if (!/^\d+:$/.test(columns[0] ?? "")) {
      continue;
    }
    const local = decodeEndpoint(columns[1] ?? "");
    const remote = decodeEndpoint(columns[2] ?? "");
    if (local === null || remote === null) {
      continue;
    }
    const queues = (columns[4] ?? "").split(":");
    const uid = Number(columns[7]);
    const inode = Number(columns[9]);
    if (!Number.isFinite(uid) || !Number.isFinite(inode)) {
      continue;
    }
    connections.push({
      protocol,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state: TCP_STATES[(columns[3] ?? "").toUpperCase()] ?? "UNKNOWN",
      uid,
      inode,
      txQueue: parseInt(queues[0] ?? "", 16) || 0,
      rxQueue: parseInt(queues[1] ?? "", 16) || 0
    });
  }
  return connections;
}
function getConnections(options) {
  const root = procRoot(options);
  const connections = [];
  let firstFailure = null;
  let failures = 0;
  for (const protocol of SOCKET_PROTOCOLS) {
    const result = readText(`${root}/${PROTOCOL_FILES[protocol]}`);
    if (!result.ok) {
      firstFailure ??= unavailable(result.reason, result.detail);
      failures++;
      continue;
    }
    connections.push(...parseNetSockets(result.text, protocol));
  }
  if (firstFailure !== null && failures === SOCKET_PROTOCOLS.length) {
    return firstFailure;
  }
  return { available: true, connections };
}
function socketInodes(root) {
  const owners = new Map;
  let denied = false;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return { owners, denied: true };
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number(entry);
    let descriptors;
    try {
      descriptors = readdirSync(`${root}/${entry}/fd`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        denied = true;
      }
      continue;
    }
    for (const descriptor of descriptors) {
      let target;
      try {
        target = readlinkSync(`${root}/${entry}/fd/${descriptor}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match !== null) {
        if (!owners.has(Number(match[1]))) {
          owners.set(Number(match[1]), pid);
        }
      }
    }
  }
  return { owners, denied };
}
function resolveOwners(connections, options) {
  if (connections.length === 0) {
    return connections;
  }
  const root = procRoot(options);
  const { owners, denied } = socketInodes(root);
  const comms = new Map;
  const commOf = (pid) => {
    const cached = comms.get(pid);
    if (cached !== undefined) {
      return cached;
    }
    const result = readText(`${root}/${pid}/stat`);
    const comm = result.ok ? parsePidStat(result.text)?.comm ?? String(pid) : String(pid);
    comms.set(pid, comm);
    return comm;
  };
  return connections.map((connection) => {
    const pid = owners.get(connection.inode);
    if (pid !== undefined) {
      return { ...connection, owner: { kind: "process", pid, comm: commOf(pid) } };
    }
    return { ...connection, owner: { kind: denied ? "denied" : "none" } };
  });
}
export {
  resolveOwners,
  parseNetSockets,
  getConnections,
  decodeAddress,
  TCP_STATES,
  SOCKET_PROTOCOLS
};
