import { maxAxisDelta, toVec3 } from './pose.js';
import {
  HEARTBEAT_MS, MIN_SEND_INTERVAL_MS, POSITION_EPSILON, ROTATION_EPSILON,
} from './sync-constants.js';

export function createPosePublisher({
  positionEpsilon = POSITION_EPSILON,
  rotationEpsilon = ROTATION_EPSILON,
  heartbeatMs = HEARTBEAT_MS,
  minIntervalMs = MIN_SEND_INTERVAL_MS,
} = {}) {
  let sentAt = null;
  let sentPosition = null;
  let sentRotation = null;

  return {
    shouldSend(pose, now) {
      const position = toVec3(pose?.position);
      const rotation = toVec3(pose?.rotation);
      if (!position || !rotation) return false;

      const elapsed = sentAt === null ? Infinity : now - sentAt;
      if (elapsed < minIntervalMs) return false;

      const changed = maxAxisDelta(sentPosition, position) > positionEpsilon
        || maxAxisDelta(sentRotation, rotation) > rotationEpsilon;

      if (!changed && elapsed < heartbeatMs) return false;

      sentAt = now;
      sentPosition = position;
      sentRotation = rotation;
      return true;
    },
  };
}
