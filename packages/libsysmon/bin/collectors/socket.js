// src/collectors/socket.ts
import { accessSync, constants, statSync } from "node:fs";
import { unavailable } from "../types.js";
function checkUnixSocket(path, hints = {}) {
  let stats;
  try {
    stats = statSync(path);
  } catch (err) {
    const code = err.code;
    return code === "EACCES" || code === "EPERM" ? unavailable("permission-denied", `${path}: not readable${suffix(hints.denied)}`) : unavailable("not-found", `${path}${suffix(hints.missing)}`);
  }
  if (!stats.isSocket()) {
    return unavailable("not-found", `${path}: not a socket`);
  }
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
  } catch {
    return unavailable("permission-denied", `${path}${suffix(hints.denied)}`);
  }
  return null;
}
function suffix(hint) {
  return hint === undefined ? "" : `: ${hint}`;
}
export {
  checkUnixSocket
};
