/* A-Frame drag-to-move component for wall elements. */
AFRAME.registerComponent('drag-element', {
  schema: {
    elementId: { type: 'string', default: '' },
    elementType: { type: 'string', default: '' },
    wallDepth: { type: 'number', default: 0.2 }
  },

  init: function() {
    this.el.classList.add('drag-enabled');
    this.isDragging = false;
    this.startMouse = { x: 0, y: 0 };
    this.originalTransform = { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1, rotX: 0, rotY: 0, rotZ: 0 };

    const pos = this.el.getAttribute('position');
    const scale = this.el.getAttribute('scale') || { x: 1, y: 1, z: 1 };
    const rot = this.el.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
    this.originalTransform = {
      x: pos.x, y: pos.y, z: pos.z,
      scaleX: scale.x || 1, scaleY: scale.y || 1, scaleZ: scale.z || 1,
      rotX: rot.x || 0, rotY: rot.y || 0, rotZ: rot.z || 0
    };

    this.el.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.el.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    document.addEventListener('mousemove', this.onMouseMove.bind(this));
    document.addEventListener('mouseup', this.onMouseUp.bind(this));
    document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    document.addEventListener('touchend', this.onTouchEnd.bind(this));
  },

  onMouseDown: function(evt) {
    evt.preventDefault();
    this.startDrag(evt.clientX, evt.clientY);
  },

  onTouchStart: function(evt) {
    evt.preventDefault();
    this.startDrag(evt.touches[0].clientX, evt.touches[0].clientY);
  },

  startDrag: function(clientX, clientY) {
    this.isDragging = true;
    document.body.style.cursor = 'grabbing';
    this.el.setAttribute('animation__hover', { property: 'scale', to: '1.05 1.05 1.05', dur: 80 });
  },

  onMouseMove: function(evt) {
    if (!this.isDragging) return;
    this.updatePosition(evt.clientX, evt.clientY);
  },

  onTouchMove: function(evt) {
    if (!this.isDragging) return;
    evt.preventDefault();
    this.updatePosition(evt.touches[0].clientX, evt.touches[0].clientY);
  },

  updatePosition: function(clientX, clientY) {
    const sensitivity = 0.008;
    const dx = (clientX - this.startMouse.x) * sensitivity;
    const dy = -(clientY - this.startMouse.y) * sensitivity;

    const newX = this.originalTransform.x + dx;
    const newY = this.originalTransform.y + dy;
    const newZ = this.originalTransform.z + 0.05 + this.data.wallDepth;

    this.el.setAttribute('position', { x: newX, y: newY, z: newZ });
  },

  onMouseUp: function() {
    if (!this.isDragging) return;
    this.endDrag();
  },

  onTouchEnd: function() {
    if (!this.isDragging) return;
    this.endDrag();
  },

  endDrag: function() {
    this.isDragging = false;
    document.body.style.cursor = '';
    this.el.setAttribute('animation__hover', { property: 'scale', to: '1 1 1', dur: 80 });

    const pos = this.el.getAttribute('position');
    this.saveTransform(pos.x, pos.y);
  },

  saveTransform: function(newX, newY) {
    const elementId = this.data.elementId;
    const elementType = this.data.elementType;
    if (!elementId || !elementType) return;

    const scale = this.el.getAttribute('scale') || {};
    const rot = this.el.getAttribute('rotation') || {};

    fetch(`/element/${elementId}/${elementType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position_x: newX,
        position_y: newY,
        scale_x: parseFloat(scale.x || 1),
        scale_y: parseFloat(scale.y || 1),
        scale_z: parseFloat(scale.z || 1),
        rotation_x: parseFloat(rot.x || 0),
        rotation_y: parseFloat(rot.y || 0),
        rotation_z: parseFloat(rot.z || 0)
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        console.log('Transform saved');
      }
    })
    .catch(err => console.error('Failed to save transform:', err));
  }
});
