import { clamp, inverse, quaternion, rotate, sub } from './pose';
import type { Transform, Vec3 } from './types';
import {
  DEFAULT_GAZE_CONFIG as defaults, GAZE_NUMERIC_LIMITS as limits,
  GAZE_WEIGHT_KEYS as weightKeys, normalizeGazeConfig as normalize,
} from './gaze-config.js';
export { GAZE_ALGORITHM_VERSION } from './gaze-config.js';

export interface GazeConfig {
  version: 1;
  mode: 'forward' | 'nearest' | 'weighted';
  coneDegrees: number; maxDistance: number;
  minFixationMs: number; maxFixationMs: number; switchMargin: number;
  lostHoldMs: number; smoothingMs: number; maxSpeedDegrees: number;
  maxYawDegrees: number; maxPitchDegrees: number; seed: number; exploration: number;
  weights: Record<'center' | 'proximity' | 'person' | 'speaking' | 'interaction' | 'motion' | 'salience' | 'novelty', number>;
}
export const GAZE_WEIGHT_KEYS = weightKeys as readonly (keyof GazeConfig['weights'])[];
export const GAZE_NUMERIC_LIMITS = limits as Record<Exclude<keyof GazeConfig, 'version' | 'mode' | 'weights'>, [number, number, number]>;
export const DEFAULT_GAZE_CONFIG = defaults as GazeConfig;
export const normalizeGazeConfig = (input: unknown, strict = false): GazeConfig => normalize(input, strict) as GazeConfig;

export interface GazeTarget {
  id: string; position: Vec3; kind: 'person' | 'artwork' | 'marker'; visible?: boolean;
  speaking?: number; interaction?: number; motion?: number; salience?: number;
}
/** Time and all duration settings use milliseconds, like performance.now(). */
export interface GazeFrame { time: number; head: Transform; targets: readonly GazeTarget[]; reset?: boolean }
export interface GazeSnapshot {
  version: 1; source: 'procedural'; yaw: number; pitch: number; targetId: string | null;
  scores: Array<{ id: string; score: number; angleDegrees: number; distance: number }>;
  time: number;
}
export interface GazeController {
  configure(input: unknown): void;
  reset(): void;
  step(frame: GazeFrame): GazeSnapshot;
}

type Candidate = GazeSnapshot['scores'][number] & { yaw: number; pitch: number };
const radians = Math.PI / 180;
const finiteVector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(v => typeof v === 'number' && Number.isFinite(v));
const signal = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : 0;

export function createGazeController(input: unknown = {}): GazeController {
  let config = normalizeGazeConfig(input), randomState = config.seed;
  let lastTime: number | undefined, lastSelection = -Infinity, selectedAt = 0, lostAt: number | undefined;
  let targetId: string | null = null, yaw = 0, pitch = 0, desiredYaw = 0, desiredPitch = 0;
  let exploring = false;
  const exposure = new Map<string, number>();

  const reset = () => {
    lastTime = undefined; lastSelection = -Infinity; selectedAt = 0; lostAt = undefined;
    targetId = null; yaw = pitch = desiredYaw = desiredPitch = 0;
    randomState = config.seed; exposure.clear();
  };
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const choose = (candidates: Candidate[]) => {
    exploring = false;
    if (!candidates.length) return undefined;
    if (config.exploration > 0 && random() < config.exploration) {
      exploring = true;
      return candidates[Math.floor(random() * candidates.length)];
    }
    return candidates[0];
  };

  return {
    configure(value) { config = normalizeGazeConfig(value); reset(); },
    reset,
    step(frame) {
      const time = Number.isFinite(frame?.time) ? frame.time : 0;
      if (frame?.reset || !Number.isFinite(frame?.time) || (lastTime !== undefined && (time < lastTime || time - lastTime > 1000))) reset();
      const dt = lastTime === undefined ? 0 : time - lastTime;
      lastTime = time;
      const head = frame?.head;
      const headValid = finiteVector(head?.position, 3) && finiteVector(head?.orientation, 4) && Math.hypot(...head.orientation) > 1e-8;
      const candidates: Candidate[] = [];
      if (headValid) {
        const headInverse = inverse(quaternion(head.orientation));
        const ids = new Set<string>();
        for (const target of (Array.isArray(frame.targets) ? frame.targets : []).slice(0, 128)) {
          if (!target || typeof target.id !== 'string' || !target.id.length || target.id.length > 128 || ids.has(target.id) ||
            !['person', 'artwork', 'marker'].includes(target.kind) || target.visible === false ||
            (target.visible !== undefined && typeof target.visible !== 'boolean') || !finiteVector(target.position, 3)) continue;
          ids.add(target.id);
          const local = rotate(headInverse, sub(target.position, head.position));
          const distance = Math.hypot(...local);
          if (!local.every(Number.isFinite) || !Number.isFinite(distance) || distance < 1e-6 || distance > config.maxDistance || local[2] >= 0) continue;
          const angleDegrees = Math.acos(clamp(-local[2] / distance, -1, 1)) / radians;
          if (angleDegrees > config.coneDegrees / 2) continue;
          const signals: GazeConfig['weights'] = {
            center: 1 - angleDegrees / (config.coneDegrees / 2), proximity: 1 - distance / config.maxDistance,
            person: target.kind === 'person' ? 1 : 0, speaking: signal(target.speaking), interaction: signal(target.interaction),
            motion: signal(target.motion), salience: signal(target.salience), novelty: 1 / (1 + (exposure.get(target.id) ?? 0) / 1000),
          };
          const totalWeight = GAZE_WEIGHT_KEYS.reduce((sum, key) => sum + config.weights[key], 0);
          const score = config.mode === 'nearest' ? signals.proximity : totalWeight > 0
            ? GAZE_WEIGHT_KEYS.reduce((sum, key) => sum + signals[key] * config.weights[key], 0) / totalWeight : 0;
          candidates.push({ id: target.id, score, distance, angleDegrees,
            yaw: clamp(Math.atan2(local[0], -local[2]), -config.maxYawDegrees * radians, config.maxYawDegrees * radians),
            pitch: clamp(Math.atan2(local[1], Math.hypot(local[0], local[2])), -config.maxPitchDegrees * radians, config.maxPitchDegrees * radians) });
        }
      }
      candidates.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let current = candidates.find(candidate => candidate.id === targetId);
      if (!headValid || config.mode === 'forward') {
        targetId = null; lostAt = undefined; desiredYaw = desiredPitch = 0;
        if (!headValid) yaw = pitch = 0;
      } else {
        if (targetId && !current) {
          lostAt ??= time;
          if (time - lostAt >= config.lostHoldMs) {
            targetId = null; lostAt = undefined; desiredYaw = desiredPitch = 0; lastSelection = -Infinity;
          }
        } else lostAt = undefined;

        if (time - lastSelection >= 100) {
          lastSelection = time;
          const expired = targetId !== null && time - selectedAt >= config.maxFixationMs;
          const preferred = choose(expired ? candidates.filter(candidate => candidate.id !== targetId) : candidates);
          const canSwitch = !targetId || expired || (current && time - selectedAt >= config.minFixationMs && preferred && (exploring || preferred.score > current.score + config.switchMargin));
          if (canSwitch) {
            const nextId = preferred?.id ?? null;
            if (nextId !== targetId) { targetId = nextId; selectedAt = time; lostAt = undefined; }
            current = preferred;
            if (!targetId) desiredYaw = desiredPitch = 0;
          }
        }
        current = candidates.find(candidate => candidate.id === targetId);
        if (current) {
          desiredYaw = current.yaw; desiredPitch = current.pitch;
          const spent = (exposure.get(current.id) ?? 0) + dt;
          exposure.delete(current.id); exposure.set(current.id, spent);
          if (exposure.size > 128) exposure.delete(exposure.keys().next().value!);
        }
      }
      const alpha = config.smoothingMs > 0 ? -Math.expm1(-dt / config.smoothingMs) : 1;
      const deltaYaw = (desiredYaw - yaw) * alpha, deltaPitch = (desiredPitch - pitch) * alpha;
      const length = Math.hypot(deltaYaw, deltaPitch), maxStep = config.maxSpeedDegrees * radians * dt / 1000;
      const scale = length > 0 ? Math.min(1, maxStep / length) : 0;
      yaw += deltaYaw * scale; pitch += deltaPitch * scale;
      return { version: 1, source: 'procedural', yaw, pitch, targetId, time,
        scores: candidates.map(({ id, score, angleDegrees, distance }) => ({ id, score, angleDegrees, distance })) };
    },
  };
}
