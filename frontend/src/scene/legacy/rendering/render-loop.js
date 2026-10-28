const framesByScene = new WeakMap();
const COMPONENT = 'remote-pose-sync';

export function createRenderLoop({
  AFRAME,
  scene,
  poseBuffer,
  applyPoses,
  now,
  console,
}) {
  let running = false;

  if (!AFRAME.components[COMPONENT]) {
    AFRAME.registerComponent(COMPONENT, {
      tick() {
        framesByScene.get(this.el)?.();
      },
    });
  }

  function frame() {
    if (!running) return;
    try {
      const renderTime = now();
      const poses = new Map();

      poseBuffer.userIds().forEach((userId) => {
        const pose = poseBuffer.poseAt(userId, renderTime);
        if (pose) poses.set(userId, pose);
      });

      applyPoses(poses);
    } catch (error) {
      // Keep a bad pose from interrupting A-Frame's own render loop.
      console.error('Remote pose rendering failed:', error);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      framesByScene.set(scene, frame);
      // A-Frame drives tick in both desktop and immersive XR sessions.
      scene.setAttribute(COMPONENT, '');
    },
    destroy() {
      running = false;
      framesByScene.delete(scene);
      scene.removeAttribute(COMPONENT);
    },
  };
}
