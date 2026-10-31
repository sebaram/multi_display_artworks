/* A-Frame room boundary component. */

export function registerLocationComponents(AFRAME) {
  if (!AFRAME || AFRAME.components?.['boundary-clamp']) return;
  AFRAME.registerComponent('boundary-clamp', {
  schema: {
    minX: { type: 'number', default: -10 },
    maxX: { type: 'number', default: 10 },
    minY: { type: 'number', default: 0 },
    maxY: { type: 'number', default: 5 },
    minZ: { type: 'number', default: -10 },
    maxZ: { type: 'number', default: 10 }
  },
  clampXRBoundary: function() {
    const xr = this.el.sceneEl?.renderer?.xr;
    if (xr?.getSession?.()) {
      const origin = this.el.parentElement;
      if (origin?.id !== 'avatar-xr-origin') return;
      let pose;
      try { pose = xr.getFrame?.()?.getViewerPose(xr.getReferenceSpace?.()); } catch { return; }
      const p = pose?.transform?.position, rig = origin.object3D, THREE = AFRAME.THREE;
      if (!p || ![p.x,p.y,p.z].every(Number.isFinite) || !rig || !THREE) return;
      rig.updateWorldMatrix(true,false);
      const world = new THREE.Vector3(p.x,p.y,p.z).applyMatrix4(rig.matrixWorld);
      const clamped = new THREE.Vector3(
        Math.max(this.data.minX,Math.min(this.data.maxX,world.x)),
        Math.max(this.data.minY,Math.min(this.data.maxY,world.y)),
        Math.max(this.data.minZ,Math.min(this.data.maxZ,world.z)));
      if (world.distanceToSquared(clamped) < 1e-12) return;
      // Shift virtual placement; the renderer must retain the device's unmodified tracked pose.
      if (rig.parent) {rig.parent.worldToLocal(world);rig.parent.worldToLocal(clamped);}
      rig.position.add(clamped.sub(world));rig.updateMatrixWorld(true);
      this.el.emit?.('avatar-xr-origin-clamped',{},false);
      return;
    }
  },
  tick: function() {
    // XR coordinates must be rebased by the frame sampler before constraining virtual placement.
    if (this.el.sceneEl?.renderer?.xr?.getSession?.()) return;
    const pos = this.el.getAttribute('position');
    if (!pos) return;
    const clamped = {
      x: Math.max(this.data.minX, Math.min(this.data.maxX, pos.x)),
      y: Math.max(this.data.minY, Math.min(this.data.maxY, pos.y)),
      z: Math.max(this.data.minZ, Math.min(this.data.maxZ, pos.z))
    };
    if (pos.x !== clamped.x || pos.y !== clamped.y || pos.z !== clamped.z) {
      this.el.setAttribute('position', clamped);
      const wrapper = this.el.parentElement;
      if (wrapper && wrapper.classList.contains('avatar-wrapper')) {
        wrapper.setAttribute('position', `${clamped.x} ${clamped.y - 1.6} ${clamped.z}`);
      }
    }
  }
  });
}
