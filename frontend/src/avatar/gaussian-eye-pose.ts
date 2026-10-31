import { axisAngle, product } from './pose';

/** Native FLAME is +Y up/+Z face; the avatar's PI-Y root makes it -Z forward.
 * Compose yaw/pitch as rotations, then convert to FLAME's axis-angle vectors. */
export function gaussianEyePose(yaw: number, pitch: number): number[] {
  if (![yaw, pitch].every(Number.isFinite)) throw Error('Invalid gaze angles');
  const q = product(axisAngle([0, 1, 0], -yaw), axisAngle([1, 0, 0], -pitch));
  const length = Math.hypot(q[0], q[1], q[2]);
  const factor = length < 1e-9 ? 2 : 2 * Math.atan2(length, q[3]) / length;
  const eye = q.slice(0, 3).map(value => value * factor);
  return [...eye, ...eye];
}
