import { clockTime } from './reference/motion.js';
export { motionPose, clockTime } from './reference/motion.js';
export { motionContext, relationPose } from './reference/object-motion.js';
export function pointerFromUV({u,v}) {
  if (!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1) throw new RangeError('UV must be finite and between 0 and 1');
  return {x:u-.5,y:.5-v};
}
export { seededUnit } from './reference/logo-morph.js';
export function mediaTarget(positionSeconds, layer, duration) {
  const start = layer.youtube?.start < duration ? layer.youtube.start : 0;
  const time = clockTime(positionSeconds,layer);
  return Number.isFinite(duration) && duration > start ? start+((time%(duration-start))+(duration-start))%(duration-start) : Math.max(0,time);
}
