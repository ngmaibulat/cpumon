// src/dbus/message.ts
import { Variant, align, parseSignature } from "./types.js";
import { Writer, writeValue } from "./marshal.js";
import { Reader, readValue } from "./unmarshal.js";
var LITTLE_ENDIAN = 108;
var BIG_ENDIAN = 66;
var PROTOCOL_VERSION = 1;
var MESSAGE_TYPE = {
  methodCall: 1,
  methodReturn: 2,
  error: 3,
  signal: 4
};
var FIXED_HEADER = 16;
var FIELD = {
  path: 1,
  iface: 2,
  member: 3,
  errorName: 4,
  replySerial: 5,
  destination: 6,
  sender: 7,
  signature: 8,
  unixFds: 9
};
var FIELD_TYPE = {
  [FIELD.path]: "o",
  [FIELD.iface]: "s",
  [FIELD.member]: "s",
  [FIELD.errorName]: "s",
  [FIELD.replySerial]: "u",
  [FIELD.destination]: "s",
  [FIELD.sender]: "s",
  [FIELD.signature]: "g",
  [FIELD.unixFds]: "u"
};
function encodeMessage(options) {
  const littleEndian = options.littleEndian ?? true;
  const signature = options.signature ?? "";
  const bodyWriter = new Writer(littleEndian);
  if (signature !== "") {
    parseSignature(signature).forEach((type, i) => {
      writeValue(bodyWriter, type, (options.body ?? [])[i]);
    });
  }
  const body = bodyWriter.take();
  const fields = [];
  const push = (code, value) => {
    if (value !== undefined && value !== "") {
      fields.push([code, new Variant(FIELD_TYPE[code], value)]);
    }
  };
  push(FIELD.path, options.path);
  push(FIELD.iface, options.iface);
  push(FIELD.member, options.member);
  push(FIELD.destination, options.destination);
  push(FIELD.signature, signature);
  const writer = new Writer(littleEndian);
  writer.byte(littleEndian ? LITTLE_ENDIAN : BIG_ENDIAN);
  writer.byte(options.type);
  writer.byte(options.flags ?? 0);
  writer.byte(PROTOCOL_VERSION);
  writer.uint32(body.length);
  writer.uint32(options.serial);
  writeValue(writer, "a(yv)", fields);
  writer.align(8);
  writer.bytes(Buffer.from(body));
  return Buffer.from(writer.take());
}
function messageLength(buffer) {
  if (buffer.length < FIXED_HEADER) {
    return null;
  }
  const littleEndian = buffer.readUInt8(0) === LITTLE_ENDIAN;
  const bodyLength = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
  const fieldsLength = littleEndian ? buffer.readUInt32LE(12) : buffer.readUInt32BE(12);
  const total = align(FIXED_HEADER + fieldsLength, 8) + bodyLength;
  return buffer.length < total ? null : total;
}
function decodeMessage(buffer) {
  const endianness = buffer.readUInt8(0);
  if (endianness !== LITTLE_ENDIAN && endianness !== BIG_ENDIAN) {
    throw new Error(`dbus: unknown endianness byte 0x${endianness.toString(16)}`);
  }
  const littleEndian = endianness === LITTLE_ENDIAN;
  const reader = new Reader(buffer, 1, littleEndian);
  const type = reader.byte();
  const flags = reader.byte();
  reader.byte();
  const bodyLength = reader.uint32();
  const serial = reader.uint32();
  const header = { littleEndian, type, flags, serial, bodyLength };
  for (const entry of readValue(reader, "a(yv)")) {
    const [code, value] = entry;
    switch (Number(code)) {
      case FIELD.path:
        header.path = String(value);
        break;
      case FIELD.iface:
        header.iface = String(value);
        break;
      case FIELD.member:
        header.member = String(value);
        break;
      case FIELD.errorName:
        header.errorName = String(value);
        break;
      case FIELD.replySerial:
        header.replySerial = Number(value);
        break;
      case FIELD.destination:
        header.destination = String(value);
        break;
      case FIELD.sender:
        header.sender = String(value);
        break;
      case FIELD.signature:
        header.signature = String(value);
        break;
      default:
        break;
    }
  }
  reader.align(8);
  const body = header.signature === undefined || header.signature === "" ? [] : parseBody(header.signature, buffer, reader.offset, littleEndian);
  return { ...header, body };
}
function parseBody(signature, buffer, offset, littleEndian) {
  const reader = new Reader(buffer, offset, littleEndian);
  return parseSignature(signature).map((type) => readValue(reader, type));
}
export {
  messageLength,
  encodeMessage,
  decodeMessage,
  PROTOCOL_VERSION,
  MESSAGE_TYPE,
  LITTLE_ENDIAN,
  FIXED_HEADER,
  FIELD,
  BIG_ENDIAN
};
