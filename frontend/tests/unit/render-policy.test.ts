import { expect, it } from "vitest";
import * as MathThree from "../../src/wall-engine/reference/vendor/three.module.js";
import { createViewVisibility, createQualityController, qualitySettings, selectResidents, imageSizeLimit } from "../../src/scene/render-policy";
const THREE: any = MathThree;

it("uses either stereo eye and conservatively keeps unknown bounds", () => {
  const left = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const right = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  left.position.x = -5; right.position.x = 5;
  const scene = { camera: new THREE.ArrayCamera([left, right]) };
  const view = createViewVisibility(THREE, scene);
  view.update();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(5, 0, -4); mesh.updateMatrixWorld();
  expect(view.intersects(mesh)).toBe(true);
  mesh.position.set(0, 0, 10); mesh.updateMatrixWorld();
  expect(view.intersects(mesh)).toBe(false);
  expect(view.intersects(new THREE.Group())).toBe(true);
});

it("keeps transformed large objects crossing the frustum edge", () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const view = createViewVisibility(THREE, { camera }); view.update();
  const root = new THREE.Group(); root.scale.set(10, 2, 1);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(0.7, 0, -5); root.add(mesh); root.updateMatrixWorld(true);
  expect(view.intersects(mesh)).toBe(true);
});

it("preserves XR eye world matrices composed with a teleported camera rig", () => {
  const eye = new THREE.PerspectiveCamera(60, 1, .1, 100);
  eye.matrixWorld.makeTranslation(10, 0, 0);
  eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
  const xr = { isPresenting: true, updateCamera() {}, getCamera: () => new THREE.ArrayCamera([eye]) };
  const view = createViewVisibility(THREE, { camera: new THREE.PerspectiveCamera(), renderer: { xr } });
  view.update();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(10, 0, -5); mesh.updateMatrixWorld();
  expect(view.intersects(mesh)).toBe(true);
  expect(eye.matrixWorld.elements[12]).toBe(10);
});

it("keeps visible and pinned artworks, bounds nearby prefetch and expires hidden grace", () => {
  const entries = [
    { id: "visible", visible: true, near: false, distance: 20, lastVisible: 0, resident: false },
    { id: "pin", visible: false, near: false, distance: 80, lastVisible: 0, resident: false, pinned: true },
    { id: "grace", visible: false, near: false, distance: 80, lastVisible: 3000, resident: true },
    { id: "near", visible: false, near: true, distance: 2, lastVisible: 0, resident: false },
    { id: "farther", visible: false, near: true, distance: 5, lastVisible: 0, resident: false },
  ];
  expect([...selectResidents(entries, 5000, 1)]).toEqual(["visible", "pin", "grace", "near"]);
  expect(selectResidents(entries, 8000, 0).has("grace")).toBe(false);
});

it("reduces quality after sustained overload and recovers slowly without changing on one stall", () => {
  const policy = createQualityController();
  let now = 0;
  const feed = (ms: number, seconds: number) => {
    const end = now + seconds * 1000;
    while (now < end) { now += ms; policy.sample(now, ms, 1000 / 60, true); }
  };
  policy.sample(now += 300, 300, 1000 / 60, true);
  expect(policy.level).toBe(0);
  feed(25, 4); expect(policy.level).toBe(1);
  feed(16, 4); expect(policy.level).toBe(1);
  feed(16, 12); expect(policy.level).toBe(0);
  expect(qualitySettings({ mobile: false, xr: false, dpr: 2 }, 2).pixelRatio).toBeLessThan(qualitySettings({ mobile: false, xr: false, dpr: 2 }, 0).pixelRatio);
});

it("ignores hidden samples and long suspension gaps and keeps device budgets bounded", () => {
  const policy = createQualityController();
  for (let t = 0; t < 20000; t += 1000) policy.sample(t, 1000, 1000 / 90, false);
  policy.sample(30000, 10000, 1000 / 90, true);
  expect(policy.level).toBe(0);
  const xr = qualitySettings({ mobile: false, xr: true, dpr: 3 }, 0);
  expect(xr.pixelRatio).toBeLessThanOrEqual(1);
  expect(xr.splatBudget).toBeLessThanOrEqual(500000);
  expect(qualitySettings({ mobile: true, xr: false, dpr: 3 }, 0).pixelRatio).toBeLessThanOrEqual(1);
});

it("clamps retained image LOD when entering a lower-memory device mode", () => {
  expect(imageSizeLimit(900, 1024, 2048, false)).toBe(1024);
  expect(imageSizeLimit(20, 2048, undefined, false)).toBe(128);
  expect(imageSizeLimit(20, 2048, 256, false)).toBe(256);
  expect(imageSizeLimit(20, 1024, 256, true)).toBe(1024);
});
