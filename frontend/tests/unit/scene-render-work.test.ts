import { afterEach, expect, it, vi } from "vitest";
const renderer = vi.hoisted(() => ({ resize: vi.fn(), render: vi.fn(() => true), syncPlayback: vi.fn(), setMuted: vi.fn(), setInteraction: vi.fn(), setConfig: vi.fn(), dispose: vi.fn(), getYouTubeLayers: () => [] }));
vi.mock("../../src/wall-engine", () => ({ createWallRenderer: () => renderer }));
import { mountRoom } from "../../src/scene/mountRoom";
import * as MathThree from "../../src/wall-engine/reference/vendor/three.module.js";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("ticks from the A-Frame XR loop and stops after dispose without scheduling another window RAF", async () => {
  const components: Record<string, any> = { "boundary-clamp": {} };
  vi.stubGlobal("AFRAME", { components, registerComponent: (name: string, value: any) => { components[name] = value; }, THREE: { Raycaster: class {} } });
  const raf = vi.fn(); vi.stubGlobal("requestAnimationFrame", raf);
  let receive: any;
  const room = mountRoom({ container: document.body, bootstrap: { roomId: "r", walls: [{ id: "w", width: 6, height: 4, depth: .2, position: "0 0 -5", rotation: "0 0 0", elements: [], design: { revision: 1, config: { state: { paused: true, offset: 2 } } } }] } as any, services: { startRealtime: (_s, _b, events) => { receive = events; return { client: { request: vi.fn() }, dispose: vi.fn() }; } } });
  room.scene.dispatchEvent(new Event("loaded")); await Promise.resolve();
  components["gallery-render-work"].tick.call({ el: room.scene }, 1000, 16);
  expect(renderer.render).toHaveBeenCalled();
  expect(renderer.syncPlayback).toHaveBeenCalled();
  expect(raf).not.toHaveBeenCalled();
  receive("wall.playback_state", { wall_id: "w", binding_revision: 1, revision: 2, playing: false, position_seconds: 12, rate: 1, state_time_ms: Date.now() });
  components["gallery-render-work"].tick.call({ el: room.scene }, 1016, 16);
  expect(renderer.syncPlayback).toHaveBeenLastCalledWith({ positionSeconds: 12, playing: false, rate: 1 });
  const calls = renderer.render.mock.calls.length;
  room.dispose();
  components["gallery-render-work"].tick.call({ el: room.scene }, 1032, 16);
  expect(renderer.render).toHaveBeenCalledTimes(calls);
});

it("skips hidden wall drawing while keeping incoming paused playback and pointer current", async () => {
  const THREE: any = MathThree;
  const components: Record<string, any> = { "boundary-clamp": {} };
  vi.stubGlobal("AFRAME", { THREE, components, registerComponent: (name: string, value: any) => { components[name] = value; } });
  let receive: any;
  const room = mountRoom({ container: document.body, bootstrap: { walls: [{ id: "w", width: 6, height: 4, depth: .2, position: "0 0 -20", rotation: "0 0 0", elements: [], design: { revision: 1, config: { state: { paused: true, offset: 2 } } } }] } as any, services: { startRealtime: (_s, _b, events) => { receive = events; return { client: { request: vi.fn() }, dispose: vi.fn() }; } } });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  (room.scene as any).camera = camera;
  const surface: any = document.querySelector(".wall-surface");
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 4)); mesh.position.z = -20;
  surface.getObject3D = () => mesh;
  const tick = (time: number) => components["gallery-render-work"].tick.call({ el: room.scene }, time, 16);
  room.scene.dispatchEvent(new Event("loaded")); await Promise.resolve();
  tick(0); expect(renderer.render).toHaveBeenCalledTimes(1);
  camera.rotation.y = Math.PI; camera.updateMatrixWorld();
  receive("wall.interaction_state", { wall_id: "w", binding_revision: 1, sequence: 1, runtime_id: "r", pointer: { x: .2, y: -.1 } });
  receive("wall.playback_state", { wall_id: "w", binding_revision: 1, revision: 2, playing: false, position_seconds: 23, rate: 1 });
  tick(16);
  expect(renderer.render).toHaveBeenCalledTimes(1);
  expect(renderer.setInteraction).toHaveBeenLastCalledWith({ x: .2, y: -.1 });
  expect(renderer.syncPlayback).toHaveBeenLastCalledWith({ positionSeconds: 23, playing: false, rate: 1 });
  camera.rotation.y = 0; camera.updateMatrixWorld(); tick(32);
  expect(renderer.render).toHaveBeenLastCalledWith(2, { positionSeconds: 23, playing: false, rate: 1 });
  room.dispose();
});

it("sizes a late-applied wall with the current mobile resolution", async () => {
  const components: Record<string, any> = { "boundary-clamp": {} };
  vi.stubGlobal("AFRAME", { components, registerComponent: (name: string, value: any) => { components[name] = value; }, THREE: { Raycaster: class {} } });
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("matchMedia", () => ({ matches: true }));
  let receive: any;
  const room = mountRoom({ container: document.body, bootstrap: { walls: [{ id: "w", width: 6, height: 4, depth: .2, position: "0 0 -5", rotation: "0 0 0", elements: [] }] } as any, services: { startRealtime: (_s, _b, events) => { receive = events; return { client: { request: vi.fn() }, dispose: vi.fn() }; } } });
  room.scene.dispatchEvent(new Event("loaded")); await Promise.resolve();
  receive("wall.design_applied", { wall_id: "w", revision: 1, config: { state: { paused: true } } });
  expect((document.querySelector("#design-w") as HTMLCanvasElement).width).toBe(768);
  room.dispose();
});
