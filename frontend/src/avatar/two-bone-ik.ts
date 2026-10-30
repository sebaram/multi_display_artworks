import type { Vec3 } from "./types";
import {
  add,
  sub,
  mul,
  dot,
  cross,
  unit,
  clamp,
  fromTo,
  inverse,
  product,
} from "./pose";
export function solveTwoBone(
  chain: { root: Vec3; upperLength: number; lowerLength: number },
  target: Vec3,
  pole: Vec3,
  limits = { minBend: 0.03, maxBend: 2.9 },
) {
  const root = chain.root.every(Number.isFinite)
    ? chain.root
    : ([0, 0, 0] as Vec3);
  const a = Number.isFinite(chain.upperLength)
      ? Math.max(0.001, chain.upperLength)
      : 0.4,
    b = Number.isFinite(chain.lowerLength)
      ? Math.max(0.001, chain.lowerLength)
      : 0.4;
  const direction = unit(sub(target, root)),
    requested = Math.hypot(...sub(target, root));
  const min = clamp(limits.minBend, 0, Math.PI - 0.001),
    max = clamp(limits.maxBend, min, Math.PI - 0.001);
  const distance = (bend: number) =>
    Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(bend));
  const d = clamp(
    Number.isFinite(requested) ? requested : a + b,
    distance(max),
    distance(min),
  );
  const bend = Math.acos(clamp((d * d - a * a - b * b) / (2 * a * b), -1, 1));
  let perpendicular = sub(
    sub(pole, root),
    mul(direction, dot(sub(pole, root), direction)),
  );
  if (
    !perpendicular.every(Number.isFinite) ||
    Math.hypot(...perpendicular) < 1e-6
  )
    perpendicular = cross(
      direction,
      Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1],
    );
  const along = (a * a + d * d - b * b) / (2 * Math.max(d, 1e-8)),
    height = Math.sqrt(Math.max(0, a * a - along * along));
  const joint = add(
      root,
      add(mul(direction, along), mul(unit(perpendicular), height)),
    ),
    end = add(root, mul(direction, d));
  const upper = fromTo([0, -1, 0], sub(joint, root)),
    lower = product(inverse(upper), fromTo([0, -1, 0], sub(end, joint)));
  return { joint, end, upper, lower, bend };
}
