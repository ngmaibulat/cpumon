function unavailable(reason, detail) {
  return detail === void 0 ? { available: false, reason } : { available: false, reason, detail };
}
function isAvailable(probe) {
  return probe.available;
}
export {
  isAvailable,
  unavailable
};
