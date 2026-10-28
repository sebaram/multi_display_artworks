const ELEMENT_COLORS = {
  image: '#4CAF50',
  gaussian_splat: '#FF9800',
  webpage: '#00BCD4',
  gltf: '#9C27B0',
};

function positionParts(value) {
  if (typeof value === 'string') {
    const [x = 0, y = 0, z = 0] = value.split(' ').map(Number);
    return { x, y, z };
  }
  return {
    x: Number(value?.x) || 0,
    y: Number(value?.y) || 0,
    z: Number(value?.z) || 0,
  };
}

function drawRoomMap(context, width, height, { presets, boundary, wallList, camera }) {
  const minX = Number(boundary.min_x);
  const maxX = Number(boundary.max_x);
  const minZ = Number(boundary.min_z);
  const maxZ = Number(boundary.max_z);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const toScreen = (worldX, worldZ) => ({
    x: ((Number(worldX) - minX) / rangeX) * width,
    y: ((Number(worldZ) - minZ) / rangeZ) * height,
  });

  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(20,25,50,0.95)';
  context.fillRect(0, 0, width, height);

  const topLeft = toScreen(minX, minZ);
  const bottomRight = toScreen(maxX, maxZ);
  context.strokeStyle = 'rgba(255,255,255,0.35)';
  context.lineWidth = 1;
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );

  context.strokeStyle = 'rgba(255,255,255,0.15)';
  context.setLineDash([3, 3]);
  const center = toScreen(0, 0);
  context.beginPath();
  context.moveTo(center.x, topLeft.y);
  context.lineTo(center.x, bottomRight.y);
  context.moveTo(topLeft.x, center.y);
  context.lineTo(bottomRight.x, center.y);
  context.stroke();
  context.setLineDash([]);

  wallList.forEach((wall) => {
    const wallPosition = positionParts(wall.position);
    const wallWidth = Number(wall.width) || 2;
    const rotationY = positionParts(wall.rotation).y;
    const degrees = Math.abs(rotationY % 180);
    let x1;
    let x2;
    let z1;
    let z2;

    if (degrees < 45 || degrees > 135) {
      x1 = wallPosition.x - wallWidth / 2;
      x2 = wallPosition.x + wallWidth / 2;
      z1 = wallPosition.z;
      z2 = wallPosition.z;
    } else {
      x1 = wallPosition.x;
      x2 = wallPosition.x;
      z1 = wallPosition.z - wallWidth / 2;
      z2 = wallPosition.z + wallWidth / 2;
    }

    const first = toScreen(x1, z1);
    const second = toScreen(x2, z2);
    if (wall.surface_type === 'floor') {
      const rectX = Math.min(first.x, second.x);
      const rectY = Math.min(first.y, second.y);
      const rectWidth = Math.max(Math.abs(second.x - first.x), 4);
      const rectHeight = Math.max(Math.abs(second.y - first.y), 4);
      context.fillStyle = 'rgba(60,90,180,0.25)';
      context.fillRect(rectX, rectY, rectWidth, rectHeight);
      context.strokeStyle = 'rgba(80,120,255,0.5)';
      context.lineWidth = 1;
      context.strokeRect(rectX, rectY, rectWidth, rectHeight);
    } else {
      context.strokeStyle = 'rgba(120,160,255,0.8)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.stroke();
    }

    (wall.elements ?? []).forEach((element) => {
      const marker = toScreen(element.world_x, element.world_z);
      context.fillStyle = ELEMENT_COLORS[element.type] ?? '#FFFFFF';
      context.beginPath();
      context.arc(marker.x, marker.y, 4, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.5)';
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,0.9)';
      context.font = '6px sans-serif';
      context.fillText(String(element.name ?? '').slice(0, 8), marker.x + 5, marker.y + 3);
    });
  });

  presets.forEach((preset) => {
    const position = positionParts(preset.position);
    const marker = toScreen(position.x, position.z);
    context.fillStyle = preset.is_default ? '#FFD700' : '#64B5F6';
    context.beginPath();
    context.arc(marker.x, marker.y, 3.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.8)';
    context.font = '7px sans-serif';
    context.fillText(String(preset.name ?? '').slice(0, 6), marker.x + 5, marker.y + 3);
  });

  const cameraPosition = camera?.getAttribute?.('position');
  if (!cameraPosition) return;

  const player = toScreen(cameraPosition.x, cameraPosition.z);
  context.fillStyle = '#00E676';
  context.beginPath();
  context.arc(player.x, player.y, 4, 0, Math.PI * 2);
  context.fill();

  const rotation = camera.getAttribute('rotation') ?? {};
  const radians = -(Number(rotation.y) || 0) * Math.PI / 180;
  context.strokeStyle = '#00E676';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(player.x, player.y);
  context.lineTo(player.x + Math.sin(radians) * 8, player.y - Math.cos(radians) * 8);
  context.stroke();
}

function createLegend(document) {
  const legend = document.createElement('ul');
  legend.setAttribute('aria-label', 'Map legend');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;list-style:none;padding:0;margin:12px 0 0;font:13px sans-serif;';
  [
    ['Wall', 'rgba(120,160,255,0.8)'],
    ['Artwork', '#4CAF50'],
    ['Preset', '#FFD700'],
    ['You', '#00E676'],
  ].forEach(([label, color]) => {
    const item = document.createElement('li');
    item.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const swatch = document.createElement('span');
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};`;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(swatch, text);
    legend.appendChild(item);
  });
  return legend;
}

export function mountMinimap({
  presets = [],
  boundary,
  wallList = [],
  getCamera,
  document,
  requestAnimationFrame,
  cancelAnimationFrame,
}) {
  const view = document.defaultView ?? globalThis.window;
  const requestFrame = requestAnimationFrame ?? view?.requestAnimationFrame?.bind(view);
  const cancelFrame = cancelAnimationFrame ?? view?.cancelAnimationFrame?.bind(view);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('id', 'minimap-canvas');
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', 'Open expanded room map');
  canvas.setAttribute('title', 'Open expanded room map');
  canvas.width = 110;
  canvas.height = 110;
  canvas.style.cssText = 'position:fixed;top:10px;right:10px;width:110px;height:110px;opacity:0.85;border-radius:8px;border:2px solid rgba(255,255,255,0.3);z-index:9999;cursor:pointer;background:rgba(20,20,40,0.9);';

  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'expanded-map-title');
  dialog.style.cssText = 'width:min(80vw,800px);max-width:800px;max-height:80vh;overflow:auto;border:1px solid rgba(255,255,255,0.35);border-radius:12px;padding:18px;background:rgba(12,16,35,0.98);color:white;box-shadow:0 20px 60px rgba(0,0,0,0.55);';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:12px;';
  const title = document.createElement('h2');
  title.setAttribute('id', 'expanded-map-title');
  title.textContent = 'Room map';
  title.style.cssText = 'font:600 20px sans-serif;margin:0;';
  const closeButton = document.createElement('button');
  closeButton.setAttribute('type', 'button');
  closeButton.setAttribute('aria-label', 'Close expanded map');
  closeButton.textContent = 'Close';
  closeButton.style.cssText = 'padding:7px 12px;border:0;border-radius:6px;background:#44506f;color:white;cursor:pointer;';
  header.append(title, closeButton);

  const mapContainer = document.createElement('div');
  mapContainer.style.cssText = 'width:100%;min-width:0;';
  const expandedCanvas = document.createElement('canvas');
  expandedCanvas.setAttribute('role', 'img');
  expandedCanvas.setAttribute('aria-label', 'Expanded room map showing walls, artworks, presets, and your position');
  expandedCanvas.style.cssText = 'display:block;width:100%;max-height:65vh;border-radius:8px;background:rgba(20,20,40,0.95);';
  mapContainer.appendChild(expandedCanvas);
  dialog.append(header, mapContainer, createLegend(document));

  document.body.append(canvas, dialog);
  const compactContext = canvas.getContext('2d');
  const expandedContext = expandedCanvas.getContext('2d');
  let frameId = null;
  let destroyed = false;

  function sizeExpandedCanvas() {
    const measured = mapContainer.getBoundingClientRect?.().width || mapContainer.clientWidth || 640;
    const width = Math.max(280, Math.min(Math.floor(measured), 760));
    expandedCanvas.width = width;
    expandedCanvas.height = width;
  }

  function render() {
    const state = { presets, boundary, wallList, camera: getCamera() };
    drawRoomMap(compactContext, canvas.width, canvas.height, state);
    if (dialog.open) {
      drawRoomMap(expandedContext, expandedCanvas.width, expandedCanvas.height, state);
    }
  }

  function tick() {
    if (destroyed) return;
    render();
    frameId = requestFrame?.(tick) ?? null;
  }

  function restoreFocus() {
    canvas.focus();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    restoreFocus();
  }

  function openDialog() {
    if (dialog.open) return;
    dialog.showModal();
    sizeExpandedCanvas();
    render();
    closeButton.focus();
  }

  function onCanvasKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDialog();
  }

  function onDialogClick(event) {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left
      || event.clientX > rect.right
      || event.clientY < rect.top
      || event.clientY > rect.bottom;
    if (outside) closeDialog();
  }

  function onDialogKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDialog();
  }

  function onDialogCancel(event) {
    event.preventDefault();
    closeDialog();
  }

  function onResize() {
    if (!dialog.open) return;
    sizeExpandedCanvas();
    render();
  }

  canvas.addEventListener('click', openDialog);
  canvas.addEventListener('keydown', onCanvasKeydown);
  closeButton.addEventListener('click', closeDialog);
  dialog.addEventListener('click', onDialogClick);
  dialog.addEventListener('keydown', onDialogKeydown);
  dialog.addEventListener('cancel', onDialogCancel);
  dialog.addEventListener('close', restoreFocus);
  view?.addEventListener?.('resize', onResize);

  render();
  frameId = requestFrame?.(tick) ?? null;

  return {
    canvas,
    dialog,
    expandedCanvas,
    destroy() {
      destroyed = true;
      if (frameId !== null) cancelFrame?.(frameId);
      view?.removeEventListener?.('resize', onResize);
      if (dialog.open) dialog.close();
      canvas.remove();
      dialog.remove();
    },
  };
}
