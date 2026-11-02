/** Map already-filtered head-local radians to ARKit weights; calibrate per exported rig. */
export function lamEyeWeights(
  yaw: number,
  pitch: number,
  yawDegrees = 25,
  pitchDegrees = 15,
) {
  const normalized = (angle: number, degrees: number) =>
    Number.isFinite(angle) && Number.isFinite(degrees) && degrees > 0
      ? Math.max(-1, Math.min(1, (angle * 180) / Math.PI / degrees))
      : 0;
  const horizontal = normalized(yaw, yawDegrees),
    vertical = normalized(pitch, pitchDegrees);
  return {
    eyeLookInLeft: Math.max(0, horizontal),
    eyeLookOutLeft: Math.max(0, -horizontal),
    eyeLookInRight: Math.max(0, -horizontal),
    eyeLookOutRight: Math.max(0, horizontal),
    eyeLookUpLeft: Math.max(0, vertical),
    eyeLookUpRight: Math.max(0, vertical),
    eyeLookDownLeft: Math.max(0, -vertical),
    eyeLookDownRight: Math.max(0, -vertical),
  };
}
