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
    const renderTime = now();
    const poses = new Map();

    poseBuffer.userIds().forEach((userId) => {
      const pose = poseBuffer.poseAt(userId, renderTime);
      if (pose) poses.set(userId, pose);
    });

    applyPoses(poses);
    handle = requestAnimationFrame(frame);
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
