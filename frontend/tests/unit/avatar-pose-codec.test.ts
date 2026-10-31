import { expect, test } from "vitest";
import {
  identityPose,
  interpolateAvatarPose,
  AvatarPoseBuffer,
} from "../../src/avatar/pose";
import {
  encodeAvatarPose,
  decodeAvatarPose,
} from "../../src/avatar/pose-codec";

test("little endian full snapshot round trips fixed core22 order and scale", () => {
  const pose = identityPose();
  pose.root.position = [1.25, 2, -3];
  pose.bodyScale = 1.2;
  pose.boneRotations.set([0, 0.6, 0, 0.8], 20);
  const packet = encodeAvatarPose(pose);
  expect(packet.floats.byteLength).toBe(392);
  expect(new DataView(packet.floats).getFloat32(0, true)).toBe(1.25);
  expect(decodeAvatarPose(packet)).toEqual(pose);
});
test("rejects malformed joints, unknown rigs, nonfinite data and invalid scale", () => {
  const packet = encodeAvatarPose(identityPose());
  expect(() =>
    decodeAvatarPose({ ...packet, rigVersion: "unknown" }),
  ).toThrow();
  expect(() =>
    decodeAvatarPose({ ...packet, floats: new ArrayBuffer(388) }),
  ).toThrow();
  expect(() => decodeAvatarPose({ ...packet, bodyScale: 4 })).toThrow();
  new DataView(packet.floats).setFloat32(0, NaN, true);
  expect(() => decodeAvatarPose(packet)).toThrow();
  const bad = identityPose();
  bad.boneRotations.fill(0);
  expect(() => encodeAvatarPose(bad)).toThrow();
});
test("interpolates shortest quaternions and resets immediately on teleport/generation", () => {
  const a = identityPose(),
    b = identityPose();
  b.root.position[0] = 10;
  b.sequence = 1;
  b.boneRotations.set([0, 0, 0, -1], 0);
  expect(interpolateAvatarPose(a, b, 0.5).root.position[0]).toBe(5);
  expect(Math.abs(interpolateAvatarPose(a, b, 0.5).boneRotations[3])).toBe(1);
  const buffer = new AvatarPoseBuffer();
  buffer.record("u", a, "old", 1000, 5000);
  buffer.record("u", b, "old", 1100, 5100);
  expect(buffer.poseAt("u", 5150)?.root.position[0]).toBe(5);
  b.teleport = true;
  b.sequence = 2;
  buffer.record("u", b, "old", 1200, 5200);
  expect(buffer.poseAt("u", 5200)?.root.position[0]).toBe(10);
  expect(buffer.record("u", a, "old", 1201, 5201)).toBe(false);
  expect(buffer.record("u", a, "new", 1300, 5300)).toBe(true);
  expect(buffer.record("u", b, "old", 1400, 5400)).toBe(false);
});
test("an old stationary join snapshot does not add its age to the interpolation delay", () => {
  const buffer = new AvatarPoseBuffer(),
    old = identityPose(),
    live = identityPose();
  live.sequence = 1;
  live.root.position[0] = 10;
  buffer.synchronizeClock(2000, 5000);
  buffer.record("u", old, "generation", 1000, 5000);
  buffer.record("u", live, "generation", 2100, 5100);
  expect(buffer.poseAt("u", 5200)?.root.position[0]).toBe(10);
});
