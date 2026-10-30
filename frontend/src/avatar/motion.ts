import type {
  AvatarInputV2,
  AvatarInstance,
  AvatarPoseV2,
  Vec3,
  Quat,
  GazePose,
} from "./types";
import {
  identityPose,
  add,
  sub,
  mul,
  rotate,
  inverse,
  product,
  axisAngle,
  clamp,
  jointWorldTransforms,
  slerp,
  quaternion,
} from "./pose";
import { solveTwoBone } from "./two-bone-ik";
type Foot = { lock: Vec3; target: Vec3; swinging: boolean; start: Vec3 };
type MotionState = {
  yaw: number;
  phase: number;
  sequence: number;
  upperBody?: { head: Quat; chest: Quat; hips: Vec3 };
  feet: Partial<Record<"left" | "right", Foot>>;
  arms: Partial<
    Record<"left" | "right", { upper: Quat; lower: Quat; hand: Quat }>
  >;
};
const states = new WeakMap<AvatarInstance, MotionState>();
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
const yawOf = (q: Quat) => {
  const f = rotate(q, [0, 0, -1]);
  return Math.atan2(-f[0], -f[2]);
};
/** Run once for the owner; observers use applyPose only. All lengths come from the bind rig. */
export function updateAvatarMotion(
  instance: AvatarInstance,
  input: AvatarInputV2,
  delta: number,
  ground: { height: number } | null,
  _detail: string,
  gaze?: GazePose,
): AvatarPoseV2 {
  const validTarget = (t: AvatarInputV2["head"]) =>
    t && [...t.position, ...t.orientation].every(Number.isFinite)
      ? { position: t.position, orientation: quaternion(t.orientation) }
      : null;
  input = {
    ...input,
    root: {
      position: input.root.position.map((x) =>
        Number.isFinite(x) ? clamp(x, -1e5, 1e5) : 0,
      ) as Vec3,
      orientation: quaternion(input.root.orientation),
    },
    head: validTarget(input.head),
    left: validTarget(input.left),
    right: validTarget(input.right),
    locomotion: {
      ...input.locomotion,
      velocity: input.locomotion.velocity.map((x) =>
        Number.isFinite(x) ? clamp(x, -5, 5) : 0,
      ) as Vec3,
    },
  };
  if (ground && !Number.isFinite(ground.height)) ground = null;
  const preset = instance.preset,
    dt = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1);
  let state = states.get(instance);
  const headYaw = input.head
    ? yawOf(input.head.orientation)
    : yawOf(input.root.orientation);
  if (!state || input.locomotion.teleport) {
    state = {
      yaw: headYaw,
      phase: 0,
      sequence: state?.sequence ?? 0,
      feet: {},
      arms: {},
    };
    states.set(instance, state);
  }
  const speed = Math.hypot(
    input.locomotion.velocity[0],
    input.locomotion.velocity[2],
  );
  let desired = state.yaw;
  if (speed > 0.05) {
    desired = Math.atan2(
      -input.locomotion.velocity[0],
      -input.locomotion.velocity[2],
    );
    if (Math.abs(wrap(desired - headYaw)) > Math.PI / 2)
      desired = wrap(desired + Math.PI);
  } else if (Math.abs(wrap(headYaw - state.yaw)) > 0.65)
    desired = headYaw - Math.sign(wrap(headYaw - state.yaw)) * 0.45;
  const turn = wrap(desired - state.yaw) * Math.min(1, dt * 7);
  state.yaw = wrap(state.yaw + turn);
  const pose = identityPose();
  pose.gaze = gaze;
  pose.sequence = state.sequence++;
  pose.sampleTime = input.sampleTime;
  pose.tracking = { ...input.tracking };
  pose.teleport = input.locomotion.teleport;
  pose.root = {
    position: [...input.root.position],
    orientation: axisAngle([0, 1, 0], state.yaw),
  };
  const scale = input.bodyScale ?? 1;
  pose.bodyScale = clamp(Number.isFinite(scale) ? scale : 1, 0.5, 2);
  if (ground) pose.root.position[1] = ground.height;
  const set = (name: string, q: Quat) =>
    pose.boneRotations.set(q, preset.coreBones.indexOf(name as any) * 4);
  const walking =
    !!ground &&
    input.posture !== "seated" &&
    input.locomotion.grounded &&
    (speed > 0.04 || Math.abs(turn) > 0.001);
  if (walking)
    state.phase =
      (state.phase +
        dt *
          (Math.max(0.6, speed) * 1.5 +
            (Math.abs(turn) / Math.max(dt, 0.001)) * 0.3)) %
      1;
  if (input.head && input.tracking.head) {
    const chestYaw = clamp(wrap(headYaw - state.yaw) * 0.2, -0.2, 0.2);
    set("upperChest", axisAngle([0, 1, 0], chestYaw));
    const relative = product(
      inverse(product(pose.root.orientation, axisAngle([0, 1, 0], chestYaw))),
      input.head.orientation,
    );
    const forward = rotate(relative, [0, 0, -1]),
      up = rotate(relative, [0, 1, 0]);
    const yaw = clamp(Math.atan2(-forward[0], -forward[2]), -1.2, 1.2),
      pitch = clamp(Math.asin(clamp(forward[1], -1, 1)), -1.1, 1.1),
      roll = clamp(Math.atan2(-up[0], up[1]), -0.35, 0.35);
    set(
      "head",
      product(
        product(axisAngle([0, 1, 0], yaw), axisAngle([1, 0, 0], pitch)),
        axisAngle([0, 0, 1], roll),
      ),
    );
    if (ground || input.posture) {
      // The eye anchor rotates with the head; matching bone origin alone detaches tilted HMDs.
      const head = jointWorldTransforms(pose, preset).head;
      const eye = add(
        head.position,
        mul(rotate(head.orientation, [0, 0.08, 0]), pose.bodyScale),
      );
      const offset = mul(
        rotate(inverse(pose.root.orientation), sub(input.head.position, eye)),
        1 / pose.bodyScale,
      );
      pose.hipsOffset = [
        clamp(offset[0], -0.25, 0.25),
        clamp(offset[1], input.posture === "seated" ? -1.2 : -0.65, 0.12),
        clamp(offset[2], -0.25, 0.25),
      ];
    }
  }
  if ((!input.head || !input.tracking.head) && state.upperBody) {
    const last = state.upperBody,
      t = Math.min(1, dt * 9);
    set("head", slerp(last.head, [0, 0, 0, 1], t));
    set("upperChest", slerp(last.chest, [0, 0, 0, 1], t));
    const rest: Vec3 = [0, input.posture === "seated" ? -0.54 : 0, 0];
    pose.hipsOffset = add(last.hips, mul(sub(rest, last.hips), t));
  }
  const rotation = (name: string) =>
    Array.from(
      pose.boneRotations.slice(
        preset.coreBones.indexOf(name as any) * 4,
        preset.coreBones.indexOf(name as any) * 4 + 4,
      ),
    ) as Quat;
  state.upperBody = {
    head: rotation("head"),
    chest: rotation("upperChest"),
    hips: [...pose.hipsOffset],
  };
  if (walking) pose.hipsOffset[1] -= 0.045;
  for (const side of ["left", "right"] as const) {
    const sign = side === "left" ? -1 : 1,
      phase = (state.phase + (side === "left" ? 0 : 0.5)) % 1;
    const armSwing = walking
      ? Math.sin(phase * Math.PI * 2) * Math.min(0.5, speed * 0.4)
      : 0;
    const resting = product(
      axisAngle([0, 0, 1], sign * 0.12),
      axisAngle([1, 0, 0], armSwing),
    );
    const target = input[side],
      tracking = input.tracking[side] && target;
    let joints = jointWorldTransforms(pose, preset),
      parent = joints[`${side}Shoulder`];
    const armRoot = preset.restPose[`${side}UpperArm`].position;
    const previous = state.arms[side] ?? {
      upper: resting,
      lower: axisAngle([1, 0, 0], -0.12),
      hand: [0, 0, 0, 1] as Quat,
    };
    if (tracking) {
      const local = mul(
        rotate(
          inverse(parent.orientation),
          sub(target.position, parent.position),
        ),
        1 / pose.bodyScale,
      );
      const solution = solveTwoBone(
        {
          root: armRoot,
          upperLength: Math.hypot(
            ...preset.restPose[`${side}LowerArm`].position,
          ),
          lowerLength: Math.hypot(...preset.restPose[`${side}Hand`].position),
        },
        local,
        add(armRoot, [sign * 0.3, -0.3, 0.4]),
        { minBend: 0.08, maxBend: 2.7 },
      );
      set(`${side}UpperArm`, solution.upper);
      set(`${side}LowerArm`, solution.lower);
      const forearmWorld = product(
        parent.orientation,
        product(solution.upper, solution.lower),
      );
      const hand = product(inverse(forearmWorld), target.orientation);
      set(`${side}Hand`, hand);
      state.arms[side] = { upper: solution.upper, lower: solution.lower, hand };
    } else {
      const t = Math.min(1, dt * 9),
        upper = slerp(previous.upper, resting, t),
        lower = slerp(previous.lower, axisAngle([1, 0, 0], -0.12), t),
        hand = slerp(previous.hand, [0, 0, 0, 1], t);
      set(`${side}UpperArm`, upper);
      set(`${side}LowerArm`, lower);
      set(`${side}Hand`, hand);
      state.arms[side] = { upper, lower, hand };
    }
    if (!ground || !input.locomotion.grounded) {
      state.feet = {};
      continue;
    }
    joints = jointWorldTransforms(pose, preset);
    const nominal = add(
      pose.root.position,
      rotate(pose.root.orientation, [
        sign * 0.1 * pose.bodyScale,
        0.08 * pose.bodyScale,
        // Estimated seated feet extend forward; no chair/physical leg tracking is inferred.
        input.posture === "seated" ? -0.35 * pose.bodyScale : 0,
      ]),
    );
    nominal[1] = ground.height + 0.08 * pose.bodyScale;
    let foot = state.feet[side];
    if (!foot) {
      foot = {
        lock: [...nominal],
        target: [...nominal],
        start: [...nominal],
        swinging: false,
      };
      state.feet[side] = foot;
    }
    const swinging = walking && phase >= 0.5;
    if (swinging) {
      if (!foot.swinging) foot.start = [...foot.target];
      const t = (phase - 0.5) * 2,
        s = t * t * (3 - 2 * t),
        step = mul(input.locomotion.velocity, 0.22);
      const end = add(nominal, step);
      foot.target = add(mul(foot.start, 1 - s), mul(end, s));
      foot.target[1] += Math.sin(t * Math.PI) * 0.09 * pose.bodyScale;
    } else {
      if (foot.swinging) foot.lock = [...foot.target];
      foot.lock[1] = nominal[1];
      if (Math.hypot(...sub(foot.lock, nominal)) > 0.45 * pose.bodyScale)
        foot.lock = [...nominal];
      foot.target = [...foot.lock];
    }
    foot.swinging = swinging;
    const hips = joints.hips,
      local = mul(
        rotate(inverse(hips.orientation), sub(foot.target, hips.position)),
        1 / pose.bodyScale,
      );
    const solution = solveTwoBone(
      {
        root: preset.restPose[`${side}UpperLeg`].position,
        upperLength: Math.hypot(...preset.restPose[`${side}LowerLeg`].position),
        lowerLength: Math.hypot(...preset.restPose[`${side}Foot`].position),
      },
      local,
      [sign * 0.1, -0.3, -1],
      { minBend: 0.03, maxBend: 2.5 },
    );
    set(`${side}UpperLeg`, solution.upper);
    set(`${side}LowerLeg`, solution.lower);
    set(`${side}Foot`, inverse(product(solution.upper, solution.lower)));
  }
  instance.applyPose(pose);
  return pose;
}
