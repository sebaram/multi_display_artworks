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

  // Mini-map
  initMiniMap(presets, boundary);
}

function initMiniMap(presets, boundary) {
  const canvas = document.createElement('canvas');
  canvas.id = 'minimap-canvas';
  canvas.width = 110;
  canvas.height = 110;
  canvas.style.cssText = 'position:fixed;top:10px;right:10px;opacity:0.85;border-radius:8px;border:2px solid rgba(255,255,255,0.3);z-index:9999;cursor:pointer;background:rgba(20,20,40,0.9);';
  canvas.title = 'Mini-map — click to return to default';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const bx = boundary;
  const W = canvas.width, H = canvas.height;

  function drawMinimap() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,25,50,0.95)';
    ctx.fillRect(0, 0, W, H);

    // Room boundary rectangle
    const toScreen = (wx, wz) => ({
      x: ((wx - bx.min_x) / (bx.max_x - bx.min_x)) * W,
      y: ((wz - bx.min_z) / (bx.max_z - bx.min_z)) * H
    });

    const tl = toScreen(bx.min_x, bx.min_z);
    const br = toScreen(bx.max_x, bx.max_z);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    // Wall hints (cross lines)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([3, 3]);
    const cx = toScreen(0, 0);
    ctx.beginPath();
    ctx.moveTo(cx.x, tl.y);
    ctx.lineTo(cx.x, br.y);
    ctx.moveTo(tl.x, cx.y);
    ctx.lineTo(br.x, cx.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Preset markers
    if (presets) {
      presets.forEach(p => {
        const parts = p.position.split(' ');
        const px = ((parseFloat(parts[0]) - bx.min_x) / (bx.max_x - bx.min_x)) * W;
        const py = ((parseFloat(parts[2]) - bx.min_z) / (bx.max_z - bx.min_z)) * H;
        ctx.fillStyle = p.is_default ? '#FFD700' : '#64B5F6';
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '7px sans-serif';
        ctx.fillText(p.name.substring(0, 6), px + 5, py + 3);
      });
    }

    // Player position
    const camera = document.getElementById('camera');
    if (camera) {
      const pos = camera.getAttribute('position');
      if (pos) {
        const px = ((parseFloat(pos.x) - bx.min_x) / (bx.max_x - bx.min_x)) * W;
        const py = ((parseFloat(pos.z) - bx.min_z) / (bx.max_z - bx.min_z)) * H;

        ctx.fillStyle = '#00E676';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        const rot = camera.getAttribute('rotation') || {};
        const rad = THREE.MathUtils ? THREE.MathUtils.degToRad(-(parseFloat(rot.y) || 0)) : -(parseFloat(rot.y) || 0) * Math.PI / 180;
        ctx.strokeStyle = '#00E676';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.sin(rad) * 8, py - Math.cos(rad) * 8);
        ctx.stroke();
      }
    }
  }

  setInterval(drawMinimap, 200);

  // Click minimap to return to default preset
  canvas.addEventListener('click', () => {
    if (presets && presets.length > 0) {
      const def = presets.find(p => p.is_default) || presets[0];
      teleportTo(def, bx);
    }
  });
}