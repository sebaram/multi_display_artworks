import { it, expect, vi } from "vitest";
import { mountRoom } from "../../src/scene/mountRoom";
it("removes the owned scene and callback on repeated dispose", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const dispose = vi.fn();
  const instance = mountRoom({
    container,
    bootstrap: {
      roomId: "test",
      walls: [],
      spawn_preset: null,
      boundary: {
        min_x: -2,
        max_x: 2,
        min_y: 0,
        max_y: 4,
        min_z: -2,
        max_z: 2,
      },
    } as any,
    services: { startRealtime: () => ({ dispose }), onSelect: vi.fn() },
  });
  instance.dispose();
  instance.dispose();
  expect(container.children).toHaveLength(0);
  container.remove();
});
it("teleports the look-control yaw and pitch as well as the camera position", () => {
  const container = document.createElement("div");
  const instance = mountRoom({ container, bootstrap: { walls: [] } as any });
  const camera = container.querySelector("a-camera") as any;
  const look = {
    yawObject: { rotation: { y: 0 } },
    pitchObject: { rotation: { x: 0 } },
  };
  camera.components = { "look-controls": look };
  instance.teleport({ position: "1 1.7 2", rotation: "-10 37 0" });
  expect(look.yawObject.rotation.y).toBeCloseTo((37 * Math.PI) / 180);
  expect(look.pitchObject.rotation.x).toBeCloseTo((-10 * Math.PI) / 180);
  instance.dispose();
});
it("moves preview artwork to the destination wall and restores its original parent on cancel", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const original = {
    id: "artwork",
    wall: "a",
    wall_element_type: "image",
    position_x: 0.5,
    position_y: 0.25,
  };
  const wall = (id: string, rotation: string, elements: any[]) => ({
    id,
    position: "0 0 0",
    rotation,
    width: 6,
    height: 4,
    depth: 0.2,
    elements,
  });
  const instance = mountRoom({
    container,
    bootstrap: {
      walls: [wall("a", "0 0 0", [original]), wall("b", "0 37 0", [])],
    } as any,
  });
  const artwork = container.querySelector("[data-element-id=artwork]")!;
  instance.update([
    { ...original, wall: "b", position_x: 1.2, position_y: 0.7 },
  ] as any);
  expect(artwork.parentElement?.getAttribute("data-wall-id")).toBe("b");
  expect(artwork.getAttribute("position")).toContain("1.2 0.7");
  instance.update([original] as any);
  expect(artwork.parentElement?.getAttribute("data-wall-id")).toBe("a");
  expect(artwork.getAttribute("position")).toContain("0.5 0.25");
  instance.dispose();
  container.remove();
});
