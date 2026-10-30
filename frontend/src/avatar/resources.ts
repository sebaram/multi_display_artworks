import { canonicalPreset } from './catalog';
import { cloneRig, inspectRig, applyRigPose } from './rig';
import type { AvatarAppearanceV2, AvatarInstance, AvatarPreset } from './types';

type Entry = { refs: number; promise: Promise<any>; source?: any; animations?: readonly any[] };
const cache = new WeakMap<object, Map<string, Entry>>();
function materials(root: any): Set<any> {
  const result = new Set<any>();
  root.traverse((node: any) => { if (node.isMesh) for (const m of (Array.isArray(node.material) ? node.material : [node.material])) result.add(m); });
  return result;
}
function disposeSource(root: any) {
  const geometries = new Set<any>(), textures = new Set<any>();
  root.traverse((node: any) => { if (node.geometry) geometries.add(node.geometry); if (node.isSkinnedMesh) node.skeleton.dispose(); });
  for (const material of materials(root)) {
    for (const value of Object.values(material) as any[]) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
}
function acquire(THREE: any, preset: AvatarPreset) {
  let entries = cache.get(THREE);
  if (!entries) { entries = new Map(); cache.set(THREE, entries); }
  const key = preset.assetUrl!;
  let entry = entries.get(key);
  if (!entry) {
    entry = { refs: 0, promise: Promise.resolve() };
    const current = entry;
    entry.promise = new THREE.GLTFLoader().loadAsync(key).then((gltf: any) => {
      try {
        inspectRig(gltf.scene, preset);
        gltf.scene.traverse((node: any) => { if (node.geometry && !node.geometry.attributes.normal) node.geometry.computeVertexNormals(); });
        current.source = gltf.scene;
        // Animation clips contain immutable tracks; only mixers/actions are per visitor.
        current.animations = gltf.animations;
        return gltf.scene;
      } catch (error) { disposeSource(gltf.scene); throw error; }
    });
    entries.set(key, entry);
  }
  entry.refs++;
  let released = false;
  return {
    promise: entry.promise,
    animations: () => entry!.animations ?? [],
    release() {
      if (released) return; released = true;
      if (--entry!.refs === 0) {
        entries!.delete(key);
        // Last pending consumer also owns cleanup after asynchronous completion.
        if (entry!.source) disposeSource(entry!.source);
        else entry!.promise.then(source => disposeSource(source), () => {});
      }
    },
  };
}
const slots = ['skin', 'top', 'bottom', 'hair', 'eyes'] as const;
function configurePalette(material: any, THREE: any) {
  const colors = Object.fromEntries(slots.map(slot => [slot, { value: new THREE.Color() }]));
  material.userData.avatarColors = colors;
  material.onBeforeCompile = (shader: any) => {
    for (const slot of slots) shader.uniforms[`avatar_${slot}`] = colors[slot];
    shader.vertexShader = `varying float avatarSlot;\n${shader.vertexShader}`.replace('#include <uv_vertex>', '#include <uv_vertex>\navatarSlot = uv.x * 5.0;');
    shader.fragmentShader = `varying float avatarSlot;\n${slots.map(slot => `uniform vec3 avatar_${slot};`).join('\n')}\n${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>\nvec3 avatarColor = avatar_eyes;\n${slots.slice(0,4).map((slot,i) => `${i ? 'else ' : ''}if (avatarSlot < ${i + 1}.0) avatarColor = avatar_${slot};`).join('\n')}\ndiffuseColor.rgb *= avatarColor;`);
  };
  material.customProgramCacheKey = () => 'avatar-palette-v1';
}
export async function createAvatarInstance({ scene, preset: requested, appearance, signal }: {
  scene: any; preset: AvatarPreset; appearance?: AvatarAppearanceV2; signal?: AbortSignal;
}): Promise<AvatarInstance> {
  const preset = await canonicalPreset(requested.id);
  const THREE = (window as any).AFRAME?.THREE;
  if (!THREE?.GLTFLoader) throw Error('A-Frame avatar runtime unavailable');
  if (signal?.aborted) throw new DOMException('Avatar disposed during load', 'AbortError');
  const resource = acquire(THREE, preset);
  let root: any, mixer: any;
  const ownMaterials = new Map<any, any>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    signal?.removeEventListener('abort', dispose);
    root?.removeFromParent();
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); }
    root?.traverse((node: any) => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    ownMaterials.forEach(material => material.dispose());
    resource.release();
  };
  signal?.addEventListener('abort', dispose, { once: true });
  try {
    const source = await resource.promise;
    if (disposed || signal?.aborted) throw new DOMException('Avatar disposed during load', 'AbortError');
    root = cloneRig(source, THREE);
    mixer = new THREE.AnimationMixer(root);
    root.traverse((node: any) => {
      if (!node.isMesh) return;
      node.frustumCulled = false;
      const cloneMaterial = (material: any) => {
        if (!ownMaterials.has(material)) { const copy = material.clone(); configurePalette(copy, THREE); ownMaterials.set(material, copy); }
        return ownMaterials.get(material);
      };
      node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
    });
    const instance: AvatarInstance = {
      root,
      animations: resource.animations(),
      mixer,
      applyAppearance(next) {
        if (disposed) return;
        const fallback = preset.defaultAppearance!;
        for (const material of ownMaterials.values()) for (const slot of slots) {
          const color = /^#[0-9a-f]{6}$/i.test(next?.colors?.[slot] ?? '') ? next.colors[slot] : fallback.colors[slot];
          material.userData.avatarColors[slot].value.set(color);
        }
        const hat = next?.hatId === 'cap';
        root.getObjectByName('Cap').visible = hat;
        root.getObjectByName('HairShort').visible = next?.hairId === 'short' && !hat;
        root.getObjectByName('GlassesRound').visible = next?.glassesId === 'round';
        root.getObjectByName('FaceFriendly').visible = next?.faceId !== 'calm';
        root.getObjectByName('FaceCalm').visible = next?.faceId === 'calm';
      },
      applyPose(pose) { if (!disposed) applyRigPose(root, preset, pose); },
      // shortcut: low shares the base mesh until distance/visibility LOD in Task 5.
      setDetail(detail) { if (!disposed) root.visible = detail !== 'hidden'; },
      dispose,
    };
    instance.applyAppearance(appearance ?? preset.defaultAppearance!);
    scene.add(root);
    return instance;
  } catch (error) { dispose(); throw error; }
}
