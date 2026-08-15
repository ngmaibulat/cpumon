// src/collectors/docker.ts
import { request } from "node:http";
import { unavailable } from "../types.js";
import { checkUnixSocket } from "./socket.js";
var DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
var DEFAULT_DOCKER_API = "v1.43";
var LABEL = {
  project: "com.docker.compose.project",
  service: "com.docker.compose.service",
  number: "com.docker.compose.container-number",
  workingDir: "com.docker.compose.project.working_dir",
  configFiles: "com.docker.compose.project.config_files",
  oneoff: "com.docker.compose.oneoff"
};
function text(value) {
  return typeof value === "string" ? value : "";
}
function toLabels(value) {
  if (value === null || typeof value !== "object") {
    return {};
  }
  const labels = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      labels[key] = raw;
    }
  }
  return labels;
}
function toPorts(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const ports = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const item = entry;
    const privatePort = Number(item.PrivatePort);
    if (!Number.isFinite(privatePort)) {
      continue;
    }
    const publicPort = Number(item.PublicPort);
    const ip = text(item.IP);
    ports.push({
      privatePort,
      type: text(item.Type) || "tcp",
      ...ip === "" ? {} : { ip },
      ...Number.isFinite(publicPort) && publicPort > 0 ? { publicPort } : {}
    });
  }
  return ports;
}
function composeOf(labels) {
  const project = labels[LABEL.project] ?? "";
  const service = labels[LABEL.service] ?? "";
  if (project === "" || service === "") {
    return;
  }
  const number = Number(labels[LABEL.number]);
  const workingDir = labels[LABEL.workingDir] ?? "";
  const configFiles = labels[LABEL.configFiles] ?? "";
  return {
    project,
    service,
    containerNumber: Number.isFinite(number) && number > 0 ? number : 1,
    ...workingDir === "" ? {} : { workingDir },
    ...configFiles === "" ? {} : { configFiles: configFiles.split(",").filter((item) => item !== "") },
    oneoff: labels[LABEL.oneoff]?.toLowerCase() === "true"
  };
}
function parseDockerContainers(body) {
  if (!Array.isArray(body)) {
    return [];
  }
  const containers = [];
  for (const entry of body) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const item = entry;
    const id = text(item.Id);
    if (id === "") {
      continue;
    }
    const names = Array.isArray(item.Names) ? item.Names : [];
    const labels = toLabels(item.Labels);
    const compose = composeOf(labels);
    const createdAt = Number(item.Created);
    containers.push({
      id,
      name: text(names[0]).replace(/^\//, ""),
      image: text(item.Image),
      command: text(item.Command),
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      state: text(item.State),
      status: text(item.Status),
      ports: toPorts(item.Ports),
      labels,
      ...compose === undefined ? {} : { compose }
    });
  }
  return containers;
}
function groupIntoStacks(containers) {
  const stacks = new Map;
  for (const container of containers) {
    const compose = container.compose;
    if (compose === undefined) {
      continue;
    }
    let stack = stacks.get(compose.project);
    if (stack === undefined) {
      stack = {
        project: compose.project,
        ...compose.workingDir === undefined ? {} : { workingDir: compose.workingDir },
        configFiles: compose.configFiles ?? [],
        services: [],
        running: 0,
        total: 0
      };
      stacks.set(compose.project, stack);
    }
    if (stack.workingDir === undefined && compose.workingDir !== undefined) {
      stack.workingDir = compose.workingDir;
    }
    if (stack.configFiles.length === 0 && compose.configFiles !== undefined) {
      stack.configFiles = compose.configFiles;
    }
    stack.services.push(container);
    if (!compose.oneoff) {
      stack.total++;
      if (container.state === "running") {
        stack.running++;
      }
    }
  }
  for (const stack of stacks.values()) {
    stack.services.sort((a, b) => {
      const byService = (a.compose?.service ?? "").localeCompare(b.compose?.service ?? "");
      return byService !== 0 ? byService : (a.compose?.containerNumber ?? 0) - (b.compose?.containerNumber ?? 0);
    });
  }
  return [...stacks.values()].sort((a, b) => a.project.localeCompare(b.project));
}
function get(path, socketPath, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    const req = request({ socketPath, path, method: "GET", timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          finish({ ok: false, ...unavailable("parse-error", `${path}: HTTP ${status}`) });
          return;
        }
        finish({ ok: true, body });
      });
      res.on("error", (err) => {
        finish({ ok: false, ...unavailable("parse-error", `${path}: ${err.message}`) });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish({ ok: false, ...unavailable("not-found", `${socketPath}: no answer in ${timeoutMs}ms; is the daemon running?`) });
    });
    req.on("error", (err) => {
      finish({ ok: false, ...unavailable("not-found", `${socketPath}: ${err.message}`) });
    });
    req.end();
  });
}
async function getDockerContainers(options) {
  const socketPath = options?.socketPath ?? DEFAULT_DOCKER_SOCKET;
  const apiVersion = options?.apiVersion ?? DEFAULT_DOCKER_API;
  const timeoutMs = options?.timeoutMs ?? 2000;
  const unusable = checkUnixSocket(socketPath, {
    missing: "no docker socket",
    denied: "not in the docker group?"
  });
  if (unusable !== null) {
    return unusable;
  }
  const result = await get(`/${apiVersion}/containers/json?all=1`, socketPath, timeoutMs);
  if (!result.ok) {
    return unavailable(result.reason, result.detail);
  }
  let body;
  try {
    body = JSON.parse(result.body);
  } catch {
    return unavailable("parse-error", "the container list was not JSON");
  }
  if (!Array.isArray(body)) {
    return unavailable("parse-error", "the container list was not an array");
  }
  return { available: true, containers: parseDockerContainers(body) };
}
export {
  parseDockerContainers,
  groupIntoStacks,
  getDockerContainers,
  composeOf,
  DEFAULT_DOCKER_SOCKET,
  DEFAULT_DOCKER_API
};
