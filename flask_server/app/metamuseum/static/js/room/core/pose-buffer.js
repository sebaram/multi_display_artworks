import { lerpAngles, lerpVec3, toVec3 } from './pose.js';
import { BUFFER_SIZE, INTERPOLATION_DELAY_MS } from './sync-constants.js';

export function createPoseBuffer({
  delayMs = INTERPOLATION_DELAY_MS,
  size = BUFFER_SIZE,
} = {}) {
  const samplesByUser = new Map();

  function insert(samples, sample) {
    // A later-arriving sample at the same millisecond replaces the earlier one
    // (Date.now() has 1 ms resolution, so a room_state seed and a fast-following
    // live packet can legitimately collide — the fresher data should win).
    const existing = samples.findIndex((entry) => entry.at === sample.at);
    if (existing !== -1) {
      samples[existing] = sample;
      return;
    }

    const before = samples.filter((entry) => entry.at < sample.at).length;
    samples.splice(before, 0, sample);
    if (samples.length > size) samples.shift();
  }

  return {
    record(userId, pose, receivedAt) {
      const position = toVec3(pose?.position);
      const rotation = toVec3(pose?.rotation);
      if (!userId || !position || !rotation) return false;

      const isNew = !samplesByUser.has(userId);
      if (isNew) samplesByUser.set(userId, []);
      insert(samplesByUser.get(userId), { at: receivedAt, position, rotation });
      return isNew;
    },

    poseAt(userId, renderTime) {
      const samples = samplesByUser.get(userId);
      if (!samples?.length) return null;

      const target = renderTime - delayMs;
      const newest = samples[samples.length - 1];
      if (target >= newest.at) return { position: newest.position, rotation: newest.rotation };

      const oldest = samples[0];
      if (target <= oldest.at) return { position: oldest.position, rotation: oldest.rotation };

      const nextIndex = samples.findIndex((entry) => entry.at > target);
      const from = samples[nextIndex - 1];
      const to = samples[nextIndex];
      const span = to.at - from.at;
      const ratio = span === 0 ? 1 : (target - from.at) / span;

      return {
        position: lerpVec3(from.position, to.position, ratio),
        rotation: lerpAngles(from.rotation, to.rotation, ratio),
      };
    },

    stalenessMs(userId, now) {
      const samples = samplesByUser.get(userId);
      if (!samples?.length) return null;
      return now - samples[samples.length - 1].at;
    },

    forget(userId) {
      samplesByUser.delete(userId);
    },

    userIds() {
      return [...samplesByUser.keys()];
    },
  };
}
