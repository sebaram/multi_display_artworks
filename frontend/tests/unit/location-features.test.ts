import { expect, test, vi } from "vitest";
import { registerLocationComponents } from "../../src/scene/location-features.js";
import * as THREE from "../../src/wall-engine/reference/vendor/three.module.js";
const bounds = { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -2, maxZ: 2 };
function component() {
  let definition: any;
  registerLocationComponents({
    THREE,
    components: {},
    registerComponent: (_name: string, value: any) => (definition = value),
  });
  return definition;
}
test("XR boundary constrains world head by translating its virtual origin, preserving raw pose and yaw", () => {
  const origin: any = new THREE.Group();
  origin.position.set(5, 0, -3);
  origin.rotation.y = Math.PI / 2;
  const camera: any = new THREE.Group();
  camera.position.set(1, 1.6, -1);
  origin.add(camera);
  origin.updateMatrixWorld(true);
  const raw = camera.position.clone(),
    yaw = origin.quaternion.clone();
  const el = {
    object3D: camera,
    parentElement: { id: "avatar-xr-origin", object3D: origin },
    sceneEl: {
      renderer: {
        xr: {
          getSession: () => ({}),
          getReferenceSpace: () => ({}),
          getFrame: () => ({
            getViewerPose: () => ({ transform: { position: raw } }),
          }),
        },
      },
    },
    getAttribute: () => camera.position,
    setAttribute: vi.fn(),
    emit: vi.fn(),
  };
  const clamp = component();
  clamp.tick.call({ el, data: bounds });
  expect(camera.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([
    4, 1.6, -4,
  ]);
  clamp.clampXRBoundary.call({ el, data: bounds });
  origin.updateMatrixWorld(true);
  const world = camera.getWorldPosition(new THREE.Vector3());
  expect(world.toArray()).toEqual([2, 1.6, -2]);
  expect(camera.position.toArray()).toEqual(raw.toArray());
  expect(origin.quaternion.toArray()).toEqual(yaw.toArray());
  expect(el.setAttribute).not.toHaveBeenCalled();
  clamp.clampXRBoundary.call({ el, data: bounds });
  expect(el.emit).toHaveBeenCalledTimes(1);
  expect(el.emit).toHaveBeenCalledWith("avatar-xr-origin-clamped", {}, false);
});
test("desktop boundary keeps its existing local clamp with an identity origin", () => {
  const el = {
    getAttribute: () => ({ x: 5, y: 10, z: -5 }),
    setAttribute: vi.fn(),
  };
  component().tick.call({ el, data: bounds });
  expect(el.setAttribute).toHaveBeenCalledWith("position", {
    x: 2,
    y: 3,
    z: -2,
  });
});
