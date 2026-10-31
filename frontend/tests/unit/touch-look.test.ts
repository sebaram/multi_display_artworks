import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "../../src/wall-engine/reference/vendor/three.module.js";
import { mountRoom } from "../../src/scene/mountRoom";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup() {
  vi.stubGlobal("AFRAME", { components: { "boundary-clamp": {} }, THREE });
  const host = document.createElement("div"); document.body.append(host);
  const instance = mountRoom({ container: host, bootstrap: { roomId: "", walls: [] } as any });
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 400 });
  instance.scene.append(canvas);
  (instance.scene as any).canvas = canvas;
  const look = { data: { enabled: true, reverseTouchDrag: false }, yawObject: { rotation: { y: 0 } } };
  (host.querySelector("#camera") as any).components = { "look-controls": look };
  return { ...instance, canvas, look };
}
function point(target: EventTarget, type: string, pointerId: number, x: number, pointerType = "touch") {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: pointerType }, clientX: { value: x },
  });
  target.dispatchEvent(event);
}
it("keeps the scene finger independent of the movement finger and stops on cancellation", () => {
  const { canvas, look, dispose } = setup();
  point(document.body, "pointerdown", 1, 80);
  point(canvas, "pointerdown", 2, 300);
  point(window, "pointermove", 1, 40);
  expect(look.yawObject.rotation.y).toBe(0);
  point(window, "pointermove", 2, 260);
  expect(look.yawObject.rotation.y).toBeCloseTo(-Math.PI / 10);
  point(window, "pointerup", 1, 40);
  point(window, "pointermove", 2, 220);
  expect(look.yawObject.rotation.y).toBeCloseTo(-Math.PI / 5);
  point(window, "pointercancel", 2, 220);
  point(window, "pointermove", 2, 180);
  expect(look.yawObject.rotation.y).toBeCloseTo(-Math.PI / 5);
  dispose();
});
it("leaves mouse input to A-Frame and ignores disabled, XR, and disposed touch input", () => {
  const { canvas, look, scene, dispose } = setup();
  point(canvas, "pointerdown", 2, 300, "mouse");
  point(window, "pointermove", 2, 260, "mouse");
  look.data.enabled = false;
  point(canvas, "pointerdown", 3, 300);
  point(window, "pointermove", 3, 260);
  look.data.enabled = true;
  (scene as any).is = () => true;
  point(canvas, "pointerdown", 4, 300);
  point(window, "pointermove", 4, 260);
  expect(look.yawObject.rotation.y).toBe(0);
  dispose();
  point(canvas, "pointerdown", 5, 300);
  point(window, "pointermove", 5, 260);
  expect(look.yawObject.rotation.y).toBe(0);
});
