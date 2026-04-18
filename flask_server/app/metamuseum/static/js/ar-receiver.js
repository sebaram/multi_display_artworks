/* AR Receiver — Vision Pro receives pose from companion phone via Socket.IO
 *
 * Usage: /room?room_id=...&ar=companion
 * No camera needed — receives marker poses from phone companion via WebSocket
 */

let socket = null;
let socketConnected = false;
let lastPoseUpdate = null;
let teleportThrottle = 0;

function connectARReceiver(roomId) {
  const proto = location.protocol === 'https:' ? 'https:' : 'http:';
  socket = io(`${proto}//${location.host}`, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    console.log('[AR-Receiver] Connected:', socket.id);
    socketConnected = true;
    showARStatus('🟢 Connected to companion');

    socket.emit('join_ar_room', {
      room_id: roomId,
      device: 'vision_pro'
    });
  });

  socket.on('disconnect', () => {
    console.log('[AR-Receiver] Disconnected');
    socketConnected = false;
    showARStatus('🔴 Disconnected — reconnecting...');
  });

  socket.on('pose_update', (data) => {
    // Received marker pose from phone companion
    if (data.found) {
      lastPoseUpdate = data;
      applyMarkerPose(data);
    } else {
      // Marker lost
      showARStatus('📷 Companion lost marker');
    }
  });

  socket.on('joined', (data) => {
    console.log('[AR-Receiver] Joined room:', data);
    updateDeviceCount(data.phones_count, data.vision_pros_count);
  });

  socket.on('sync_state', (data) => {
    console.log('[AR-Receiver] Sync state:', data);
    if (data.latest_pose && data.latest_pose.found) {
      applyMarkerPose(data.latest_pose);
    }
    updateDeviceCount(data.phones_count, data.vision_pros_count);
  });
}

function applyMarkerPose(data) {
  // Apply marker pose to A-Frame camera
  // data.target_position: "x y z" string
  // data.target_rotation: "rx ry rz" string
  // data.marker_name: display name

  const now = Date.now();
  if (now - teleportThrottle < 200) return;  // throttle
  teleportThrottle = now;

  const camera = document.getElementById('camera');
  if (!camera) return;

  const targetPos = data.target_position || '0 1.6 0';
  const targetRot = data.target_rotation || '0 0 0';

  camera.setAttribute('position', targetPos);
  camera.setAttribute('rotation', targetRot);

  // Also update avatar wrapper
  const parts = targetPos.split(' ');
  const wrapper = camera.parentElement;
  if (wrapper) {
    wrapper.setAttribute('position', `${parts[0]} ${parseFloat(parts[1]) - 1.6} ${parts[2]}`);
  }

  showARStatus(`📍 "${data.marker_name || 'Marker'}" — position set`);
  console.log('[AR-Receiver] Teleported to:', targetPos, targetRot);
}

function showARStatus(msg) {
  let overlay = document.getElementById('ar-status-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ar-status-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 13px;
      font-family: -apple-system, sans-serif;
      z-index: 99999;
      text-align: center;
      max-width: 90vw;
    `;
    document.body.appendChild(overlay);
  }
  overlay.textContent = msg;
}

function updateDeviceCount(phones, visionPros) {
  console.log(`[AR-Receiver] Devices — Phones: ${phones}, Vision Pros: ${visionPros}`);
}

// Bootstrap AR receiver mode — called from room template
function bootstrapARReceiverMode(roomId) {
  console.log('[AR-Receiver] Starting companion AR mode for room:', roomId);

  // Connect to Socket.IO server
  connectARReceiver(roomId);

  // Show connecting status
  showARStatus('🔌 Connecting to companion phone...');

  // No skybox in companion mode (display-only)
  const sky = document.querySelector('a-sky');
  if (sky) sky.remove();

  // Remove joystick in companion mode (no camera-based controls needed)
  // Position is controlled by phone companion
}
