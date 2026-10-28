import { it, expect, vi } from "vitest";
import { createCompositor } from "../../src/wall-engine/compositor.js";
import { normalizeWallLook } from "../../src/wall-engine/config.js";
it("defaults uploaded videos to muted and retains an explicit local choice for new layers", () => {
  const context = new Proxy({}, { get: () => vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as any,
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
  );
  const canvas = document.createElement("canvas");
  const compositor = createCompositor({
    canvas,
    assetResolver: () => "/fixture.mp4",
  });
  const look = normalizeWallLook();
  const state = normalizeWallLook({
    ...look.state,
    showVideo: true,
    videoLayers: [{ id: "first", assetId: "asset" }],
  }).state;
  compositor.setState(state, look.logical_screen, []);
  expect(compositor.getMedia()[0].muted).toBe(true);
  compositor.setMuted(false);
  expect(compositor.getMedia()[0].muted).toBe(false);
  compositor.setState(
    normalizeWallLook({
      ...state,
      videoLayers: [...state.videoLayers, { id: "second", assetId: "asset2" }],
    }).state,
    look.logical_screen,
    [],
  );
  expect(compositor.getMedia().map((m: any) => m.muted)).toEqual([
    false,
    false,
  ]);
  compositor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
