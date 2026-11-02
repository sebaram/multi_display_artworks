import { expect, it } from "vitest";
import { lamEyeWeights } from "../../src/avatar/lam-gaze";

it("maps the filtered head-local gaze to paired ARKit eye directions", () => {
  const weights = lamEyeWeights(Math.PI / 12, Math.PI / 36, 30, 10);
  expect(weights.eyeLookInLeft).toBeCloseTo(0.5);
  expect(weights.eyeLookOutRight).toBeCloseTo(0.5);
  expect(weights.eyeLookOutLeft).toBe(0);
  expect(weights.eyeLookInRight).toBe(0);
  expect(weights.eyeLookUpLeft).toBeCloseTo(0.5);
  expect(weights.eyeLookUpRight).toBeCloseTo(0.5);
  expect(weights.eyeLookDownLeft).toBe(0);
});

it("clamps weights and returns neutral for non-finite input or invalid calibration", () => {
  const weights = lamEyeWeights(-Math.PI, -Math.PI);
  expect(weights.eyeLookOutLeft).toBe(1);
  expect(weights.eyeLookInRight).toBe(1);
  expect(weights.eyeLookDownLeft).toBe(1);
  expect(
    Object.values(lamEyeWeights(NaN, Infinity)).every((value) => value === 0),
  ).toBe(true);
  expect(
    Object.values(lamEyeWeights(1, 1, 0, NaN)).every((value) => value === 0),
  ).toBe(true);
});
