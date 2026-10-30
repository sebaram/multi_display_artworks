import { expect, test } from 'vitest';
import catalog from '../../public/avatars/catalog.fixture.json';
import { parseSmplMotion, sampleSmplMotion } from '../../src/avatar/smpl';
import { SmplPlayback } from '../../src/avatar/smpl-playback';
import { jointWorldTransforms, sub, rotate, axisAngle, slerp } from '../../src/avatar/pose';
import type { AvatarPreset, Transform } from '../../src/avatar/types';
const preset = catalog.presets[0] as unknown as AvatarPreset;
const anchor: Transform = { position: [3, 0, 5], orientation: [0, 0, 0, 1] };
const source = (model = 'smpl') => ({ model, fps: 2, units: 'm', coordinateSystem: 'y-up', betas: [0, .5], frames: [{ global_orient: [0, 0, 0], body_pose: Array(model === 'smpl' ? 69 : 63).fill(0), transl: [10, 0, 20] }] });
const parse = (v: any) => parseSmplMotion(JSON.stringify(v));
const sample = (v: any) => sampleSmplMotion(parse(v), preset, 0, anchor, 123);
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));
test('bounded immutable source accepts SMPL and SMPL-X layouts and preserves ignored channels', () => {
  for (const model of ['smpl', 'smplx']) {
    const s: any = source(model);
    if (model === 'smplx') s.frames[0].left_hand_pose = Array(45).fill(0);
    const clip = parse(s);
    expect(Object.isFrozen(clip.frames[0].body_pose)).toBe(true);
    expect(clip.warnings.join(' ')).toMatch(/trajector/i);
    if (model === 'smplx') expect(clip.warnings.join(' ')).toMatch(/left_hand_pose/);
    expect([...sample(s).boneRotations].every(Number.isFinite)).toBe(true);
  }
});
test('rejects malformed, excessive, unknown and PCA inputs before sampling', () => {
  for (const change of [
    (s: any) => s.frames[0].body_pose.pop(), (s: any) => s.frames[0].global_orient[0] = true,
    (s: any) => s.frames[0].body_pose[0] = 100, (s: any) => s.fps = 121,
    (s: any) => s.units = 'cm', (s: any) => s.coordinateSystem = 'x-up',
    (s: any) => s.betas = Array(301).fill(0), (s: any) => s.betas = [11],
    (s: any) => s.frames = Array(1801).fill(s.frames[0]), (s: any) => s.url = 'https://example.com',
  ]) { const s = source(); change(s); expect(() => parse(s)).toThrow(); }
  const pca: any = source('smplx'); pca.frames[0].left_hand_pose = Array(6).fill(0);
  expect(() => parse(pca)).toThrow(/45.*PCA/);
  expect(() => parseSmplMotion(' '.repeat(8 * 1024 * 1024 + 1))).toThrow(/8 MiB/);
});
test('neutral SMPL yields a T-pose on the downward-arm rig and ignores trajectory', () => {
  const pose = sample(source()), w = jointWorldTransforms(pose, preset);
  near(pose.root.position, anchor.position);
  near(sub(w.leftHand.position, w.leftUpperArm.position), [-.53, 0, 0]);
  near(sub(w.rightHand.position, w.rightUpperArm.position), [.53, 0, 0]);
});
test('bent elbow under rotated shoulder and root uses global correction exactly once', () => {
  const s = source(); s.frames[0].global_orient = [0, Math.PI / 2, 0];
  s.frames[0].body_pose[15 * 3] = Math.PI / 2; // source joint 16, left shoulder
  s.frames[0].body_pose[17 * 3 + 2] = Math.PI / 2; // source joint 18, left elbow
  const w = jointWorldTransforms(sample(s), preset);
  // Canonical left forearm +X is bent to +Y, shoulder rotates to +Z,
  // root rotates to +X, then source-to-target Y half-turn maps it to -X.
  near(sub(w.leftHand.position, w.leftLowerArm.position), [-.25, 0, 0]);
});
test('z-up basis rotates an equivalent axis-angle correctly; shortest quaternion arc stays finite', () => {
  const y = source(), z = source(); y.frames[0].global_orient = [0, .4, 0];
  z.coordinateSystem = 'z-up'; z.frames[0].global_orient = [0, 0, .4];
  near([...sample(y).boneRotations], [...sample(z).boneRotations]);
  const q = axisAngle([0, 1, 0], .8);
  near(rotate(slerp(q, q.map(v => -v) as any, .5), [1, 0, 0]), rotate(q, [1, 0, 0]));
  const opposite = source(); opposite.frames.push({ ...opposite.frames[0], global_orient: [0, 2 * Math.PI, 0] });
  near([...sampleSmplMotion(parse(opposite), preset, .25, anchor, 456).boneRotations], [...sample(source()).boneRotations]);
});
test('playback is isolated, pause holds time, stop/XR/owner/disposal clear motion', () => {
  const s = source(); s.frames.push({ ...s.frames[0], global_orient: [0, 1, 0] });
  const clip = parse(s), p = new SmplPlayback(), other = new SmplPlayback();
  p.resetOwner('a'); p.apply(clip, 1000); expect(other.state).toBe('stopped');
  p.pause(1250); const paused = p.sample(preset, anchor, 1500)!;
  near([...p.sample(preset, anchor, 2000)!.boneRotations], [...paused.boneRotations]);
  p.play(2000); expect(p.state).toBe('playing');
  for (const stop of [() => p.stop(), () => p.enterXR(), () => p.resetOwner('b'), () => p.dispose()]) {
    p.apply(clip, 0); stop(); expect(p.sample(preset, anchor, 1)).toBeNull();
  }
});
