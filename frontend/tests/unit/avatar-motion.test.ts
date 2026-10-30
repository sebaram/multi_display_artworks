import { expect, test } from "vitest";
import catalog from "../../public/avatars/catalog.fixture.json";
import { updateAvatarMotion } from "../../src/avatar/motion";
import { solveTwoBone } from "../../src/avatar/two-bone-ik";
import { jointWorldTransforms } from "../../src/avatar/pose";
import type { AvatarInputV2, AvatarPreset } from "../../src/avatar/types";
const preset = catalog.presets[0] as unknown as AvatarPreset;
const owner = () => ({ preset, applyPose() {} }) as any;
const input = (): AvatarInputV2 => ({
  version: 2,
  sampleTime: 1,
  root: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
  head: { position: [0, 1.65, 0], orientation: [0, 0, 0, 1] },
  left: null,
  right: null,
  tracking: { head: true, left: false, right: false },
  locomotion: { velocity: [0, 0, 0], grounded: true, teleport: false },
});
test("independent head pitch/yaw does not tip the body; undefined floor remains finite idle", () => {
  const i = input();
  i.head!.orientation = [0.5, 0, 0, Math.sqrt(0.75)];
  const p = updateAvatarMotion(owner(), i, 0.016, null, "full");
  expect(p.root.orientation).toEqual([0, 0, 0, 1]);
  expect(p.boneRotations[20]).not.toBe(0);
  expect([...p.boneRotations].every(Number.isFinite)).toBe(true);
  expect(p.hipsOffset).toEqual([0, 0, 0]);
});
test("walking and backward gait cycle; stance foot stays planted; teleport clears locks", () => {
  const o = owner(),
    i = input();
  i.locomotion.velocity = [0, 0, -0.8];
  let a: any, b: any;
  for (let n = 0; n < 12; n++) {
    i.root.position[2] -= 0.008;
    const p = updateAvatarMotion(o, i, 0.01, { height: 0 }, "full");
    if (n === 8) a = jointWorldTransforms(p, preset);
    if (n === 9) b = jointWorldTransforms(p, preset);
  }
  expect(
    Math.hypot(
      ...a.leftFoot.position.map(
        (x: number, n: number) => x - b.leftFoot.position[n],
      ),
    ),
  ).toBeLessThan(0.002);
  const phases = [];
  for (let n = 0; n < 150; n++) {
    i.root.position[2] -= 0.008;
    phases.push(
      updateAvatarMotion(o, i, 0.01, { height: 0 }, "full").boneRotations[56],
    );
  }
  expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.1);
  i.root.position = [20, 0, 20];
  i.locomotion.teleport = true;
  const tele = updateAvatarMotion(o, i, 0.016, { height: 0 }, "full");
  expect(tele.teleport).toBe(true);
  expect(
    jointWorldTransforms(tele, preset).leftFoot.position[0],
  ).toBeGreaterThan(19);
  i.locomotion.teleport = false;
  i.locomotion.velocity = [0, 0, 0.8];
  expect(
    [
      ...updateAvatarMotion(o, i, 0.1, { height: 0 }, "full").boneRotations,
    ].every(Number.isFinite),
  ).toBe(true);
});
test("analytical two bone solver clamps unreachable targets, bend limits and degenerate poles", () => {
  const chain = {
    root: [0, 0, 0] as [number, number, number],
    upperLength: 0.4,
    lowerLength: 0.4,
  };
  for (const target of [
    [0, 0, -10],
    [0, 0, 0],
    [NaN, 0, 0],
  ]) {
    const result = solveTwoBone(chain, target as any, [0, 0, 0], {
      minBend: 0.1,
      maxBend: 2.8,
    });
    expect(
      [...result.joint, ...result.end, ...result.upper, ...result.lower].every(
        Number.isFinite,
      ),
    ).toBe(true);
    expect(Math.hypot(...result.end)).toBeLessThanOrEqual(0.8);
    expect(Math.hypot(...result.joint)).toBeCloseTo(0.4);
    expect(result.bend).toBeGreaterThanOrEqual(0.1 - 1e-6);
    expect(result.bend).toBeLessThanOrEqual(2.8 + 1e-6);
  }
});

test("tracked arms solve only for owner, invalid targets remain finite and tracked loss relaxes", () => {
  const o = owner(),
    i = input();
  i.left = { position: [-10, 1, 0], orientation: [0, 0, 0, 1] };
  i.tracking.left = true;
  const tracked = updateAvatarMotion(o, i, 0.016, { height: 0 }, "hidden");
  const points = jointWorldTransforms(tracked, preset);
  expect(
    Math.hypot(
      ...points.leftHand.position.map(
        (x, n) => x - points.leftUpperArm.position[n],
      ),
    ),
  ).toBeLessThanOrEqual(0.531);
  i.left = null;
  i.tracking.left = false;
  const lost = updateAvatarMotion(o, i, 0.016, { height: 0 }, "hidden");
  expect(lost.boneRotations[28]).not.toBe(tracked.boneRotations[28]);
  i.head!.position[0] = NaN;
  i.root.position[1] = NaN;
  expect(
    [...updateAvatarMotion(o, i, 0.016, null, "hidden").root.position].every(
      Number.isFinite,
    ),
  ).toBe(true);
});

test("losing a bent tracked arm relaxes elbow and wrist progressively", () => {
  const o = owner(),
    i = input();
  i.tracking.left = true;
  i.left = {
    position: [-0.24, 1.2, 0.01],
    orientation: [0.5, 0, 0, Math.sqrt(0.75)],
  };
  const tracked = updateAvatarMotion(o, i, 0.016, { height: 0 }, "full");
  i.tracking.left = false;
  i.left = null;
  const lost = updateAvatarMotion(o, i, 0.016, { height: 0 }, "full");
  for (const offset of [32, 36])
    expect(
      Math.hypot(
        ...Array.from(
          lost.boneRotations.slice(offset, offset + 4),
          (x, n) => x - tracked.boneRotations[offset + n],
        ),
      ),
    ).toBeLessThan(0.3);
});
