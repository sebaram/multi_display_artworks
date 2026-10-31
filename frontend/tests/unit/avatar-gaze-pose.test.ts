import { expect, test } from 'vitest';
import { identityPose, avatarPoseChanged, interpolateAvatarPose } from '../../src/avatar/pose';
import { encodeAvatarPose, decodeAvatarPose } from '../../src/avatar/pose-codec';
import { normalizeAppearance } from '../../src/avatar/appearance';
import { DEFAULT_GAZE_CONFIG } from '../../src/avatar/gaze';
import fixture from '../../public/avatars/catalog.fixture.json';
import { gaussianEyePose } from '../../src/avatar/gaussian-eye-pose';
import { axisAngle, rotate } from '../../src/avatar/pose';

test('solved eyes round-trip without changing joint bytes, trigger sends and interpolate to neutral', () => {
  const before = identityPose(), after = identityPose();
  after.gaze = { version: 1, source: 'procedural', yaw: .3, pitch: -.1 };
  const oldPacket = encodeAvatarPose(before), packet = encodeAvatarPose(after);
  expect(new Uint8Array(packet.floats)).toEqual(new Uint8Array(oldPacket.floats));
  expect(decodeAvatarPose(packet).gaze).toEqual(after.gaze);
  expect(decodeAvatarPose(oldPacket).gaze).toBeUndefined();
  expect(avatarPoseChanged(before, after)).toBe(true);
  expect(interpolateAvatarPose(after, before, .5).gaze?.yaw).toBeCloseTo(.15);
  expect(avatarPoseChanged(after, before)).toBe(true);
  expect(avatarPoseChanged(before, { ...before, gaze: { ...after.gaze, yaw: 0, pitch: 0 } })).toBe(true);
});

test('malformed eye data cannot reach renderers', () => {
  const packet = encodeAvatarPose(identityPose());
  for (const gaze of [null, { version: 1, source: 'sensor', yaw: 0, pitch: 0 },
    { version: 1, source: 'procedural', yaw: Infinity, pitch: 0 },
    { version: 1, source: 'procedural', yaw: 2, pitch: 0 },
    { version: 1, source: 'procedural', yaw: 0, pitch: 0, targetId: 'private' }])
    expect(() => decodeAvatarPose({ ...packet, gaze })).toThrow();
});

test('appearance retains bounded optional configuration while legacy appearance stays identical', () => {
  const catalog = fixture as any;
  const appearance = catalog.presets[0].defaultAppearance;
  expect(normalizeAppearance(appearance, catalog)).toEqual(appearance);
  expect(normalizeAppearance({ ...appearance, gaze: { ...DEFAULT_GAZE_CONFIG, coneDegrees: 80 } }, catalog).gaze?.coneDegrees).toBe(80);
  expect(normalizeAppearance({ ...appearance, gaze: undefined }, catalog).gaze).toBeUndefined();
});

test('native FLAME eyes preserve scene +yaw/right and +pitch/up after the PI-Y head transform', () => {
  const eyes = gaussianEyePose(.3, .2), vector = eyes.slice(0,3) as [number,number,number];
  expect(eyes.slice(3)).toEqual(vector);
  const angle = Math.hypot(...vector);
  const directed = rotate(axisAngle(vector, angle), [0,0,1]);
  const sceneDirection = rotate(axisAngle([0,1,0], Math.PI), directed);
  expect(sceneDirection[0]).toBeGreaterThan(0);
  expect(sceneDirection[1]).toBeGreaterThan(0);
  expect(sceneDirection[2]).toBeLessThan(0);
});
