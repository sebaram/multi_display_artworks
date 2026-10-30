import type {
  AvatarInputV2,
  Calibration,
  Transform,
  Vec3,
  Quat,
} from "./types";
import { add, rotate, product, sub, mul, clamp, quaternion } from "./pose";
import { AVATAR_EYE_HEIGHT } from "./calibration";
type Side = "head" | "left" | "right";
type XRInputState = {
  session?: any;
  targets: Partial<Record<Side, { at: number; target: Transform }>>;
  last?: AvatarInputV2;
};
export function createXRInputState(): XRInputState {
  return { targets: {} };
}
/** Invalid sensor quaternions are tracking loss, never fabricated identity orientation. */
export function readXRTransform(pose: any): Transform | null {
  const p = pose?.transform?.position,
    q = pose?.transform?.orientation;
  if (!p || !q) return null;
  const position: Vec3 = [p.x, p.y, p.z],
    orientation: Quat = [q.x, q.y, q.z, q.w];
  if (
    ![...position, ...orientation].every(Number.isFinite) ||
    Math.abs(Math.hypot(...orientation) - 1) > 0.01
  )
    return null;
  return { position, orientation: quaternion(orientation) };
}
export function transformXRTarget(
  target: Transform,
  origin: Transform,
): Transform {
  return {
    position: add(origin.position, rotate(origin.orientation, target.position)),
    orientation: product(origin.orientation, target.orientation),
  };
}
function safely(read: () => any) {
  try {
    return read();
  } catch {
    return null;
  }
}
/** Consumes A-Frame's current frame/active reference space; never requests or owns a session. */
export function sampleAvatarInput({
  frame,
  referenceSpace,
  xrOrigin,
  calibration,
  sampleTime,
  state = createXRInputState(),
  floorHeight,
  teleport = false,
}: {
  frame: any;
  referenceSpace: any;
  xrOrigin: Transform;
  calibration: Calibration;
  sampleTime: number;
  state?: XRInputState;
  floorHeight?: number;
  teleport?: boolean;
}): AvatarInputV2 {
  const session = frame?.session;
  if (session !== state.session || teleport || !frame) {
    state.targets = {};
    state.last = undefined;
    state.session = session;
  }
  if (state.last && sampleTime <= state.last.sampleTime) return state.last;
  const current: Partial<Record<Side, Transform | null>> = {};
  if (frame && referenceSpace) {
    current.head = readXRTransform(
      safely(() => frame.getViewerPose(referenceSpace)),
    );
    for (const source of session?.inputSources ?? []) {
      if (source.handedness !== "left" && source.handedness !== "right")
        continue;
      const wrist = source.hand?.get("wrist");
      const pose = source.hand
        ? wrist && safely(() => frame.getJointPose(wrist, referenceSpace))
        : source.gripSpace &&
          safely(() => frame.getPose(source.gripSpace, referenceSpace));
      const target = readXRTransform(pose);
      if (target) current[source.handedness as Side] = target;
    }
  }
  const targets = {} as Record<Side, Transform | null>,
    tracking = { head: false, left: false, right: false };
  for (const side of ["head", "left", "right"] as const) {
    if (current[side])
      state.targets[side] = { at: sampleTime, target: current[side]! };
    const cached = state.targets[side];
    tracking[side] = !!cached && sampleTime - cached.at <= 250;
    targets[side] = tracking[side]
      ? transformXRTarget(cached!.target, xrOrigin)
      : null;
  }
  const floor = Number.isFinite(floorHeight)
    ? floorHeight!
    : transformXRTarget(
        {
          position: [0, calibration.floorOffset, 0],
          orientation: [0, 0, 0, 1],
        },
        xrOrigin,
      ).position[1];
  const head = targets.head,
    previous = state.last;
  const root = {
    position: [
      head?.position[0] ?? previous?.root.position[0] ?? xrOrigin.position[0],
      floor,
      head?.position[2] ?? previous?.root.position[2] ?? xrOrigin.position[2],
    ] as Vec3,
    orientation: xrOrigin.orientation,
  };
  const displacement = previous
    ? sub(root.position, previous.root.position)
    : ([0, 0, 0] as Vec3);
  teleport ||= !previous || Math.hypot(displacement[0], displacement[2]) > 0.75;
  const velocity = teleport
    ? ([0, 0, 0] as Vec3)
    : mul(displacement, 1000 / Math.max(1, sampleTime - previous!.sampleTime));
  velocity[1] = 0;
  const input: AvatarInputV2 = {
    version: 2,
    sampleTime,
    root,
    bodyScale: clamp(calibration.eyeHeight / AVATAR_EYE_HEIGHT, 0.5, 2),
    posture: calibration.mode,
    head,
    left: targets.left,
    right: targets.right,
    tracking,
    locomotion: { velocity, grounded: Number.isFinite(floorHeight), teleport },
  };
  state.last = input;
  return input;
}
