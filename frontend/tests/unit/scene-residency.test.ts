import { afterEach, expect, it, vi } from "vitest";
import * as MathThree from "../../src/wall-engine/reference/vendor/three.module.js";
const THREE: any = MathThree;
const controllers = vi.hoisted(() => new Map<string, any>());
vi.mock("../../src/scene/artwork-resources", () => ({
  createResourceRegistry: () => ({ dispose: vi.fn() }),
  createArtworkSource: ({ root, data }: any) => {
    const controller = { resident: false, bounds: undefined as any, setResident: vi.fn((value: boolean) => { controller.resident = value; }), setData: vi.fn(), setQuality: vi.fn(), dispose: vi.fn() };
    controllers.set(data.id, controller); root.dataset.managed = "true"; return controller;
  },
}));
import { mountRoom } from "../../src/scene/mountRoom";
afterEach(() => { controllers.clear(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("keeps artwork identity while evicting hidden resources, pins selection, and reloads on teleport", () => {
  const components: Record<string, any> = { "boundary-clamp": {} };
  vi.stubGlobal("AFRAME", { THREE, components, registerComponent: (name: string, value: any) => { components[name] = value; } });
  const room = mountRoom({ container: document.body, bootstrap: { walls: [{ id: "w", position: "0 0 0", rotation: "0 0 0", width: 10, height: 4, depth: .2, elements: [ { id: "a", wall: "w", wall_element_type: "image", image_url: "/a.png" } ] }] } as any });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  (room.scene as any).camera = camera;
  const tick = (time: number) => components["gallery-render-work"].tick.call({ el: room.scene }, time, 16);
  const source = controllers.get("a");
  expect(source).toBeDefined();
  const root = document.querySelector('[data-element-id="a"]');
  source.bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -21), new THREE.Vector3(1, 1, -19));
  tick(0); expect(source.resident).toBe(true);
  camera.rotation.y = Math.PI; camera.updateMatrixWorld();
  tick(1000); expect(source.resident).toBe(true);
  tick(5000); expect(source.resident).toBe(false);
  room.select("a"); tick(5300); expect(source.resident).toBe(true);
  room.select(null); tick(10000); expect(source.resident).toBe(false);
  room.teleport({ position: "0 0 0", rotation: "0 0 0" });
  camera.rotation.y = 0; camera.updateMatrixWorld();
  tick(10016); expect(source.resident).toBe(true);
  expect(document.querySelector('[data-element-id="a"]')).toBe(root);
  room.dispose(); expect(source.dispose).toHaveBeenCalledOnce();
});
