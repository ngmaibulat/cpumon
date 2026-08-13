// src/types.ts
function unavailable(reason, detail) {
  return detail === undefined ? { available: false, reason } : { available: false, reason, detail };
}
function isAvailable(probe) {
  return probe.available;
}
export {
  unavailable,
  isAvailable
};
