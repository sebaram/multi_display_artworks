/* AR.js Marker Detection — physical marker → virtual position mapping
 *
 * When ?ar=marker is set in URL:
 * 1. Start AR.js camera (webcam passthrough)
 * 2. Detect marker → look up target position from Marker model
 * 3. Teleport A-Frame camera to corresponding virtual position
 * 4. Show virtual room content overlaid on real camera feed
 */

let currentMarkerConfig = null;
let arSceneStarted = false;

// Fetch marker config from server
async function fetchMarkerConfig(markerValue, markerType) {
  try {
    const resp = await fetch(`/marker/by-value/${encodeURIComponent(markerType)}/${encodeURIComponent(markerValue)}`);
    if (resp.ok) {
      currentMarkerConfig = await resp.json();
      console.log('[AR] Marker config loaded:', currentMarkerConfig.name);
      return currentMarkerConfig;
    }
  } catch (e) {
    console.warn('[AR] Marker config fetch failed:', e);
  }
  return null;
}

// Teleport camera to marker target position
function teleportToMarkerTarget(config) {
  const camera = document.getElementById('camera');
  if (!camera) return;

  const pos = config.target_position.split(' ');
  const rot = config.target_rotation.split(' ');

  camera.setAttribute('position', config.target_position);
  camera.setAttribute('rotation', config.target_rotation);

  // Also move avatar wrapper
  const wrapper = camera.parentElement;
  if (wrapper) {
    wrapper.setAttribute('position', `${pos[0]} ${parseFloat(pos[1]) - 1.6} ${pos[2]}`);
  }

  // Show overlay
  showMarkerOverlay(config.name, true);

  console.log('[AR] Teleported to:', config.target_position, config.target_rotation);
}

// Show/hide marker-found overlay
function showMarkerOverlay(markerName, found) {
  let overlay = document.getElementById('marker-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'marker-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(76, 175, 80, 0.9);
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 14px;
      z-index: 99999;
      font-family: -apple-system, sans-serif;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(overlay);
  }

  if (found) {
    overlay.textContent = `✅ "${markerName}" detected — position set`;
    overlay.style.background = 'rgba(76, 175, 80, 0.9)';
  } else {
    overlay.textContent = '📷 Scan a marker...';
    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
  }
}

// Init AR mode: set up marker detection events
function initARMarkerMode() {
  console.log('[AR] Initializing marker detection mode...');

  // Show scanning overlay
  showMarkerOverlay(null, false);

  // Find all a-marker elements and attach handlers
  document.querySelectorAll('a-marker').forEach(el => {
    const markerValue = el.getAttribute('preset') || el.getAttribute('type') || 'hiro';
    const markerType = el.hasAttribute('preset') ? 'hiro' :
                       el.hasAttribute('type') && el.getAttribute('type') === 'pattern' ? 'pattern' : 'hiro';

    el.addEventListener('markerFound', async () => {
      console.log('[AR] Marker found:', markerValue);

      // Fetch config if not already loaded
      if (!currentMarkerConfig) {
        await fetchMarkerConfig(markerValue, markerType);
      }

      if (currentMarkerConfig) {
        teleportToMarkerTarget(currentMarkerConfig);
      } else {
        // No config found — just show generic success
        showMarkerOverlay(markerValue, true);
      }
    });

    el.addEventListener('markerLost', () => {
      console.log('[AR] Marker lost:', markerValue);
      showMarkerOverlay(null, false);
    });
  });

  // If no a-marker elements in DOM yet, wait for scene load
  if (document.querySelectorAll('a-marker').length === 0) {
    const scene = document.querySelector('a-scene');
    if (scene) {
      scene.addEventListener('loaded', () => {
        initARMarkerMode();
      });
    }
  }
}

// Start AR.js camera with video background
// Replaces the skybox with live camera feed
function enableARCameraFeed() {
  const scene = document.querySelector('a-scene');
  if (!scene) return;

  // Get AR.js video element and make it the scene background
  const video = document.querySelector('video[autoplay]');
  if (video) {
    scene.style.position = 'fixed';
    scene.style.width = '100vw';
    scene.style.height = '100vh';
    scene.style.top = '0';
    scene.style.left = '0';
    scene.style.zIndex = '0';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
  }
}

// AR mode bootstrap — called from room template
function bootstrapARMode(roomId, presetId) {
  // Hide 3D skybox, show camera feed
  const sky = document.querySelector('a-sky');
  if (sky) {
    sky.remove();
  }

  // Add arjs component to scene
  const scene = document.querySelector('a-scene');
  if (scene) {
    scene.setAttribute('arjs', 'sourceType: webcam; debugUIEnabled: false;');
    scene.setAttribute('renderer', 'logEvents: false;');
    scene.setAttribute('vr-mode-ui', 'enabled: false');

    // Make scene background transparent (show camera)
    scene.addEventListener('loaded', () => {
      enableARCameraFeed();
      initARMarkerMode();
    });
  }

  // Add marker elements dynamically based on room markers
  loadRoomMarkers(roomId);
}

// Fetch room markers and create a-marker elements
async function loadRoomMarkers(roomId) {
  try {
    const resp = await fetch(`/marker/room/${roomId}/markers`);
    if (!resp.ok) return;

    const markers = await resp.json();
    const scene = document.querySelector('a-scene');
    if (!scene || markers.length === 0) return;

    markers.forEach(m => {
      const markerEl = document.createElement('a-marker');
      markerEl.setAttribute('id', `marker-${m.id}`);
      markerEl.setAttribute('marker_id', m.id);

      if (m.marker_type === 'hiro') {
        markerEl.setAttribute('preset', 'hiro');
      } else if (m.marker_type === 'pattern') {
        markerEl.setAttribute('type', 'pattern');
        markerEl.setAttribute('url', m.marker_value);
      } else if (m.marker_type === 'image') {
        markerEl.setAttribute('type', 'nft');
        markerEl.setAttribute('url', m.marker_value);
      }

      // Attach marker content (invisible anchor, content is in room)
      markerEl.innerHTML = `<a-entity visible="false"></a-entity>`;
      scene.appendChild(markerEl);
    });

    console.log(`[AR] Loaded ${markers.length} markers for room ${roomId}`);

    // Re-init after adding markers
    setTimeout(initARMarkerMode, 500);
  } catch (e) {
    console.error('[AR] Failed to load room markers:', e);
  }
}
