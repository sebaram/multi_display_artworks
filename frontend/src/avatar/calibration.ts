import type { Calibration } from "./types";
import { clamp } from "./pose";
export const AVATAR_EYE_HEIGHT = 1.64;
/** Seated viewer height cannot identify standing stature. Local space has no measured floor. */
export function calibrateAvatar({
  viewer,
  floorMode,
  posture,
  previous,
  eyeHeight,
}: {
  viewer: { position: { y: number } } | null;
  floorMode: Calibration["referenceSpace"];
  posture: Calibration["mode"];
  previous?: Calibration;
  eyeHeight?: number;
}): Calibration {
  const known = previous?.eyeHeight ?? AVATAR_EYE_HEIGHT;
  const measured = viewer?.position.y;
  const previousFloor =
    previous?.referenceSpace === floorMode ? previous.floorOffset : 0;
  const height = Number.isFinite(eyeHeight)
    ? eyeHeight!
    : posture === "standing" &&
        floorMode === "local-floor" &&
        Number.isFinite(measured) &&
        measured! - previousFloor > 0.5
      ? measured! - previousFloor
      : known;
  const floorOffset =
    floorMode === "local-floor"
      ? previousFloor
      : previous?.referenceSpace === "local"
        ? previous.floorOffset
        : Number.isFinite(measured)
          ? measured! - (posture === "seated" ? 1.1 : height)
          : -height;
  return {
    version: 1,
    eyeHeight: clamp(height, 0.82, 3.28),
    floorOffset,
    mode: posture,
    referenceSpace: floorMode,
  };
}
