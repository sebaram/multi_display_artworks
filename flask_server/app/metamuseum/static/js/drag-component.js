/* A-Frame drag-to-move component for wall elements */
AFRAME.registerComponent('drag-element', {
  schema: {
    elementId: { type: 'string', default: '' },
    elementType: { type: 'string', default: '' },
    wallDepth: { type: 'number', default: 0.2 }
  },

  init: function() {
    this.el.classList.add('drag-enabled');
    this.isDragging = false;
    this.startPos = { x: 0, y: 0 };
    this.originalPos = { x: 0, y: 0, z: 0 };

    // Get initial position
    const pos = this.el.getAttribute('position');
    this.originalPos = { x: pos.x, y: pos.y, z: pos.z };

    // Mouse down - start drag
    this.el.addEventListener('mousedown', this.onMouseDown.bind(this));
    
    // Touch start
    this.el.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });

    // Global listeners
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
    const touch = evt.touches[0];
    this.startDrag(touch.clientX, touch.clientY);
  },

  startDrag: function(clientX, clientY) {
    this.isDragging = true;
    const pos = this.el.getAttribute('position');
    this.originalPos = { x: pos.x, y: pos.y, z: pos.z };
    
    // Highlight effect
    this.el.setAttribute('animation__scale', {
      property: 'scale',
      to: '1.1 1.1 1.1',
      dur: 100,
      easing: 'easeOutQuad'
    });
    this.el.setAttribute('animation__emissive', {
      property: 'material.emissive',
      to: '#444444',
      dur: 100
    });

    document.body.style.cursor = 'grabbing';
  },

  onMouseMove: function(evt) {
    if (!this.isDragging) return;
    this.updatePosition(evt.clientX, evt.clientY);
  },

  onTouchMove: function(evt) {
    if (!this.isDragging) return;
    evt.preventDefault();
    const touch = evt.touches[0];
    this.updatePosition(touch.clientX, touch.clientY);
  },

  updatePosition: function(clientX, clientY) {
    // Calculate movement based on camera perspective
    const camera = document.getElementById('camera');
    if (!camera) return;

    const cameraPos = camera.getAttribute('position');
    const raycaster = this.el.sceneEl.components.raycaster;
    
    // Get the plane we're on (XY plane at element's Z)
    const planeZ = this.originalPos.z;
    
    // Simple 2D drag - map screen movement to XY plane
    const sensitivity = 0.01;
    const dx = (clientX - this.startPos.x) * sensitivity;
    const dy = -(clientY - this.startPos.y) * sensitivity;

    const newX = this.originalPos.x + dx;
    const newY = this.originalPos.y + dy;

    this.el.setAttribute('position', {
      x: newX,
      y: newY,
      z: this.originalPos.z + this.data.wallDepth + 0.05
    });
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

    // Reset scale animation
    this.el.setAttribute('animation__scale', {
      property: 'scale',
      to: '1 1 1',
      dur: 100
    });
    this.el.removeAttribute('animation__emissive');

    // Save new position to server
    const newPos = this.el.getAttribute('position');
    this.savePosition(newPos.x, newPos.y);
  },

  savePosition: function(newX, newY) {
    const elementId = this.data.elementId;
    const elementType = this.data.elementType;

    if (!elementId || !elementType) return;

    fetch(`/element/${elementId}/${elementType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        position_x: newX,
        position_y: newY
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.status === 'success') {
        console.log('Position saved');
      }
    })
    .catch(err => console.error('Failed to save position:', err));
  }
});

/* Hover effect component */
AFRAME.registerComponent('hover-highlight', {
  init: function() {
    this.el.addEventListener('mouseenter', () => {
      this.el.setAttribute('animation__hover', {
        property: 'material.emissive',
        to: '#222222',
        dur: 150
      });
    });

    this.el.addEventListener('mouseleave', () => {
      this.el.setAttribute('animation__hover', {
        property: 'material.emissive',
        to: '#000000',
        dur: 150
      });
    });
  }
});