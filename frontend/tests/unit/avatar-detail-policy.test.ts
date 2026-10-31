import { expect, test, vi } from 'vitest';
import { avatarDetail, createAvatarDetailState } from '../../src/avatar/detail-policy';
import { AvatarPoseBuffer, identityPose } from '../../src/avatar/pose';

const input = (distance: number, visible = true) => ({ distance, visible, device: { mobile: false, xr: false }, quality: 0 });
test('display policy starts at 30/15/5 Hz and stops offscreen work', () => {
  expect([3, 15, 40].map(distance => avatarDetail(input(distance)).poseApplyHz)).toEqual([30,15,5]);
  expect(avatarDetail(input(40)).meshLevel).toBe('low');
  expect(avatarDetail(input(3, false))).toEqual({meshLevel:'hidden',poseApplyHz:0,expressionHz:0});
  expect(avatarDetail({...input(9),quality:2}).poseApplyHz).toBeLessThan(30);
});
test('hysteresis prevents threshold chatter and reappearance forces latest joints immediately', () => {
  const state = createAvatarDetailState();
  expect(state.update(input(9),0).applyPose).toBe(true);
  expect(state.update(input(10.1),10).detail.poseApplyHz).toBe(30);
  expect(state.update(input(12.1),20).detail.poseApplyHz).toBe(15);
  expect(state.update(input(9.9),21).detail.poseApplyHz).toBe(15);
  expect(state.update(input(7.9),22).detail.poseApplyHz).toBe(30);
  expect(state.update(input(7,false),23).applyPose).toBe(false);
  expect(state.update(input(7),24).applyPose).toBe(true);
});
test('root-only buffer interpolation skips quaternion array work and preserves latest hidden snapshots', () => {
  const b = new AvatarPoseBuffer(), a = identityPose(), c = identityPose();
  c.sequence=1;c.root.position[0]=10;c.boneRotations.set([0,1,0,0],20);
  b.record('peer',a,'g',0,0);b.record('peer',c,'g',100,100);
  const root = b.poseAt('peer',150,false)!;
  expect(root.root.position[0]).toBe(5);
  expect(root.boneRotations).toBe(c.boneRotations);
  expect(b.poseAt('peer',150)!.boneRotations[21]).toBeCloseTo(Math.SQRT1_2);
  expect(b.poseAt('peer',300)!.sequence).toBe(1);
});
