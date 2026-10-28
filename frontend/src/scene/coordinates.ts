export type Point = { x: number; y: number; z: number };
export function vector(
  value: unknown,
  fallback: Point = { x: 0, y: 0, z: 0 },
): Point {
  if (typeof value === "string") {
    const p = value.trim().split(/\s+/).map(Number);
    if (p.length === 3 && p.every(Number.isFinite))
      return { x: p[0], y: p[1], z: p[2] };
  }
  if (value && typeof value === "object") {
    const p = value as Point;
    if ([p.x, p.y, p.z].every(Number.isFinite)) return p;
  }
  return { ...fallback };
}
function rotate(p: Point, axis: "x" | "y" | "z", angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  if (axis === "x")
    return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
  if (axis === "y")
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}
export function localToWorld(
  point: Point,
  wall: { position?: unknown; rotation?: unknown },
): Point {
  const r = vector(wall.rotation),
    p = vector(wall.position);
  let v = { ...point };
  for (const axis of ["z", "x", "y"] as const)
    v = rotate(v, axis, (r[axis] * Math.PI) / 180);
  return { x: v.x + p.x, y: v.y + p.y, z: v.z + p.z };
}
export function worldToLocal(
  point: Point,
  wall: { position?: unknown; rotation?: unknown },
): Point {
  const r = vector(wall.rotation),
    p = vector(wall.position);
  let v = { x: point.x - p.x, y: point.y - p.y, z: point.z - p.z };
  for (const axis of ["y", "x", "z"] as const)
    v = rotate(v, axis, (-r[axis] * Math.PI) / 180);
  return v;
}
export function elementPosition(
  element: {
    position_x?: number;
    position_y?: number;
    position_z?: number;
    wall_element_type?: string;
    position?: unknown;
  },
  wall: { depth?: number; surface_type?: string },
): Point {
  const p = vector(element.position);
  return {
    x: element.position_x ?? p.x,
    y: element.position_y ?? p.y,
    z:
      (wall.surface_type === "floor" || wall.surface_type === "ceiling"
        ? 0
        : wall.depth || 0) +
      (element.wall_element_type === "gltf" ? (element.position_z ?? 0) : 0.05),
  };
}
