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
it("reloads only the changed splat source while keeping its artwork, cutout and camera", () => {
  vi.stubGlobal("AFRAME", {
    components: { gaussian_splatting: {}, "boundary-clamp": {} },
    THREE: { Raycaster: class {} },
  });
  const container = document.createElement("div");
  const original = {
    id: "splat",
    wall: "wall",
    wall_element_type: "gaussian_splat",
    splat_url: "http://example.test/old.splat",
    cutout_scale: "0.3 0.3 0.3",
    cutout_position: "0.1 0 0",
    position_x: 0.5,
    position_y: 0.25,
  };
  const onSelect = vi.fn();
  const instance = mountRoom({
    container,
    bootstrap: {
      walls: [
        { id: "wall", width: 6, height: 4, depth: 0.2, elements: [original] },
      ],
    } as any,
    services: { onSelect },
  });
  try {
    const artwork = container.querySelector("[data-element-id=splat]")!;
    const cutout = artwork.querySelector("#cutout-splat")!;
    const camera = container.querySelector("a-camera");
    const remove = vi.spyOn(artwork, "removeAttribute");
    instance.update([
      {
        ...original,
        splat_url: "http://example.test/new.splat",
        position_x: 1.2,
      },
    ] as any);
    expect(artwork.getAttribute("gaussian_splatting")).toBe(
      "src: http://example.test/new.splat; cutoutEntity: #cutout-splat",
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith("gaussian_splatting");
    instance.update([
      {
        ...original,
        splat_url: "http://example.test/new.splat",
        position_x: 1.5,
      },
    ] as any);
    expect(remove).toHaveBeenCalledTimes(1);
    instance.update([original] as any);
    expect(artwork.getAttribute("gaussian_splatting")).toBe(
      "src: http://example.test/old.splat; cutoutEntity: #cutout-splat",
    );
    expect(remove).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-element-id=splat]")).toBe(artwork);
    expect(artwork.querySelector("#cutout-splat")).toBe(cutout);
    expect(cutout.getAttribute("position")).toBe("0.1 0 0");
    expect(container.querySelector("a-camera")).toBe(camera);
    expect(artwork.getAttribute("position")).toContain("0.5 0.25");
    artwork.dispatchEvent(new Event("click"));
    expect(onSelect).toHaveBeenCalledWith("splat");
  } finally {
    instance.dispose();
    vi.unstubAllGlobals();
  }
});
