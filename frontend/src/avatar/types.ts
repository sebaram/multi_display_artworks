/** All transforms use meters, Y up, forward -Z; quaternion order is x,y,z,w. */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Transform = { position: Vec3; orientation: Quat };
export type HumanoidBone = 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head'
  | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
  | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
  | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes';
export type AvatarColors = Record<'skin' | 'top' | 'bottom' | 'hair' | 'eyes', string>;
export type GazePose = { version: 1; source: 'procedural'; yaw: number; pitch: number };
export interface AvatarAppearanceV2 {
  schemaVersion: 2; presetId: string; colors: AvatarColors;
  faceId: string; hairId: string; hatId: string; glassesId: string;
  gaze?: import('./gaze').GazeConfig;
}
export interface AvatarPreset {
  id: string; label: string; kind: 'humanoid' | 'gltf' | 'primitive' | 'none';
  assetUrl: string | null; thumbnail: string | null; rigVersion: string | null;
  nativeGaussian?: 'subject-306';
  /** Immutable wire order. Rotations are absolute parent-relative, not rest deltas. */
  coreBones: readonly HumanoidBone[]; rigMap: Record<string, string>;
  restPose: Record<string, Transform & { parent: string | null }>;
  materialSlots: Record<string, string>; headAnchor: string | null;
  capabilities: Record<'colors' | 'face' | 'hair' | 'accessories' | 'fullBody', boolean>;
  budgets: { triangles: number; bones: number; bodyMaterials: number; accessoryMaterials: number; textureSize: number } | null;
  options: Record<string, string[]>; compatibility: Record<string, { hides: string[] }>;
  defaultAppearance: AvatarAppearanceV2 | null;
}
export interface AvatarCatalog { schemaVersion: 2; presets: AvatarPreset[] }
export type TrackingStatus = { head: boolean; left: boolean; right: boolean };
/** Device-local sensor targets. Never sent as the final avatar pose. */
export interface AvatarInputV2 {
  version: 2; sampleTime: number; root: Transform; bodyScale?: number; head: Transform | null;
  /** Local solver hint; only solved joints/bodyScale are transmitted. */
  posture?: 'standing' | 'seated';
  left: Transform | null; right: Transform | null; tracking: TrackingStatus;
  locomotion: { velocity: Vec3; grounded: boolean; teleport: boolean };
}
/** Owner-generated complete snapshot; receivers interpolate only, without IK. */
export interface AvatarPoseV2 {
  version: 2; rigVersion: string; sequence: number; sampleTime: number;
  root: Transform; hipsOffset: Vec3; bodyScale?: number;
  /** Exactly 4 * coreBones.length floats, xyzw in catalog order. */
  boneRotations: Float32Array; tracking: TrackingStatus; teleport: boolean;
  gaze?: GazePose;
}
export interface Calibration {
  version: 1; eyeHeight: number; floorOffset: number;
  mode: 'standing' | 'seated'; referenceSpace: 'local-floor' | 'local';
}
export interface AvatarInstance {
  root: any;
  preset: AvatarPreset;
  /** Shared immutable animation clips; mixer and action state belong to this instance. */
  animations: readonly any[];
  mixer: any;
  applyAppearance(appearance: AvatarAppearanceV2): void;
  applyPose(pose: AvatarPoseV2): void;
  updateExpression(time: number): void;
  showExpression(expression: string, time: number): void;
  setDetail(detail: 'full' | 'low' | 'hidden'): void;
  dispose(): void;
}
