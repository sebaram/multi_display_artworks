import type { AvatarParametric, AvatarPoseV2, AvatarPreset, Quat, Transform, Vec3 } from './types';
import { axisAngle, fromTo, identityPose, inverse, product, rotate, slerp } from './pose';
import { validateParametric } from './appearance-core.js';

export const SMPL_MAX_BYTES = 8 * 1024 * 1024;
type SourceFrame = Readonly<{ global_orient: readonly number[]; body_pose: readonly number[]; transl?: readonly number[];
  left_hand_pose?: readonly number[]; right_hand_pose?: readonly number[]; jaw_pose?: readonly number[];
  leye_pose?: readonly number[]; reye_pose?: readonly number[]; expression?: readonly number[] }>;
export type SmplMotionClip = Readonly<{ model: AvatarParametric['model']; fps: number; units: 'm'; coordinateSystem: 'y-up' | 'z-up';
  label?: string; betas?: readonly number[]; frames: readonly SourceFrame[]; warnings: readonly string[] }>;

function object(value: unknown, keys: string[], name: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw Error(`${name}: expected an object with documented fields only.`);
  return value;
}
function vector(value: unknown, length: number, limit: number, name: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > limit))
    throw Error(`${name}: expected ${length} finite numbers within ±${limit}.`);
  return Object.freeze([...value]);
}
/** Local JSON only. No assets, executable formats, URLs, or transport dependencies. */
export function parseSmplMotion(text: string): SmplMotionClip {
  if (text.length > SMPL_MAX_BYTES || new TextEncoder().encode(text).length > SMPL_MAX_BYTES) throw Error('Motion file exceeds 8 MiB.');
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw Error('Choose a valid motion JSON file (not a pickle or model file).'); }
  const s = object(json, ['model', 'fps', 'units', 'coordinateSystem', 'betas', 'frames', 'label'], 'Motion');
  if (!['smpl', 'smplx'].includes(s.model)) throw Error('model must be smpl or smplx.');
  if (typeof s.fps !== 'number' || !Number.isFinite(s.fps) || s.fps < 1 || s.fps > 120) throw Error('fps must be between 1 and 120.');
  if (s.units !== 'm' || !['y-up', 'z-up'].includes(s.coordinateSystem)) throw Error('Use units m and coordinateSystem y-up or z-up.');
  if (s.label !== undefined && (typeof s.label !== 'string' || s.label.length > 120)) throw Error('label must be at most 120 characters.');
  if (!Array.isArray(s.frames) || !s.frames.length || s.frames.length > 1800) throw Error('Use 1–1800 motion frames.');
  const betas = s.betas === undefined ? undefined : Object.freeze(validateParametric({ model: s.model, betas: s.betas }).betas);
  const ignored = new Set<string>();
  if (s.model === 'smpl') ignored.add('SMPL terminal hand joints');
  const extra = ['left_hand_pose', 'right_hand_pose', 'jaw_pose', 'leye_pose', 'reye_pose', 'expression'];
  const frames = s.frames.map((value: unknown, i: number) => {
    const f = object(value, ['global_orient', 'body_pose', 'transl', ...(s.model === 'smplx' ? extra : [])], `Frame ${i + 1}`);
    const frame: any = { global_orient: vector(f.global_orient, 3, 4 * Math.PI, 'global_orient'),
      body_pose: vector(f.body_pose, s.model === 'smpl' ? 69 : 63, 4 * Math.PI, 'body_pose') };
    if (f.transl !== undefined) frame.transl = vector(f.transl, 3, 10000, 'transl');
    for (const key of extra) if (f[key] !== undefined) {
      const hand = key.endsWith('hand_pose');
      if (hand && (!Array.isArray(f[key]) || f[key].length !== 45)) throw Error(`${key} requires 45 axis-angle floats. PCA-compressed hands are unsupported; export full axis-angle poses.`);
      const length = key === 'expression' ? f[key]?.length : hand ? 45 : 3;
      if (key === 'expression' && (!Number.isInteger(length) || length < 1 || length > 100)) throw Error('expression requires 1–100 coefficients.');
      frame[key] = vector(f[key], length, key === 'expression' ? 10 : 4 * Math.PI, key);
      ignored.add(key);
    }
    return Object.freeze(frame) as SourceFrame;
  });
  const warnings = ['File root trajectories are not applied; body motion stays anchored to your visitor.',
    'Native SMPL meshes, learned deformation, fingers and face are unavailable without licensed model assets. Betas are saved as metadata only.'];
  if (ignored.size) warnings.push(`Retained but not rendered: ${[...ignored].join(', ')}.`);
  return Object.freeze({ model: s.model, fps: s.fps, units: s.units, coordinateSystem: s.coordinateSystem,
    ...(s.label === undefined ? {} : { label: s.label }), ...(betas === undefined ? {} : { betas }), frames: Object.freeze(frames), warnings: Object.freeze(warnings) });
}

// Joint facts: official smplx joint_names.py/body_models.py; independent math, no model code/assets.
const sourceBones = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest',
  'leftFoot', 'rightFoot', 'upperChest', 'leftToes', 'rightToes', 'neck', 'leftShoulder', 'rightShoulder', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
const parents = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19];
const identity: Quat = [0, 0, 0, 1];
const aa = (v: readonly number[]) => axisAngle(v as Vec3, Math.hypot(...v));
function sourceGlobals(clip: SmplMotionClip, frame: SourceFrame) {
  // Source: left +X, forward +Z. Z-up exports rotate that source +90° about X.
  const basis = product(axisAngle([0, 1, 0], Math.PI), clip.coordinateSystem === 'z-up' ? axisAngle([1, 0, 0], -Math.PI / 2) : identity);
  const globals: Quat[] = [];
  return sourceBones.map((_, i) => {
    const local = aa(i === 0 ? frame.global_orient : frame.body_pose.slice((i - 1) * 3, i * 3));
    globals[i] = product(parents[i] < 0 ? identity : globals[parents[i]], local);
    return product(product(basis, globals[i]), inverse(basis));
  });
}
/** Loop body rotations at the caller's anchor. Never consumes file translation. */
export function sampleSmplMotion(clip: SmplMotionClip, preset: AvatarPreset, seconds: number, anchor: Transform, sampleTime: number): AvatarPoseV2 {
  const index = Math.max(0, seconds) * clip.fps % clip.frames.length;
  const a = sourceGlobals(clip, clip.frames[Math.floor(index)]), b = sourceGlobals(clip, clip.frames[(Math.floor(index) + 1) % clip.frames.length]);
  const pose = identityPose(); pose.rigVersion = preset.rigVersion!; pose.sampleTime = sampleTime;
  pose.root = { position: [...anchor.position], orientation: [...anchor.orientation] };
  pose.tracking = { head: false, left: false, right: false };
  const target: Record<string, Quat> = {}, bind: Record<string, Quat> = {};
  preset.coreBones.forEach((name, i) => {
    const rest = preset.restPose[name], parentBind = rest.parent ? bind[rest.parent] : identity;
    bind[name] = product(parentBind, rest.orientation);
    let correction = identity;
    if (/^(left|right)(UpperArm|LowerArm|Hand)$/.test(name)) {
      const side = name.startsWith('left') ? 'left' : 'right';
      const down = rotate(bind[`${side}UpperArm`] ?? bind[name], preset.restPose[`${side}LowerArm`].position);
      correction = fromTo(down, side === 'left' ? [-1, 0, 0] : [1, 0, 0]);
    }
    const j = sourceBones.indexOf(name);
    target[name] = product(slerp(a[j], b[j], index % 1), product(correction, bind[name]));
    pose.boneRotations.set(product(inverse(rest.parent ? target[rest.parent] : identity), target[name]), i * 4);
  });
  return pose;
}
