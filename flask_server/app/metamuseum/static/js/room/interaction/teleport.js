function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function vectorParts(value) {
  if (typeof value === 'string') return value.trim().split(/\s+/u).map(Number);
  return [Number(value?.x), Number(value?.y), Number(value?.z)];
}

export function teleport(camera, preset, boundary) {
  if (!camera || !preset || !boundary) return false;
  const [x, y, z] = vectorParts(preset.position);
  if (![x, y, z].every(Number.isFinite)) return false;

  const position = [
    clamp(x, boundary.min_x, boundary.max_x),
    clamp(y, boundary.min_y, boundary.max_y),
    clamp(z, boundary.min_z, boundary.max_z),
  ].join(' ');
  camera.setAttribute('position', position);
  camera.setAttribute('rotation', preset.rotation);
  return true;
}

async function saveCurrentPosition({
  roomId,
  camera,
  fetch: fetchRequest,
  prompt: ask,
  alert: notify,
  reload,
}) {
  const name = ask('Name for this location preset (e.g. "Entrance", "Gallery A"):');
  if (!name) return;

  const [positionX, positionY, positionZ] = vectorParts(camera.getAttribute('position'));
  const [rotationX, rotationY, rotationZ] = vectorParts(
    camera.getAttribute('rotation') || { x: 0, y: 0, z: 0 },
  );

  try {
    const response = await fetchRequest(`/room/${roomId}/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        position_x: positionX,
        position_y: positionY,
        position_z: positionZ,
        rotation_x: rotationX || 0,
        rotation_y: rotationY || 0,
        rotation_z: rotationZ || 0,
        is_default: false,
      }),
    });
    const data = await response.json();
    if (data.status === 'success') {
      notify(`✅ Preset "${name}" saved!`);
      reload();
    } else {
      notify(`❌ Error: ${data.error || 'unknown'}`);
    }
  } catch (error) {
    notify(`❌ Network error: ${error}`);
  }
}

export function mountTeleportControls({
  presets = [],
  boundary,
  roomId,
  isAdmin,
  camera,
  document,
  fetch,
  prompt,
  alert,
  reload,
}) {
  if (!camera || !boundary || presets.length === 0) return { destroy() {} };

  const panel = document.createElement('div');
  panel.id = 'preset-panel';
  panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;display:flex;gap:5px;align-items:center;';

  const select = document.createElement('select');
  select.id = 'preset-select';
  select.style.cssText = 'padding:6px 10px;background:rgba(0,0,0,0.8);color:white;border:none;border-radius:4px;font-size:12px;';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '📍 Teleport to...';
  select.appendChild(placeholder);

  presets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.is_default ? '⭐' : '📍'} ${preset.name}`;
    select.appendChild(option);
  });
  select.addEventListener('change', () => {
    const selected = presets.find((preset) => String(preset.id) === String(select.value));
    if (selected) teleport(camera, selected, boundary);
    select.value = '';
  });
  panel.appendChild(select);

  if (isAdmin) {
    const saveButton = document.createElement('button');
    saveButton.id = 'save-preset-btn';
    saveButton.textContent = '💾 Save Pos';
    saveButton.style.cssText = 'padding:6px 10px;background:rgba(76,175,80,0.9);color:white;border:none;border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap;';
    saveButton.addEventListener('click', () => saveCurrentPosition({
      roomId,
      camera,
      fetch,
      prompt,
      alert,
      reload,
    }));
    panel.appendChild(saveButton);
  }

  document.body.appendChild(panel);
  return {
    destroy() {
      panel.remove();
    },
  };
}
