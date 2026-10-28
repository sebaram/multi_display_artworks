import { it, expect } from "vitest";
import { animationTime, mediaTime } from "../../src/scene/clocks";
it("evaluates source speed, offset and pause from a shared epoch", () => {
  expect(
    animationTime(
      { state: { speed: 2, offset: 7, paused: false } },
      1000,
      4000,
    ),
  ).toBe(13);
  expect(
    animationTime({ state: { speed: 2, offset: 7, paused: true } }, 1000, 4000),
  ).toBe(7);
});
it("evaluates canonical playback from state_time_ms", () => {
  expect(
    mediaTime(
      { position_seconds: 3, playing: true, rate: 2, state_time_ms: 1000 },
      4000,
    ),
  ).toEqual({ positionSeconds: 9, playing: true, rate: 2 });
});
