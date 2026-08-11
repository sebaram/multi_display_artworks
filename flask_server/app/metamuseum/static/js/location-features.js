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
  tick: function() {
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
