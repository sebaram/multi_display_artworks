import { test, expect } from "vitest";
import { calibrateAvatar } from "../../src/avatar/calibration";
import {
  sampleAvatarInput,
  createXRInputState,
} from "../../src/avatar/xr-input";
import {
  avatarPoseChanged,
  axisAngle,
  identityPose,
  jointWorldTransforms,
} from "../../src/avatar/pose";
import { updateAvatarMotion } from "../../src/avatar/motion";
import type { AvatarPreset, Transform } from "../../src/avatar/types";
import catalog from "../../public/avatars/catalog.fixture.json";
const transform = (x = 0, y = 1.64, z = 0) => ({
  transform: { position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
});
const origin: Transform = {
  position: [10, 0, 20],
  orientation: axisAngle([0, 1, 0], Math.PI / 2),
};
const calibration = {
  version: 1,
  eyeHeight: 1.64,
  floorOffset: 0,
  mode: "standing",
  referenceSpace: "local-floor",
} as const;
function fixture() {
  const grip = {},
    wrist = {},
    ray = {};
  const session = {
    inputSources: [
      { handedness: "left", gripSpace: grip, targetRaySpace: ray },
    ] as any[],
  };
  const values = new Map<any, any>([
    [grip, transform(-0.3, 1.25, -0.25)],
    [wrist, transform(-0.35, 1.3, -0.2)],
    [ray, transform(100, 100, 100)],
  ]);
  const frame = {
    session,
    getViewerPose: () => transform(0.2, 1.64, -0.1),
    getPose: (s: any) => values.get(s),
    getJointPose: (s: any) => values.get(s),
  };
  const state = createXRInputState();
  const sample = (sampleTime: number, extra: any = {}) =>
    sampleAvatarInput({
      frame,
      referenceSpace: {},
      xrOrigin: origin,
      calibration,
      sampleTime,
      state,
      ...extra,
    });
  return { frame, session, values, grip, wrist, sample };
}
test("one frame maps viewer and grip through the virtual origin exactly once; ray is never an arm target", () => {
  const i = fixture().sample(100);
  expect(i.head!.position[0]).toBeCloseTo(9.9);
  expect(i.head!.position[2]).toBeCloseTo(19.8);
  expect(i.left!.position[0]).toBeCloseTo(9.75);
  expect(i.left!.position[2]).toBeCloseTo(20.3);
  expect(i.right).toBeNull();
  expect(i.tracking).toEqual({ head: true, left: true, right: false });
  expect(i.root.position).toEqual([
    i.head!.position[0],
    0,
    i.head!.position[2],
  ]);
  expect(i.bodyScale).toBeCloseTo(1);
});
test("hand wrist replaces grip; missing/invalid data expires after 250ms and stale samples cannot revive it", () => {
  const f = fixture();
  f.sample(100);
  f.session.inputSources[0].hand = new Map([["wrist", f.wrist]]);
  expect(f.sample(150).left!.position[2]).toBeCloseTo(20.35);
  f.values.set(f.wrist, {
    transform: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 0 },
    },
  });
  expect(f.sample(399).tracking.left).toBe(true);
  expect(f.sample(401).tracking.left).toBe(false);
  f.values.set(f.wrist, transform());
  expect(f.sample(200).tracking.left).toBe(false);
  expect(f.sample(450).tracking.left).toBe(true);
  expect(f.sample(451, { frame: null }).tracking).toEqual({
    head: false,
    left: false,
    right: false,
  });
});
test("local space establishes floor offset; seated height preserves known or default standing size", () => {
  const standing = calibrateAvatar({
    viewer: transform(0, 1.8).transform,
    floorMode: "local-floor",
    posture: "standing",
  });
  expect(standing.eyeHeight).toBe(1.8);
  const seated = calibrateAvatar({
    viewer: transform(0, 1.1).transform,
    floorMode: "local-floor",
    posture: "seated",
    previous: standing,
  });
  expect(seated.eyeHeight).toBe(1.8);
  expect(
    calibrateAvatar({
      viewer: transform(0, 1.1).transform,
      floorMode: "local-floor",
      posture: "seated",
    }).eyeHeight,
  ).toBe(1.64);
  const local = calibrateAvatar({
    viewer: transform(0, 0).transform,
    floorMode: "local",
    posture: "standing",
  });
  expect(local.floorOffset).toBeCloseTo(-1.64);
  const input = fixture().sample(100, {
    calibration: local,
    xrOrigin: { position: [0, 1.64, 0], orientation: [0, 0, 0, 1] },
  });
  expect(input.root.position[1]).toBeCloseTo(0);
  expect(
    calibrateAvatar({
      viewer: transform(0, NaN).transform,
      floorMode: "local-floor",
      posture: "standing",
    }).eyeHeight,
  ).toBe(1.64);
});
test("origin teleport drops old cached hands and velocity; session replacement clears tracking history", () => {
  const f = fixture();
  f.sample(100);
  f.session.inputSources = [];
  const tele = f.sample(150, {
    xrOrigin: { ...origin, position: [50, 0, 50] },
    teleport: true,
  });
  expect(tele.tracking.left).toBe(false);
  expect(tele.locomotion.teleport).toBe(true);
  expect(tele.locomotion.velocity).toEqual([0, 0, 0]);
  f.frame.session = { inputSources: [] };
  expect(f.sample(160).tracking.left).toBe(false);
});
test.each([1.1, 1.05, 0.95])(
  "seated owner at %sm keeps body scale, matches tilted eye anchor and grounds inferred legs",
  (eyeHeight) => {
    const preset = catalog.presets[0] as unknown as AvatarPreset;
    const f = fixture();
    f.frame.getViewerPose = () => transform(0, eyeHeight, 0);
    const i = f.sample(100, {
      floorHeight: 0,
      xrOrigin: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      calibration: { ...calibration, mode: "seated" },
    });
    i.head!.orientation = axisAngle([1, 0, 0], 0.5);
    const pose = updateAvatarMotion(
      { preset, applyPose() {} } as any,
      i,
      0.016,
      { height: 0 },
      "full",
    );
    const joints = jointWorldTransforms(pose, preset);
    expect(pose.bodyScale).toBe(1);
    expect(pose.hipsOffset[1]).toBeLessThan(-0.5);
    expect(joints.leftFoot.position[1]).toBeCloseTo(0.08, 2);
    const { rotate, add, mul } = requirePose;
    const eye = add(
      joints.head.position,
      mul(rotate(joints.head.orientation, [0, 0.08, 0]), pose.bodyScale!),
    );
    expect(
      Math.hypot(...eye.map((x, n) => x - i.head!.position[n])),
    ).toBeLessThan(0.001);
  },
);
import * as requirePose from "../../src/avatar/pose";
test("stationary publishing notices tracking and body scale metadata", () => {
  const a = identityPose(),
    b = identityPose();
  expect(avatarPoseChanged(a, b)).toBe(false);
  b.tracking.left = true;
  expect(avatarPoseChanged(a, b)).toBe(true);
  b.tracking.left = false;
  b.bodyScale = 1.01;
  expect(avatarPoseChanged(a, b)).toBe(true);
});
