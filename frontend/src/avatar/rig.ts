import type { AvatarPreset, AvatarPoseV2 } from './types';

/** SkeletonUtils.clone algorithm for A-Frame's Three r184, using its own objects.
 * Adapted from three.js r184 examples/jsm/utils/SkeletonUtils.js (MIT).
 * https://github.com/mrdoob/three.js/blob/r184/examples/jsm/utils/SkeletonUtils.js
 * Copyright 2010-2026 Three.js Authors; see public/vendor/three-LICENSE. */
export function cloneRig(source: any, THREE: any) {
  if (THREE.REVISION !== '184') throw Error('Avatar SkeletonUtils requires A-Frame Three r184');
  const originals = new Map<any, any>(), copies = new Map<any, any>();
  const clone = source.clone(true);
  function pair(a: any, b: any) {
    originals.set(b, a); copies.set(a, b);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
  }
  pair(source, clone);
  const skeletons = new Map<any, any>();
  clone.traverse((node: any) => {
    if (!node.isSkinnedMesh) return;
    const original = originals.get(node);
    let skeleton = skeletons.get(original.skeleton);
    if (!skeleton) {
      skeleton = original.skeleton.clone();
      skeleton.bones = original.skeleton.bones.map((bone: any) => copies.get(bone));
      skeletons.set(original.skeleton, skeleton);
    }
    node.skeleton = skeleton;
    node.bindMatrix.copy(original.bindMatrix);
    node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
}
export function inspectRig(root: any, preset: AvatarPreset) {
  for (const name of preset.coreBones) {
    const bone = root.getObjectByName(preset.rigMap[name]);
    const rest = preset.restPose[name];
    if (!bone?.isBone || !rest || bone.position.toArray().some((v: number, i: number) => Math.abs(v - rest.position[i]) > 1e-5)) throw Error(`Invalid humanoid bind bone: ${name}`);
    if (rest.parent && bone.parent.name !== preset.rigMap[rest.parent]) throw Error(`Invalid humanoid parent: ${name}`);
  }
  if (!root.getObjectByName(preset.headAnchor)) throw Error('Missing humanoid head anchor');
}
export function applyRigPose(root: any, preset: AvatarPreset, pose: AvatarPoseV2) {
  if (pose.version !== 2 || pose.rigVersion !== preset.rigVersion || pose.boneRotations.length !== preset.coreBones.length * 4) throw Error('Incompatible avatar pose');
  const numbers = [...pose.root.position, ...pose.root.orientation, ...pose.hipsOffset, ...pose.boneRotations];
  if (!numbers.every(Number.isFinite)) throw Error('Non-finite avatar pose');
  root.position.fromArray(pose.root.position);
  root.quaternion.fromArray(pose.root.orientation).normalize();
  const scale = pose.bodyScale ?? 1;
  if (!Number.isFinite(scale) || scale < .5 || scale > 2) throw Error('Invalid avatar scale');
  root.scale.setScalar(scale);
  preset.coreBones.forEach((name, i) => root.getObjectByName(preset.rigMap[name]).quaternion.fromArray(pose.boneRotations, i * 4).normalize());
  const hips = root.getObjectByName(preset.rigMap.hips);
  hips.position.fromArray(preset.restPose.hips.position);
  hips.position.x += pose.hipsOffset[0]; hips.position.y += pose.hipsOffset[1]; hips.position.z += pose.hipsOffset[2];
}
