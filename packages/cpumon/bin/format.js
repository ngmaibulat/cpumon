const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
function bytes(value) {
  let scaled = Math.abs(value);
  let unit = 0;
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${(value < 0 ? -scaled : scaled).toFixed(digits)} ${UNITS[unit]}`;
}
function rate(bytesPerSec) {
  return `${bytes(bytesPerSec)}/s`;
}
function gib(value) {
  return (value / 1024 ** 3).toFixed(1);
}
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (days > 0 || hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  return parts.join(" ");
}
function shortId(id) {
  const hex = id.match(/^(?:docker-|libpod-|crio-|cri-containerd-)([0-9a-f]{12})/);
  return hex === null ? id : hex[1];
}
function percent(ratio, digits = 0) {
  return `${(ratio * 100).toFixed(digits)}%`;
}
function duration(ms) {
  if (ms < 1e3) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1e3;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${Math.floor(seconds % 60)}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export {
  bytes,
  duration,
  formatUptime,
  gib,
  percent,
  rate,
  shortId
};
