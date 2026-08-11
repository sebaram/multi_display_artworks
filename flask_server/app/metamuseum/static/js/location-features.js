/* Location features: boundary clamp, presets, mini-map */

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
      // Also clamp avatar wrapper
      const wrapper = this.el.parentElement;
      if (wrapper && wrapper.classList.contains('avatar-wrapper')) {
        wrapper.setAttribute('position', `${clamped.x} ${clamped.y - 1.6} ${clamped.z}`);
      }
    }
  }
});

function teleportTo(preset, boundary) {
  const camera = document.getElementById('camera');
  if (!camera) return;

  const parts = preset.position.split(' ');
  const clamped = {
    x: Math.max(boundary.min_x, Math.min(boundary.max_x, parseFloat(parts[0]))),
    y: Math.max(boundary.min_y, Math.min(boundary.max_y, parseFloat(parts[1]))),
    z: Math.max(boundary.min_z, Math.min(boundary.max_z, parseFloat(parts[2])))
  };

  camera.setAttribute('position', clamped);
  camera.setAttribute('rotation', preset.rotation);

  // Also move avatar wrapper
  const wrapper = camera.parentElement;
  if (wrapper) {
    wrapper.setAttribute('position', `${clamped.x} ${clamped.y - 1.6} ${clamped.z}`);
  }
}

function saveCurrentPositionAsPreset(roomId, boundary) {
  const name = prompt('Name for this location preset (e.g. "Entrance", "Gallery A"):');
  if (!name) return;

  const camera = document.getElementById('camera');
  const pos = camera.getAttribute('position');
  const rot = camera.getAttribute('rotation') || { x: 0, y: 0, z: 0 };

  fetch(`/room/${roomId}/preset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      position_x: pos.x,
      position_y: pos.y,
      position_z: pos.z,
      rotation_x: parseFloat(rot.x) || 0,
      rotation_y: parseFloat(rot.y) || 0,
      rotation_z: parseFloat(rot.z) || 0,
      is_default: false
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.status === 'success') {
      alert('✅ Preset "' + name + '" saved!');
      location.reload();
    } else {
      alert('❌ Error: ' + (data.error || 'unknown'));
    }
  })
  .catch(err => alert('❌ Network error: ' + err));
}

function initLocationFeatures(presets, boundary, roomId, isAdmin) {
  // Teleport dropdown (all users)
  if (presets && presets.length > 0) {
    const container = document.createElement('div');
    container.id = 'preset-panel';
    container.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;display:flex;gap:5px;align-items:center;';

    let html = `<select id="preset-select" style="padding:6px 10px;background:rgba(0,0,0,0.8);color:white;border:none;border-radius:4px;font-size:12px;">
      <option value="">📍 Teleport to...</option>
      ${presets.map(p => `<option value="${p.id}">${p.is_default ? '⭐ ' : '📍 '}${p.name}</option>`).join('')}
    </select>`;

    if (isAdmin) {
      html += `<button id="save-preset-btn" style="padding:6px 10px;background:rgba(76,175,80,0.9);color:white;border:none;border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap;">💾 Save Pos</button>`;
    }

    container.innerHTML = html;
    document.body.appendChild(container);

    document.getElementById('preset-select').addEventListener('change', function() {
      const selected = presets.find(p => p.id === this.value);
      if (selected) {
        teleportTo(selected, boundary);
        this.value = '';
      }
    });

    if (isAdmin) {
      document.getElementById('save-preset-btn').addEventListener('click', () => saveCurrentPositionAsPreset(roomId, boundary));
    }
  }

}
