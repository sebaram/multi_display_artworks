export function createRenderLoop({
  poseBuffer,
  applyPoses,
  requestAnimationFrame,
  cancelAnimationFrame,
  now,
}) {
  let handle = null;
  let running = false;

  function frame() {
    if (!running) return;
    // A throw anywhere in this body must not stop the loop from rescheduling —
    // one bad pose or a rendering error would otherwise permanently freeze every
    // remote avatar for the rest of the session with nothing surfaced to the user.
    try {
      const renderTime = now();
      const poses = new Map();

      poseBuffer.userIds().forEach((userId) => {
        const pose = poseBuffer.poseAt(userId, renderTime);
        if (pose) poses.set(userId, pose);
      });

      applyPoses(poses);
    } finally {
      if (running) handle = requestAnimationFrame(frame);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      handle = requestAnimationFrame(frame);
    },
    destroy() {
      running = false;
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
