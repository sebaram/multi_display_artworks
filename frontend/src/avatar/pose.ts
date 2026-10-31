import type {
  AvatarPoseV2,
  AvatarPreset,
  Quat,
  Transform,
  Vec3,
} from "./types";
import { interpolateGaze } from './gaze-pose';
export const CORE_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;
export const add = (a: Vec3, b: Vec3): Vec3 =>
  a.map((x, i) => x + b[i]) as Vec3;
export const sub = (a: Vec3, b: Vec3): Vec3 =>
  a.map((x, i) => x - b[i]) as Vec3;
export const mul = (a: Vec3, s: number): Vec3 => a.map((x) => x * s) as Vec3;
export const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (v: Vec3, fallback: Vec3 = [0, -1, 0]): Vec3 =>
  Math.hypot(...v) > 1e-8 && v.every(Number.isFinite)
    ? mul(v, 1 / Math.hypot(...v))
    : [...fallback];
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export function quaternion(q: ArrayLike<number>): Quat {
  const n = Math.hypot(...Array.from(q));
  return n > 1e-8 && Number.isFinite(n)
    ? (Array.from(q, (x) => x / n) as Quat)
    : [0, 0, 0, 1];
}
export const inverse = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export function product(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return quaternion([
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ]);
}
export const axisAngle = (axis: Vec3, angle: number): Quat =>
  [...mul(unit(axis), Math.sin(angle / 2)), Math.cos(angle / 2)] as Quat;
export function rotate(q: Quat, v: Vec3): Vec3 {
  const u = q.slice(0, 3) as Vec3,
    t = mul(cross(u, v), 2);
  return add(v, add(mul(t, q[3]), cross(u, t)));
}
export function fromTo(a: Vec3, b: Vec3): Quat {
  const u = unit(a),
    v = unit(b),
    d = dot(u, v);
  return d < -0.999999
    ? axisAngle(
        unit(cross(u, Math.abs(u[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1])),
        Math.PI,
      )
    : quaternion([...cross(u, v), 1 + d]);
}
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a.reduce((s, x, i) => s + x * b[i], 0),
    q = b;
  if (d < 0) {
    q = b.map((x) => -x) as Quat;
    d = -d;
  }
  if (d > 0.9995) return quaternion(a.map((x, i) => x + (q[i] - x) * t));
  const angle = Math.acos(clamp(d, -1, 1)),
    s = Math.sin(angle);
  return quaternion(
    a.map(
      (x, i) =>
        (x * Math.sin((1 - t) * angle) + q[i] * Math.sin(t * angle)) / s,
    ),
  );
}
export function identityPose(): AvatarPoseV2 {
  const boneRotations = new Float32Array(88);
  for (let i = 3; i < 88; i += 4) boneRotations[i] = 1;
  return {
    version: 2,
    rigVersion: "humanoid-v1",
    sequence: 0,
    sampleTime: 0,
    root: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    hipsOffset: [0, 0, 0],
    bodyScale: 1,
    boneRotations,
    tracking: { head: true, left: false, right: false },
    teleport: false,
  };
}
export function avatarPoseChanged(
  a: AvatarPoseV2 | undefined,
  b: AvatarPoseV2,
) {
  if (
    !a ||
    b.teleport ||
    a.rigVersion !== b.rigVersion ||
    a.bodyScale !== b.bodyScale ||
    a.tracking.head !== b.tracking.head ||
    a.tracking.left !== b.tracking.left ||
    a.tracking.right !== b.tracking.right
    || !!a.gaze !== !!b.gaze
    || Math.abs((a.gaze?.yaw ?? 0) - (b.gaze?.yaw ?? 0)) > .002
    || Math.abs((a.gaze?.pitch ?? 0) - (b.gaze?.pitch ?? 0)) > .002
  )
    return true;
  const old = [
    ...a.root.position,
    ...a.root.orientation,
    ...a.hipsOffset,
    ...a.boneRotations,
  ];
  return [
    ...b.root.position,
    ...b.root.orientation,
    ...b.hipsOffset,
    ...b.boneRotations,
  ].some((v, i) => Math.abs(v - old[i]) > 0.002);
}
export function interpolateAvatarPose(
  a: AvatarPoseV2,
  b: AvatarPoseV2,
  t: number,
  joints = true,
): AvatarPoseV2 {
  if (b.teleport || a.rigVersion !== b.rigVersion) return b;
  t = clamp(t, 0, 1);
  const lerp = (u: Vec3, v: Vec3) => add(u, mul(sub(v, u), t));
  const boneRotations = joints ? new Float32Array(88) : b.boneRotations;
  for (let i = 0; joints && i < 88; i += 4)
    boneRotations.set(
      slerp(
        Array.from(a.boneRotations.slice(i, i + 4)) as Quat,
        Array.from(b.boneRotations.slice(i, i + 4)) as Quat,
        t,
      ),
      i,
    );
  return {
    ...b,
    root: {
      position: lerp(a.root.position, b.root.position),
      orientation: slerp(a.root.orientation, b.root.orientation, t),
    },
    hipsOffset: lerp(a.hipsOffset, b.hipsOffset),
    bodyScale:
      (a.bodyScale ?? 1) + ((b.bodyScale ?? 1) - (a.bodyScale ?? 1)) * t,
    boneRotations,
    gaze: interpolateGaze(a.gaze, b.gaze, t),
  };
}
export function jointWorldTransforms(
  pose: AvatarPoseV2,
  preset: AvatarPreset,
): Record<string, Transform> {
  const joints: Record<string, Transform> = {};
  preset.coreBones.forEach((name, i) => {
    const rest = preset.restPose[name],
      parent = rest.parent ? joints[rest.parent] : pose.root;
    const offset =
      name === "hips" ? add(rest.position, pose.hipsOffset) : rest.position;
    joints[name] = {
      position: add(
        parent.position,
        rotate(parent.orientation, mul(offset, pose.bodyScale ?? 1)),
      ),
      orientation: product(
        parent.orientation,
        Array.from(pose.boneRotations.slice(i * 4, i * 4 + 4)) as Quat,
      ),
    };
  });
  return joints;
}
export class AvatarPoseBuffer {
  private serverOffset: number | undefined;
  private users = new Map<
    string,
    {
      generation: string;
      retired: Set<string>;
      offset: number;
      discontinuity: object;
      samples: { at: number; pose: AvatarPoseV2 }[];
    }
  >();
  record(
    id: string,
    pose: AvatarPoseV2,
    generation: string,
    serverTime: number,
    receivedAt: number,
  ) {
    let entry = this.users.get(id);
    if (entry?.retired.has(generation)) return false;
    if (!entry || entry.generation !== generation) {
      const retired = entry?.retired ?? new Set<string>();
      if (entry) retired.add(entry.generation);
      if (retired.size > 8) retired.delete(retired.values().next().value!);
      entry = {
        generation,
        retired,
        offset: this.serverOffset ?? receivedAt - serverTime,
        discontinuity: {},
        samples: [],
      };
      this.users.set(id, entry);
    }
    if (
      entry.samples.length &&
      pose.sequence <= entry.samples.at(-1)!.pose.sequence
    )
      return false;
    if (pose.teleport) { entry.samples = []; entry.discontinuity = {}; }
    entry.samples.push({ at: serverTime + entry.offset, pose });
    if (entry.samples.length > 8) entry.samples.shift();
    return true;
  }
  synchronizeClock(serverTime: number, receivedAt: number) {
    if (Number.isFinite(serverTime))
      this.serverOffset = receivedAt - serverTime;
  }
  poseAt(id: string, time: number, joints = true) {
    const samples = this.users.get(id)?.samples;
    if (!samples?.length) return null;
    const target = time - 100;
    if (target <= samples[0].at) return samples[0].pose;
    const i = samples.findIndex((s) => s.at > target);
    if (i < 0) return samples.at(-1)!.pose;
    return interpolateAvatarPose(
      samples[i - 1].pose,
      samples[i].pose,
      (target - samples[i - 1].at) / (samples[i].at - samples[i - 1].at),
      joints,
    );
  }
  userIds() {
    return [...this.users.keys()];
  }
  /** Changes only on accepted generation/teleport boundaries, not each render. */
  discontinuity(id: string) { return this.users.get(id)?.discontinuity; }
  forget(id: string) {
    this.users.delete(id);
  }
  clear() {
    this.users.clear();
    this.serverOffset = undefined;
  }
}
