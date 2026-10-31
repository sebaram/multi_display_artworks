import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from '../../src/wall-engine/reference/vendor/three.module.js';
vi.mock('../../src/wall-engine', () => ({ createWallRenderer: () => ({
  resize() {}, render() {}, setConfig() {}, setInteraction() {}, setMuted() {}, dispose() {}, getYouTubeLayers: () => [],
}) }));
import { mountRoom } from '../../src/scene/mountRoom';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function pointAtWalls(entries: Array<{id: string; z: number; design?: boolean; visible?: boolean}>) {
  vi.stubGlobal('AFRAME', { components: { 'boundary-clamp': {} }, THREE: {
    Raycaster: THREE.Raycaster, Vector2: THREE.Vector2, Vector3: THREE.Vector3,
    Quaternion: THREE.Quaternion, Plane: THREE.Plane,
  } });
  const emit = vi.fn(), host = document.createElement('div'); document.body.append(host);
  const instance = mountRoom({ container: host, bootstrap: { roomId: 'room', walls: entries.map(entry => ({
    id: entry.id, position: `0 0 ${entry.z}`, rotation: '0 0 0', width: 6, height: 4, depth: .2, elements: [],
    design: entry.design === false ? null : { revision: 1, config: { state: { interactive: true, paused: true } } },
  })) } as any, services: { startRealtime: () => ({ client: { emit, request() {} }, dispose() {} }) } });
  const scene = instance.scene as any;
  scene.camera = new THREE.PerspectiveCamera(60, 1, .1, 100); scene.camera.updateMatrixWorld(true);
  scene.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  for (const entry of entries) {
    const structure = host.querySelector(`a-entity[data-wall-id="${entry.id}"]`)!;
    for (const node of structure.querySelectorAll('a-box, .wall-surface')) {
      const mesh: any = new THREE.Mesh(new THREE.PlaneGeometry(6, 4));
      mesh.position.z = entry.z + (node.matches('.wall-surface') ? .104 : .1);
      mesh.visible = entry.visible !== false; mesh.updateMatrixWorld(true);
      (node as any).getObject3D = () => mesh;
    }
  }
  scene.dispatchEvent(new Event('loaded')); await Promise.resolve();
  const event = new Event('pointermove'); Object.defineProperties(event, { clientX: { value: 50 }, clientY: { value: 50 } });
  scene.dispatchEvent(event);
  const sent = emit.mock.calls.find(([name]) => name === 'wall.interaction')?.[1];
  instance.dispose(); return sent;
}

it.each([false, true])('selects the nearer designed wall regardless of insertion order (%s)', async reverse => {
  const entries = [{ id: 'far', z: -10 }, { id: 'near', z: -3 }];
  expect((await pointAtWalls(reverse ? entries.reverse() : entries))?.wall_id).toBe('near');
});
it('does not send through a nearer ordinary wall', async () => {
  expect(await pointAtWalls([{ id: 'far', z: -10 }, { id: 'blocker', z: -3, design: false }])).toBeUndefined();
});
it('ignores an invisible wall when choosing the visible surface', async () => {
  expect((await pointAtWalls([{ id: 'hidden', z: -3, visible: false }, { id: 'far', z: -10 }]))?.wall_id).toBe('far');
});
