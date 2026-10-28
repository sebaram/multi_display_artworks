import { it, expect, vi, afterEach } from "vitest";
const renderer = vi.hoisted(() => ({
  resize: vi.fn(),
  render: vi.fn(),
  setConfig: vi.fn(),
  setInteraction: vi.fn(),
  setMuted: vi.fn(),
  dispose: vi.fn(),
  getYouTubeLayers: () => [],
}));
vi.mock("../../src/wall-engine", () => ({
  createWallRenderer: () => renderer,
}));
import { mountRoom } from "../../src/scene/mountRoom";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.replaceChildren();
});
it("consumes live snapshot/apply/remove and rejects stale shared wall state without replacing artworks", async () => {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const host = document.createElement("div");
  document.body.append(host);
  let receive: (event: string, payload: any) => void = () => {};
  const wall = {
    id: "wall",
    position: "0 0 0",
    rotation: "0 37 0",
    width: 6,
    height: 4,
    depth: 0.2,
    room: "room",
    image_url: "/original.png",
    elements: [
      { id: "artwork", wall_element_type: "image", image_url: "/artwork.png" },
    ],
  };
  const room = mountRoom({
    container: host,
    bootstrap: { roomId: "room", walls: [wall] } as any,
    services: {
      startRealtime(_scene, _data, events) {
        receive = events;
        return {
          client: { emit: vi.fn(), request: vi.fn() },
          dispose: vi.fn(),
        };
      },
    },
  });
  room.scene.dispatchEvent(new Event("loaded"));
  await Promise.resolve();
  const config = { state: { offset: 2, speed: 0.5, paused: false } };
  const playback = {
    wall_id: "wall",
    binding_revision: 2,
    revision: 1,
    playing: true,
    position_seconds: 5,
    rate: 2,
    state_time_ms: 0,
  };
  const design = {
    wall_id: "wall",
    revision: 2,
    config,
    animation_epoch_ms: 0,
    playback,
  };
  receive("wall.snapshot", {
    server_time_ms: 1000,
    walls: [
      {
        design,
        interaction: {
          wall_id: "wall",
          binding_revision: 2,
          runtime_id: "runtime",
          sequence: 1,
          pointer: { x: 0.1, y: 0.2 },
        },
      },
    ],
  });
  expect(host.querySelectorAll(".wall-surface")).toHaveLength(1);
  expect(host.querySelector("[data-element-id=artwork]")).not.toBeNull();
  callbacks.shift()!(0);
  expect(renderer.render).toHaveBeenLastCalledWith(2.5, {
    positionSeconds: 7,
    playing: true,
    rate: 2,
  });
  receive("wall.design_applied", { ...design, revision: 3 });
  expect(renderer.setConfig).toHaveBeenLastCalledWith(config);
  receive("wall.interaction_state", {
    wall_id: "wall",
    binding_revision: 2,
    runtime_id: "runtime",
    sequence: 999,
    pointer: { x: 0.5, y: 0.5 },
  });
  expect(renderer.setInteraction).toHaveBeenCalledTimes(1);
  receive("wall.design_removed", { wall_id: "wall", revision: 3 });
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll(".wall-surface")).toHaveLength(0);
  expect(host.querySelectorAll("a-image")).toHaveLength(2);
  room.dispose();
});
