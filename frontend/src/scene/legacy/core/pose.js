const AXES = ['x', 'y', 'z'];

function finite(value) {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

export function toVec3(value) {
  if (value == null) return null;

  const parts = typeof value === 'string'
    ? value.trim().split(/\s+/u)
    : Array.isArray(value)
      ? value
      : AXES.map((axis) => value[axis]);

  if (parts.length !== 3) return null;

  const [x, y, z] = parts.map(finite);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

export function maxAxisDelta(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(...AXES.map((axis) => Math.abs(a[axis] - b[axis])));
}

function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

export function lerpVec3(a, b, t) {
  const ratio = clamp01(t);
  return Object.fromEntries(
    AXES.map((axis) => [axis, a[axis] + (b[axis] - a[axis]) * ratio]),
  );
}

function shortestArc(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function lerpAngles(a, b, t) {
  const ratio = clamp01(t);
  return Object.fromEntries(
    AXES.map((axis) => [axis, a[axis] + shortestArc(a[axis], b[axis]) * ratio]),
  );
}
