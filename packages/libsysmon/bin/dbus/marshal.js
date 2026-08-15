// src/dbus/marshal.ts
import { Variant, align, alignmentOf, completeTypeLength, parseSignature } from "./types.js";

class Writer {
  #buffer;
  #length = 0;
  littleEndian;
  constructor(littleEndian = true, capacity = 256) {
    this.littleEndian = littleEndian;
    this.#buffer = Buffer.alloc(capacity);
  }
  get length() {
    return this.#length;
  }
  take() {
    return this.#buffer.subarray(0, this.#length);
  }
  #room(extra) {
    if (this.#length + extra <= this.#buffer.length) {
      return;
    }
    let capacity = this.#buffer.length * 2;
    while (capacity < this.#length + extra) {
      capacity *= 2;
    }
    const grown = Buffer.alloc(capacity);
    this.#buffer.copy(grown, 0, 0, this.#length);
    this.#buffer = grown;
  }
  align(to) {
    const target = align(this.#length, to);
    if (target === this.#length) {
      return;
    }
    this.#room(target - this.#length);
    this.#buffer.fill(0, this.#length, target);
    this.#length = target;
  }
  byte(value) {
    this.#room(1);
    this.#buffer.writeUInt8(value & 255, this.#length);
    this.#length += 1;
  }
  uint16(value) {
    this.#room(2);
    this.littleEndian ? this.#buffer.writeUInt16LE(value, this.#length) : this.#buffer.writeUInt16BE(value, this.#length);
    this.#length += 2;
  }
  int16(value) {
    this.#room(2);
    this.littleEndian ? this.#buffer.writeInt16LE(value, this.#length) : this.#buffer.writeInt16BE(value, this.#length);
    this.#length += 2;
  }
  uint32(value) {
    this.#room(4);
    this.littleEndian ? this.#buffer.writeUInt32LE(value, this.#length) : this.#buffer.writeUInt32BE(value, this.#length);
    this.#length += 4;
  }
  int32(value) {
    this.#room(4);
    this.littleEndian ? this.#buffer.writeInt32LE(value, this.#length) : this.#buffer.writeInt32BE(value, this.#length);
    this.#length += 4;
  }
  uint64(value) {
    this.#room(8);
    this.littleEndian ? this.#buffer.writeBigUInt64LE(value, this.#length) : this.#buffer.writeBigUInt64BE(value, this.#length);
    this.#length += 8;
  }
  int64(value) {
    this.#room(8);
    this.littleEndian ? this.#buffer.writeBigInt64LE(value, this.#length) : this.#buffer.writeBigInt64BE(value, this.#length);
    this.#length += 8;
  }
  double(value) {
    this.#room(8);
    this.littleEndian ? this.#buffer.writeDoubleLE(value, this.#length) : this.#buffer.writeDoubleBE(value, this.#length);
    this.#length += 8;
  }
  bytes(value) {
    this.#room(value.length);
    value.copy(this.#buffer, this.#length);
    this.#length += value.length;
  }
  patchUint32(at, value) {
    this.littleEndian ? this.#buffer.writeUInt32LE(value, at) : this.#buffer.writeUInt32BE(value, at);
  }
}
function big(value) {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(Number(value)));
}
function writeValue(writer, type, value) {
  const code = type[0];
  switch (code) {
    case "y":
      writer.byte(Number(value));
      return;
    case "b":
      writer.align(4);
      writer.uint32(value === true || value === 1 ? 1 : 0);
      return;
    case "n":
      writer.align(2);
      writer.int16(Number(value));
      return;
    case "q":
      writer.align(2);
      writer.uint16(Number(value));
      return;
    case "i":
      writer.align(4);
      writer.int32(Number(value));
      return;
    case "u":
    case "h":
      writer.align(4);
      writer.uint32(Number(value));
      return;
    case "x":
      writer.align(8);
      writer.int64(big(value));
      return;
    case "t":
      writer.align(8);
      writer.uint64(big(value));
      return;
    case "d":
      writer.align(8);
      writer.double(Number(value));
      return;
    case "s":
    case "o": {
      const text = Buffer.from(String(value), "utf8");
      writer.align(4);
      writer.uint32(text.length);
      writer.bytes(text);
      writer.byte(0);
      return;
    }
    case "g": {
      const text = Buffer.from(String(value), "utf8");
      writer.byte(text.length);
      writer.bytes(text);
      writer.byte(0);
      return;
    }
    case "a": {
      const element = type.slice(1);
      const items = toArray(element, value);
      writer.align(4);
      const lengthAt = writer.length;
      writer.uint32(0);
      writer.align(alignmentOf(element));
      const start = writer.length;
      for (const item of items) {
        writeValue(writer, element, item);
      }
      writer.patchUint32(lengthAt, writer.length - start);
      return;
    }
    case "(": {
      const fields = parseSignature(type.slice(1, -1));
      const values = value;
      writer.align(8);
      fields.forEach((field, i) => writeValue(writer, field, values[i]));
      return;
    }
    case "{": {
      const [keyType, valueType] = parseSignature(type.slice(1, -1));
      const pair = value;
      writer.align(8);
      writeValue(writer, keyType, pair[0]);
      writeValue(writer, valueType, pair[1]);
      return;
    }
    case "v": {
      if (!(value instanceof Variant)) {
        throw new Error("dbus: a variant must be marshalled as a Variant, so its signature is stated");
      }
      writeValue(writer, "g", value.signature);
      writeValue(writer, value.signature, value.value);
      return;
    }
    default:
      throw new Error(`dbus: cannot marshal type ${JSON.stringify(type)}`);
  }
}
function toArray(element, value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (element.startsWith("{") && value !== null && typeof value === "object" && !(value instanceof Variant)) {
    return Object.entries(value).map(([key, item]) => [key, item]);
  }
  throw new Error(`dbus: expected an array for ${JSON.stringify(element)}`);
}
function marshal(signature, values, littleEndian = true) {
  const writer = new Writer(littleEndian);
  const types = parseSignature(signature);
  types.forEach((type, i) => writeValue(writer, type, values[i]));
  return Buffer.from(writer.take());
}
export {
  writeValue,
  parseSignature,
  marshal,
  completeTypeLength,
  Writer
};
