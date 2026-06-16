/**
 * gesture_mark_test.js — Input testing page for gesture mark touchpoint streaming.
 *
 * Features:
 *  - Watch-like touchpoint canvas with bezel border, in-trace-out point visualization
 *  - N target cards with multi-step gesture selection
 *  - Gesture direction assignment with icons
 *  - SocketIO real-time touchpoint streaming
 *  - SSE fallback
 *  - Mouse/touch simulation on the watch face
 */

// ─── Configuration ───
const TARGET_ICONS = ['🖼️', '🎬', '🎵', '📊', '🎮', '📸', '📡', '🔧', '💡', '🔬', '📚', '🎨'];
const DIRECTION_CODES = [
  'nn', 'ne', 'ee', 'se', 'ss', 'sw', 'ww', 'nw',
  'ns', 'sn', 'ew', 'we', 'en', 'wn', 'es', 'ws',
  'up', 'down', 'left', 'right'
];
const NUM_TARGETS = parseInt(new URLSearchParams(window.location.search).get('targets') || '8');

// ─── State ───
const state = {
  targets: [],
  selectedTargetId: null,
  selectionStep: 0,         // current step in multi-step selection
  gestureAssignments: {},   // target_id → [direction_code, ...]
  touchpoints: [],
  socket: null,
  connected: false,
};

// ─── Colors for touchpoint types ───
const COLORS = {
  start:   { fill: '#4a9eff', stroke: '#2a6ecc', radius: 10, label: 'IN' },
  trace:   { fill: '#6a6a7a', stroke: '#4a4a5a', radius: 6,  label: 'TRACE' },
  end:     { fill: '#e94560', stroke: '#b83550', radius: 8,  label: 'OUT' },
};

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  initTargets();
  initGestureGrid();
  initCanvas();
  initSocketIO();
  initSimulation();
  log('Ready. Waiting for touchpoint data…');
});

// ─── Target Grid ───
function initTargets() {
  const grid = document.getElementById('targetGrid');
  grid.innerHTML = '';

  for (let i = 0; i < NUM_TARGETS; i++) {
    const id = `target-${i}`;
    const icon = TARGET_ICONS[i % TARGET_ICONS.length];
    const steps = 1 + Math.floor(Math.random() * 3); // 1-3 steps

    state.targets.push({ id, icon, label: `T${i + 1}`, steps, assignedGesture: [] });

    const card = document.createElement('div');
    card.className = 'target-card';
    card.id = id;
    card.innerHTML = `
      <div class="target-icon">${icon}</div>
      <div class="target-label">${'T' + (i + 1)}</div>
      <div class="target-steps">
        ${Array.from({ length: steps }, (_, s) =>
          `<div class="target-step-dot" id="${id}-step-${s}"></div>`
        ).join('')}
      </div>
    `;
    card.addEventListener('click', () => selectTarget(id));
    grid.appendChild(card);
  }
}

function selectTarget(id) {
  // Deselect previous
  if (state.selectedTargetId && state.selectedTargetId !== id) {
    const prev = document.getElementById(state.selectedTargetId);
    if (prev) prev.classList.remove('selected', 'highlight-step');
  }

  const target = state.targets.find(t => t.id === id);
  if (!target) return;

  // If already selected, advance step
  if (state.selectedTargetId === id) {
    state.selectionStep++;
    if (state.selectionStep >= target.steps) {
      // Complete selection
      completeSelection(id);
      return;
    }
  } else {
    state.selectedTargetId = id;
    state.selectionStep = 0;
  }

  // Update visual
  document.querySelectorAll('.target-card').forEach(c => c.classList.remove('selected', 'highlight-step'));
  const card = document.getElementById(id);
  card.classList.add('selected');

  // Update step dots
  updateStepDots(id);
  log(`Selected ${target.label} step ${state.selectionStep + 1}/${target.steps}`);
}

function updateStepDots(id) {
  const target = state.targets.find(t => t.id === id);
  if (!target) return;
  for (let s = 0; s < target.steps; s++) {
    const dot = document.getElementById(`${id}-step-${s}`);
    if (!dot) continue;
    dot.classList.toggle('done', s < state.selectionStep);
    dot.classList.toggle('current', s === state.selectionStep);
  }
}

function completeSelection(id) {
  const target = state.targets.find(t => t.id === id);
  const card = document.getElementById(id);
  card.classList.add('selected');
  card.classList.remove('highlight-step');
  log(`✓ Completed selection: ${target.label}`);

  // Reset for next selection
  state.selectionStep = 0;
  for (let s = 0; s < target.steps; s++) {
    const dot = document.getElementById(`${id}-step-${s}`);
    if (dot) dot.classList.add('done');
  }

  // Auto-reset after 1.5s
  setTimeout(() => {
    card.classList.remove('selected');
    target.steps.forEach((_, s) => {
      const dot = document.getElementById(`${id}-step-${s}`);
      if (dot) { dot.classList.remove('done', 'current'); }
    });
    state.selectedTargetId = null;
    state.selectionStep = 0;
  }, 1500);
}

function resetSelection() {
  state.selectedTargetId = null;
  state.selectionStep = 0;
  document.querySelectorAll('.target-card').forEach(c => c.classList.remove('selected', 'highlight-step'));
  document.querySelectorAll('.target-step-dot').forEach(d => d.classList.remove('done', 'current'));
  log('Selection reset');
}

function shuffleTargets() {
  const grid = document.getElementById('targetGrid');
  const cards = Array.from(grid.children);
  cards.sort(() => Math.random() - 0.5);
  cards.forEach(c => grid.appendChild(c));
  log('Targets shuffled');
}

// ─── Gesture Direction Grid ───
function initGestureGrid() {
  const grid = document.getElementById('gestureGrid');
  const mainDirs = ['nn', 'ne', 'ee', 'se', 'ss', 'sw', 'ww', 'nw'];

  mainDirs.forEach(code => {
    const btn = document.createElement('div');
    btn.className = 'gesture-dir-btn';
    btn.dataset.dir = code;
    btn.innerHTML = `
      <img src="${staticPath}/img/gesture_mark/${code}.PNG" alt="${code}" title="${code}">
      <span>${code}</span>
    `;
    btn.addEventListener('click', () => toggleGestureDir(code, btn));
    grid.appendChild(btn);
  });
}

function toggleGestureDir(code, btn) {
  if (!state.selectedTargetId) {
    log('Select a target first to assign gesture');
    return;
  }

  const target = state.targets.find(t => t.id === state.selectedTargetId);
  if (!target) return;

  btn.classList.toggle('active');
  if (target.assignedGesture.includes(code)) {
    target.assignedGesture = target.assignedGesture.filter(g => g !== code);
  } else {
    target.assignedGesture.push(code);
  }

  const gestureStr = target.assignedGesture.join('_') || '—';
  log(`Gesture for ${target.label}: ${gestureStr}`);
}

// ─── Canvas ───
let canvas, ctx;
const CANVAS_SIZE = 280;
const AREA_INSET = 10;
const DRAW_SIZE = CANVAS_SIZE - AREA_INSET * 2;

function initCanvas() {
  canvas = document.getElementById('touchCanvas');
  ctx = canvas.getContext('2d');

  // Hi-DPI
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_SIZE * dpr;
  canvas.height = CANVAS_SIZE * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  ctx.scale(dpr, dpr);

  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Draw connecting lines
  if (state.touchpoints.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(120, 140, 200, 0.4)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const first = state.touchpoints[0];
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < state.touchpoints.length; i++) {
      const p = state.touchpoints[i];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Draw touchpoints
  state.touchpoints.forEach(p => {
    const cfg = COLORS[p.type] || COLORS.trace;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cfg.radius, 0, Math.PI * 2);
    ctx.fillStyle = cfg.fill;
    ctx.fill();
    ctx.strokeStyle = cfg.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Shadow/glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, cfg.radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = cfg.fill.replace(')', ', 0.15)').replace('rgb', 'rgba');
    ctx.fill();
  });
}

function addTouchpoint(point) {
  if (point.type === 'start') {
    state.touchpoints = [];
  }

  // Normalize coordinates (0-1 range → canvas coordinates within circle)
  const cx = DRAW_SIZE / 2 + AREA_INSET;
  const cy = DRAW_SIZE / 2 + AREA_INSET;
  const r = DRAW_SIZE / 2 - 5;
  const px = cx + point.x * r;
  const py = cy + point.y * r;

  state.touchpoints.push({ x: px, y: py, type: point.type, pressure: point.pressure || 0.5 });
  redraw();

  if (point.type === 'end') {
    // Auto-clear after 2 seconds
    setTimeout(() => {
      if (state.touchpoints.length > 0) {
        state.touchpoints = [];
        redraw();
      }
    }, 2000);
  }
}

function clearTouchpoints() {
  state.touchpoints = [];
  redraw();
  if (state.socket) {
    state.socket.emit('gesture_mark.clear', {});
  }
}

// ─── SocketIO ───
function initSocketIO() {
  const statusEl = document.getElementById('connStatus');

  try {
    // SocketIO should be loaded globally by the room page; for standalone we load it
    if (typeof io === 'undefined') {
      loadScript(socketIoUrl, () => {
        connectSocket(statusEl);
      });
    } else {
      connectSocket(statusEl);
    }
  } catch (e) {
    log('SocketIO load failed, using SSE fallback');
    initSSE();
  }
}

function connectSocket(statusEl) {
  const socket = io({ transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect', () => {
    state.connected = true;
    statusEl.textContent = 'Connected';
    statusEl.classList.add('connected');
    socket.emit('gesture_mark.join', {});
    log('SocketIO connected');
  });

  socket.on('disconnect', () => {
    state.connected = false;
    statusEl.textContent = 'Disconnected';
    statusEl.classList.remove('connected');
    log('SocketIO disconnected');
  });

  socket.on('gesture_mark.touchpoint', (data) => {
    addTouchpoint(data);
  });

  socket.on('gesture_mark.gesture', (data) => {
    document.getElementById('gestureResult').textContent = data.result_str;
    log(`Gesture: ${data.result_str}`);
    // Check if this gesture matches any target
    checkGestureMatch(data.result_str);
  });

  socket.on('gesture_mark.target_select', (data) => {
    selectTarget(data.target_id);
    log(`Remote selected ${data.target_id} step ${data.step}`);
  });

  socket.on('gesture_mark.clear', () => {
    state.touchpoints = [];
    redraw();
  });

  socket.on('gesture_mark.state', (data) => {
    if (data.touchpoints && data.touchpoints.length > 0) {
      data.touchpoints.forEach(p => addTouchpoint(p));
    }
    if (data.gesture_result) {
      document.getElementById('gestureResult').textContent = data.gesture_result;
    }
  });
}

function loadScript(url, cb) {
  const s = document.createElement('script');
  s.src = url;
  s.onload = cb;
  s.onerror = () => log(`Failed to load ${url}`);
  document.head.appendChild(s);
}

// ─── SSE Fallback ───
function initSSE() {
  const statusEl = document.getElementById('connStatus');
  const es = new EventSource('/gesture-mark/stream');

  es.onopen = () => {
    statusEl.textContent = 'SSE Connected';
    statusEl.classList.add('connected');
    state.connected = true;
  };

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.datatype === 'touchpoint' || data.type) {
        addTouchpoint(data);
      } else if (data.datatype === 'gesture_result') {
        document.getElementById('gestureResult').textContent = data.result_str;
        checkGestureMatch(data.result_str);
      }
    } catch (e) {}
  };

  es.onerror = () => {
    statusEl.textContent = 'SSE Error';
    statusEl.classList.remove('connected');
    state.connected = false;
  };
}

// ─── Gesture Matching ───
function checkGestureMatch(resultStr) {
  if (!resultStr) return;

  state.targets.forEach(target => {
    const assigned = target.assignedGesture.join('_');
    if (assigned && assigned === resultStr) {
      log(`🎯 Match! ${target.label} → ${resultStr}`);
      selectTarget(target.id);
    }
  });
}

// ─── Mouse/Touch Simulation on Watch Face ───
function initSimulation() {
  const area = document.getElementById('touchpointArea');
  let simulating = false;

  function getRelPos(e) {
    const rect = area.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = (e.clientX - rect.left - cx) / cx;  // -1..1
    const y = (e.clientY - rect.top - cy) / cy;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  area.addEventListener('mousedown', (e) => {
    simulating = true;
    const pos = getRelPos(e);
    const point = { x: pos.x, y: pos.y, type: 'start', pressure: 0.8 };
    addTouchpoint(point);
    if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);
  });

  area.addEventListener('mousemove', (e) => {
    if (!simulating) return;
    const pos = getRelPos(e);
    const point = { x: pos.x, y: pos.y, type: 'trace', pressure: 0.5 };
    addTouchpoint(point);
    if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);
  });

  area.addEventListener('mouseup', (e) => {
    if (!simulating) return;
    simulating = false;
    const pos = getRelPos(e);
    const point = { x: pos.x, y: pos.y, type: 'end', pressure: 0.3 };
    addTouchpoint(point);
    if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);

    // Try to recognize gesture from the trace
    recognizeGesture();
  });

  // Touch events
  area.addEventListener('touchstart', (e) => {
    e.preventDefault();
    simulating = true;
    const t = e.touches[0];
    const pos = getRelPos(t);
    const point = { x: pos.x, y: pos.y, type: 'start', pressure: 0.8 };
    addTouchpoint(point);
    if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);
  }, { passive: false });

  area.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!simulating) return;
    const t = e.touches[0];
    const pos = getRelPos(t);
    const point = { x: pos.x, y: pos.y, type: 'trace', pressure: 0.5 };
    addTouchpoint(point);
    if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);
  }, { passive: false });

  area.addEventListener('touchend', (e) => {
    if (!simulating) return;
    simulating = false;
    // Use last known position
    if (state.touchpoints.length > 0) {
      const last = state.touchpoints[state.touchpoints.length - 1];
      const point = { x: (last.x - AREA_INSET - DRAW_SIZE / 2) / (DRAW_SIZE / 2),
                      y: (last.y - AREA_INSET - DRAW_SIZE / 2) / (DRAW_SIZE / 2),
                      type: 'end', pressure: 0.3 };
      addTouchpoint(point);
      if (state.socket) state.socket.emit('gesture_mark.touchpoint', point);
    }
    recognizeGesture();
  });
}

// ─── Simple Gesture Recognition ───
function recognizeGesture() {
  if (state.touchpoints.length < 2) return;

  const first = state.touchpoints[0];
  const last = state.touchpoints[state.touchpoints.length - 1];
  const cx = DRAW_SIZE / 2 + AREA_INSET;
  const cy = DRAW_SIZE / 2 + AREA_INSET;

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const angle = Math.atan2(-dy, dx) * 180 / Math.PI; // -180..180, Y inverted
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 15) {
    log('Tap (too short)');
    return;
  }

  // Classify into 8 directions
  let dir;
  if (angle >= -22.5 && angle < 22.5) dir = 'ee';
  else if (angle >= 22.5 && angle < 67.5) dir = 'ne';
  else if (angle >= 67.5 && angle < 112.5) dir = 'nn';
  else if (angle >= 112.5 && angle < 157.5) dir = 'nw';
  else if (angle >= 157.5 || angle < -157.5) dir = 'ww';
  else if (angle >= -157.5 && angle < -112.5) dir = 'sw';
  else if (angle >= -112.5 && angle < -67.5) dir = 'ss';
  else if (angle >= -67.5 && angle < -22.5) dir = 'se';

  document.getElementById('gestureResult').textContent = dir;
  if (state.socket) state.socket.emit('gesture_mark.gesture', { result_str: dir });
  log(`Recognized: ${dir} (${angle.toFixed(0)}°, dist=${dist.toFixed(0)})`);
  checkGestureMatch(dir);
}

// ─── Random Gesture Simulation ───
function simulateGesture() {
  clearTouchpoints();
  const cx = DRAW_SIZE / 2 + AREA_INSET;
  const cy = DRAW_SIZE / 2 + AREA_INSET;
  const r = DRAW_SIZE / 2 - 20;

  // Random start near center
  const startAngle = Math.random() * Math.PI * 2;
  const startR = Math.random() * r * 0.3;
  const sx = cx + Math.cos(startAngle) * startR;
  const sy = cy + Math.sin(startAngle) * startR;

  // Random end
  const endAngle = Math.random() * Math.PI * 2;
  const endR = r * 0.5 + Math.random() * r * 0.4;
  const ex = cx + Math.cos(endAngle) * endR;
  const ey = cy + Math.sin(endAngle) * endR;

  // Animate
  const steps = 8 + Math.floor(Math.random() * 8);
  let i = 0;

  addTouchpoint({ x: (sx - cx) / (DRAW_SIZE / 2), y: (sy - cy) / (DRAW_SIZE / 2), type: 'start' });

  function step() {
    i++;
    const t = i / steps;
    const px = sx + (ex - sx) * t + (Math.random() - 0.5) * 5;
    const py = sy + (ey - sy) * t + (Math.random() - 0.5) * 5;
    const type = i >= steps ? 'end' : 'trace';
    addTouchpoint({ x: (px - cx) / (DRAW_SIZE / 2), y: (py - cy) / (DRAW_SIZE / 2), type });

    if (i < steps) {
      setTimeout(step, 40);
    } else {
      recognizeGesture();
    }
  }
  setTimeout(step, 50);
}

// ─── Logging ───
function log(msg) {
  const panel = document.getElementById('logPanel');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  panel.innerHTML += `<div>[${time}] ${msg}</div>`;
  panel.scrollTop = panel.scrollHeight;
  // Keep max 50 lines
  while (panel.children.length > 50) panel.removeChild(panel.firstChild);
}
