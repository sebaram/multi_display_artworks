/* A-Frame drag-to-move + transform component for wall elements */
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

/* Transform control panel for admin (sliders for scale & rotate) */
function initTransformControls() {
  const panel = document.getElementById('transform-panel');
  if (!panel) return;

  // Load current values from element
  const el = document.querySelector('[data-element-id]');
  if (!el) return;

  const pos = el.getAttribute('position') || {};
  const scale = el.getAttribute('scale') || {};
  const rot = el.getAttribute('rotation') || {};
  const elementId = el.getAttribute('data-element-id');
  const elementType = el.getAttribute('data-element-type');

  // Populate sliders
  const setVal = (id, val) => {
    const input = document.getElementById(id);
    if (input) { input.value = parseFloat(val || 0).toFixed(2); }
  };

  setVal('tf-pos-x', pos.x);
  setVal('tf-pos-y', pos.y);
  setVal('tf-scale-x', scale.x || 1);
  setVal('tf-scale-y', scale.y || 1);
  setVal('tf-scale-z', scale.z || 1);
  setVal('tf-rot-x', rot.x || 0);
  setVal('tf-rot-y', rot.y || 0);
  setVal('tf-rot-z', rot.z || 0);

  // Live preview
  const sliders = panel.querySelectorAll('input[type="range"]');
  sliders.forEach(slider => {
    slider.addEventListener('input', () => {
      const id = slider.id;
      const val = parseFloat(slider.value);
      if (id === 'tf-scale-x' || id === 'tf-scale-y' || id === 'tf-scale-z') {
        const sx = parseFloat(document.getElementById('tf-scale-x').value);
        const sy = parseFloat(document.getElementById('tf-scale-y').value);
        const sz = parseFloat(document.getElementById('tf-scale-z').value);
        el.setAttribute('scale', `${sx} ${sy} ${sz}`);
      } else if (id.startsWith('tf-rot')) {
        const rx = parseFloat(document.getElementById('tf-rot-x').value);
        const ry = parseFloat(document.getElementById('tf-rot-y').value);
        const rz = parseFloat(document.getElementById('tf-rot-z').value);
        el.setAttribute('rotation', `${rx} ${ry} ${rz}`);
      } else if (id.startsWith('tf-pos')) {
        const px = parseFloat(document.getElementById('tf-pos-x').value);
        const py = parseFloat(document.getElementById('tf-pos-y').value);
        const pz = parseFloat(pos.z || 0.2);
        el.setAttribute('position', `${px} ${py} ${pz}`);
      }
      const display = document.getElementById(slider.id + '-val');
      if (display) display.textContent = val.toFixed(2);
    });
  });

  // Apply button
  document.getElementById('tf-apply').addEventListener('click', () => {
    const body = {
      position_x: parseFloat(document.getElementById('tf-pos-x').value),
      position_y: parseFloat(document.getElementById('tf-pos-y').value),
      scale_x: parseFloat(document.getElementById('tf-scale-x').value),
      scale_y: parseFloat(document.getElementById('tf-scale-y').value),
      scale_z: parseFloat(document.getElementById('tf-scale-z').value),
      rotation_x: parseFloat(document.getElementById('tf-rot-x').value),
      rotation_y: parseFloat(document.getElementById('tf-rot-y').value),
      rotation_z: parseFloat(document.getElementById('tf-rot-z').value)
    };

    fetch(`/element/${elementId}/${elementType}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(r => r.json())
    .then(data => {
      const status = document.getElementById('tf-status');
      if (status) {
        status.textContent = data.status === 'success' ? '✅ Saved!' : '❌ Error';
        status.style.color = data.status === 'success' ? '#4CAF50' : '#ff6b6b';
        setTimeout(() => { status.textContent = ''; }, 2000);
      }
    })
    .catch(() => {
      const status = document.getElementById('tf-status');
      if (status) { status.textContent = '❌ Network error'; status.style.color = '#ff6b6b'; }
    });
  });

  // Reset button
  document.getElementById('tf-reset').addEventListener('click', () => {
    ['tf-pos-x','tf-pos-y','tf-scale-x','tf-scale-y','tf-scale-z','tf-rot-x','tf-rot-y','tf-rot-z'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = id.includes('scale') ? '1' : '0';
      const display = document.getElementById(id + '-val');
      if (display) display.textContent = id.includes('scale') ? '1.00' : '0.00';
    });
    el.setAttribute('position', `${pos.x || 0} ${pos.y || 0} ${pos.z || 0.2}`);
    el.setAttribute('scale', '1 1 1');
    el.setAttribute('rotation', '0 0 0');
  });
}

/* AR Passthrough support for admin */
let arPassthroughActive = false;

async function enableARPassthrough() {
  if (!navigator.xr) {
    alert('WebXR not supported on this device');
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      alert('AR passthrough not supported on this device');
      return;
    }

    const scene = document.querySelector('a-scene');
    if (!scene) return;

    // Request AR session with passthrough
    const xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['dom-overlay', 'hand-tracking'],
      optionalFeatures: ['local-floor', 'bounded-floor', 'passthrough']
    });

    // Set scene to AR mode
    scene.setAttribute('renderer', 'colorManagement: true; physicallyCorrectLights: true; logarithmicDepthBuffer: true');
    scene.setAttribute('vr-mode-ui', 'enabled: true');
    scene.setAttribute('ar', 'touchEnabled: true; hitTestEnabled: true');

    xrSession.addEventListener('end', () => {
      arPassthroughActive = false;
      document.getElementById('ar-passthrough-btn').textContent = '🥽 Enable AR Passthrough';
    });

    await scene.setSession(xrSession);
    arPassthroughActive = true;
    document.getElementById('ar-passthrough-btn').textContent = '✅ AR Passthrough Active';
    document.getElementById('ar-passthrough-btn').style.background = '#4CAF50';

  } catch (e) {
    console.error('AR passthrough error:', e);
    alert('Failed to start AR: ' + e.message);
  }
}