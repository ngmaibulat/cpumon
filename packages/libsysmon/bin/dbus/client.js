// src/dbus/client.ts
import { Socket } from "node:net";
import { connectPath, systemBusAddress } from "./address.js";
import { MESSAGE_TYPE, decodeMessage, encodeMessage, messageLength } from "./message.js";

class DBusError extends Error {
  name_;
  constructor(name_, message) {
    super(`${name_}: ${message}`);
    this.name_ = name_;
    this.name = "DBusError";
  }
}
var DEFAULT_TIMEOUT = 5000;

class DBusClient {
  #socket;
  #buffer = Buffer.alloc(0);
  #pending = new Map;
  #serial = 1;
  #closed = false;
  #timeoutMs;
  uniqueName = "";
  constructor(socket, timeoutMs) {
    this.#socket = socket;
    this.#timeoutMs = timeoutMs;
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (err) => this.#fail(err));
    socket.on("close", () => this.#fail(new Error("dbus: connection closed")));
  }
  get closed() {
    return this.#closed;
  }
  static async connect(options = {}) {
    const address = systemBusAddress(options.address);
    if (address === null) {
      throw new Error("dbus: no unix bus address to connect to");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    const socket = await open(connectPath(address), timeoutMs);
    await authenticate(socket, timeoutMs);
    const client = new DBusClient(socket, timeoutMs);
    const reply = await client.call({
      destination: "org.freedesktop.DBus",
      path: "/org/freedesktop/DBus",
      iface: "org.freedesktop.DBus",
      member: "Hello"
    });
    client.uniqueName = String(reply[0] ?? "");
    return client;
  }
  call(options) {
    if (this.#closed) {
      return Promise.reject(new Error("dbus: client is closed"));
    }
    const serial = this.#serial++;
    const message = encodeMessage({
      type: MESSAGE_TYPE.methodCall,
      serial,
      path: options.path,
      iface: options.iface,
      member: options.member,
      destination: options.destination,
      signature: options.signature,
      body: options.body
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(serial);
        reject(new Error(`dbus: ${options.member} did not answer in ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      timer.unref?.();
      this.#pending.set(serial, {
        resolve: (body) => {
          clearTimeout(timer);
          resolve(body);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this.#socket.write(message);
    });
  }
  close() {
    this.#closed = true;
    this.#socket.destroy();
    this.#fail(new Error("dbus: client closed"));
  }
  #fail(err) {
    this.#closed = true;
    const waiting = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of waiting) {
      entry.reject(err);
    }
  }
  #onData(chunk) {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    for (;; ) {
      const length = messageLength(this.#buffer);
      if (length === null) {
        return;
      }
      const frame = this.#buffer.subarray(0, length);
      this.#buffer = this.#buffer.subarray(length);
      try {
        this.#dispatch(decodeMessage(frame));
      } catch (err) {}
    }
  }
  #dispatch(message) {
    if (message.replySerial === undefined) {
      return;
    }
    const waiting = this.#pending.get(message.replySerial);
    if (waiting === undefined) {
      return;
    }
    this.#pending.delete(message.replySerial);
    if (message.type === MESSAGE_TYPE.error) {
      waiting.reject(new DBusError(message.errorName ?? "org.freedesktop.DBus.Error.Failed", String(message.body[0] ?? "")));
      return;
    }
    waiting.resolve(message.body);
  }
}
function open(path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new Socket;
    let settled = false;
    const done = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.off("connect", onConnect);
      socket.off("error", onError);
      clearTimeout(timer);
      if (err === null) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(err);
      }
    };
    const onConnect = () => done(null);
    const onError = (err) => done(err);
    const timer = setTimeout(() => done(new Error(`dbus: ${path} did not accept a connection in ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    socket.once("connect", onConnect);
    socket.once("error", onError);
    try {
      socket.connect({ path });
    } catch (err) {
      done(err);
    }
  });
}
function authenticate(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let text = "";
    const done = (err) => {
      socket.off("data", onData);
      socket.off("error", onError);
      clearTimeout(timer);
      err === null ? resolve() : reject(err);
    };
    const onError = (err) => done(err);
    const onData = (chunk) => {
      text += chunk.toString("latin1");
      const end = text.indexOf(`\r
`);
      if (end === -1) {
        return;
      }
      const line = text.slice(0, end);
      if (line.startsWith("OK")) {
        socket.write(`BEGIN\r
`);
        done(null);
        return;
      }
      if (line.startsWith("REJECTED")) {
        done(new Error(`dbus: authentication rejected (${line.slice(9).trim() || "no mechanisms offered"})`));
        return;
      }
      done(new Error(`dbus: unexpected authentication reply ${JSON.stringify(line)}`));
    };
    const timer = setTimeout(() => done(new Error(`dbus: no authentication reply in ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    socket.on("data", onData);
    socket.once("error", onError);
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const credential = Buffer.from(String(uid), "utf8").toString("hex");
    socket.write(`\x00AUTH EXTERNAL ${credential}\r
`);
  });
}
export {
  DBusError,
  DBusClient
};
