// src/dbus/types.ts
class Variant {
  signature;
  value;
  constructor(signature, value) {
    this.signature = signature;
    this.value = value;
  }
}
var ALIGNMENT = {
  y: 1,
  b: 4,
  n: 2,
  q: 2,
  i: 4,
  u: 4,
  x: 8,
  t: 8,
  d: 8,
  s: 4,
  o: 4,
  g: 1,
  a: 4,
  v: 1,
  h: 4,
  "(": 8,
  "{": 8
};
function alignmentOf(type) {
  return ALIGNMENT[type[0]] ?? 1;
}
function align(offset, to) {
  const over = offset % to;
  return over === 0 ? offset : offset + (to - over);
}
function completeTypeLength(signature, at = 0) {
  const code = signature[at];
  if (code === undefined) {
    throw new Error(`dbus: signature ended early in ${JSON.stringify(signature)}`);
  }
  if (code === "a") {
    return 1 + completeTypeLength(signature, at + 1);
  }
  if (code === "(" || code === "{") {
    const close = code === "(" ? ")" : "}";
    let depth = 0;
    for (let i = at;i < signature.length; i++) {
      const ch = signature[i];
      if (ch === "(" || ch === "{") {
        depth++;
      } else if (ch === ")" || ch === "}") {
        depth--;
        if (depth === 0) {
          if (ch !== close) {
            throw new Error(`dbus: mismatched brackets in ${JSON.stringify(signature)}`);
          }
          return i - at + 1;
        }
      }
    }
    throw new Error(`dbus: unclosed ${code} in ${JSON.stringify(signature)}`);
  }
  if (ALIGNMENT[code] === undefined) {
    throw new Error(`dbus: unknown type code ${JSON.stringify(code)} in ${JSON.stringify(signature)}`);
  }
  return 1;
}
function parseSignature(signature) {
  const types = [];
  let at = 0;
  while (at < signature.length) {
    const length = completeTypeLength(signature, at);
    types.push(signature.slice(at, at + length));
    at += length;
  }
  return types;
}
export {
  parseSignature,
  completeTypeLength,
  alignmentOf,
  align,
  Variant,
  ALIGNMENT
};
