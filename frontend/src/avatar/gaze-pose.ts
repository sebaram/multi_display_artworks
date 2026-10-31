import type { GazePose } from './types';

/** Wire angles in radians: +yaw toward local +X, +pitch toward local +Y. */
export function validateGazePose(value: unknown): GazePose {
  const v = value as any;
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).sort().join(',') !== 'pitch,source,version,yaw'
    || v.version !== 1 || v.source !== 'procedural'
    || !Number.isFinite(v.yaw) || Math.abs(v.yaw) > 80 * Math.PI / 180
    || !Number.isFinite(v.pitch) || Math.abs(v.pitch) > 60 * Math.PI / 180)
    throw Error('Invalid procedural gaze');
  return { version: 1, source: 'procedural', yaw: v.yaw, pitch: v.pitch };
}

export function interpolateGaze(a: GazePose | undefined, b: GazePose | undefined, t: number): GazePose | undefined {
  if (!a && !b) return undefined;
  return { version: 1, source: 'procedural',
    yaw: (a?.yaw ?? 0) + ((b?.yaw ?? 0) - (a?.yaw ?? 0)) * t,
    pitch: (a?.pitch ?? 0) + ((b?.pitch ?? 0) - (a?.pitch ?? 0)) * t };
}
