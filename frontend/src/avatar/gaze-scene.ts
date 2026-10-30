import { createGazeController, type GazeConfig, type GazeTarget } from './gaze';
import { inverse, rotate, sub } from './pose';
import type { GazePose, Transform, Vec3 } from './types';

/** Owner-only scene signals. No sensor is started by this sampler. */
export function createSceneGaze(scene: any, THREE: any) {
  const controller = createGazeController();
  const ray = new THREE.Raycaster(), origin = new THREE.Vector3(), end = new THREE.Vector3();
  let config: GazeConfig | undefined, configKey = '', refreshed = -Infinity, sampled = -Infinity;
  let nodes: Element[] = [], walls: any[] = [], targets: GazeTarget[] = [];
  const previous = new Map<string, { position: Vec3; time: number }>();
  let interaction: { node: Element; until: number } | undefined;
  const interact = (event: Event) => {
    const node = (event.target as Element)?.closest?.('[data-element-id]');
    if (node) interaction = { node, until: performance.now() + 1800 };
  };
  scene.addEventListener('mouseenter', interact, true);
  scene.addEventListener('click', interact, true);

  function collect(head: Transform, time: number) {
    if (time - refreshed >= 1000) {
      // People are always considered before artwork when the scene exceeds the scan cap.
      nodes = [...scene.querySelectorAll('[id^="camera-"]'), ...scene.querySelectorAll('[data-element-id]')].slice(0, 128) as Element[];
      walls = [...scene.querySelectorAll('[data-wall-id] > a-box')].slice(0, 128)
        .map((el: any) => el.object3D).filter(Boolean);
      for (const wall of walls) wall.updateWorldMatrix(true, true);
      refreshed = time;
    }
    const found: GazeTarget[] = [];
    const active = new Set<string>();
    for (const node of nodes as any[]) {
      if (!node.isConnected || !node.object3D) continue;
      let visible = true;
      for (let object = node.object3D; object; object = object.parent) if (!object.visible) { visible = false; break; }
      if (!visible) continue;
      node.object3D.updateWorldMatrix(true, false);
      const position = node.object3D.getWorldPosition(end).toArray() as Vec3;
      const local = rotate(inverse(head.orientation), sub(position, head.position));
      const distance = Math.hypot(...local);
      if (!distance || distance > config!.maxDistance || local[2] >= 0
        || Math.acos(Math.min(1, -local[2] / distance)) > config!.coneDegrees * Math.PI / 360) continue;
      const person = node.id.startsWith('camera-');
      const id = person ? `person:${node.id.slice(7)}` : `artwork:${node.getAttribute('data-element-id')}`;
      const old = previous.get(id);
      const speed = old && time > old.time ? Math.hypot(...sub(position, old.position)) / ((time - old.time) / 1000) : 0;
      previous.set(id, { position: [...position], time }); active.add(id);
      const suppliedSalience = Number(node.getAttribute('data-gaze-salience') ?? 0);
      found.push({ id, position, kind: person ? 'person' : 'artwork', visible: true,
        speaking: person && !!node.querySelector('.voice-indicator') ? 1 : 0,
        interaction: interaction && interaction.node === node && time < interaction.until ? 1 : 0,
        motion: Math.min(1, speed / 2), salience: Number.isFinite(suppliedSalience) ? Math.max(0, Math.min(1, suppliedSalience)) : 0 });
    }
    for (const id of previous.keys()) if (!active.has(id)) previous.delete(id);
    // shortcut: wall-only line-of-sight and 16 nearest salient candidates; upgrade
    // to spatial indexing if crowded scenes need more candidates or mesh occluders.
    found.sort((a, b) => ((b.speaking ?? 0) + (b.interaction ?? 0)) - ((a.speaking ?? 0) + (a.interaction ?? 0))
      || Math.hypot(...sub(a.position, head.position)) - Math.hypot(...sub(b.position, head.position))
      || a.id.localeCompare(b.id));
    origin.fromArray(head.position);
    return found.slice(0, 16).map(target => {
      end.fromArray(target.position).sub(origin);
      ray.set(origin, end.clone().normalize()); ray.near = .05; ray.far = Math.max(.05, end.length() - .08);
      target.visible = !ray.intersectObjects(walls, true).length;
      return target;
    });
  }
  return {
    sample(head: Transform, value: GazeConfig | undefined, time: number, reset = false): GazePose | undefined {
      const key = JSON.stringify(value ?? null);
      if (key !== configKey) {
        configKey = key; config = value; controller.configure(value); sampled = -Infinity;
        previous.clear(); targets = [];
      }
      if (!value) { delete scene.avatarGaze; return undefined; }
      if (reset || time < sampled) { controller.reset(); sampled = refreshed = -Infinity; previous.clear(); }
      if (time - sampled >= 100) { targets = collect(head, time); sampled = time; }
      const result = controller.step({ time, head, targets, reset });
      scene.avatarGaze = result;
      return { version: 1, source: 'procedural', yaw: result.yaw, pitch: result.pitch };
    },
    dispose() {
      scene.removeEventListener('mouseenter', interact, true); scene.removeEventListener('click', interact, true);
      previous.clear(); nodes = []; walls = []; targets = []; delete scene.avatarGaze;
    },
  };
}
