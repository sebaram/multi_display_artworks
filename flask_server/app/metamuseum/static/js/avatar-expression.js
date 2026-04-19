/* Avatar Expressions — face + gesture → emoji indicator above avatar

Uses face-api.js (TensorFlow.js) for face expression detection.
Shows emoji bubble above avatar when:
- Smile detected → 😊
- Hand raised (via WebXR hand tracking) → 👋

Works for own avatar (seen by others) and other users' avatars.
*/

let faceApiLoaded = false;
let faceApiModelsLoaded = false;
let expressionInterval = null;
let lastSmileTime = 0;

const FACE_API_MODELS_BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

async function loadFaceAPI() {
  if (faceApiLoaded) return;
  faceApiLoaded = true;

  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
  script.onload = async () => {
    console.log('[FaceAPI] Loaded, loading models...');
    try {
      // Load tiny face detector + expression model
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODELS_BASE);
      await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODELS_BASE);
      faceApiModelsLoaded = true;
      console.log('[FaceAPI] Models ready');
      startExpressionDetection();
    } catch (e) {
      console.warn('[FaceAPI] Model load failed, expressions disabled:', e);
    }
  };
  script.onerror = () => {
    console.warn('[FaceAPI] Script load failed, expressions disabled');
  };
  document.head.appendChild(script);
}

async function startExpressionDetection() {
  if (!faceApiModelsLoaded) return;

  const video = document.createElement('video');
  video.style.cssText = 'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0;';
  video.autoplay = true;
  video.playsinline = true;
  video.muted = true;
  document.body.appendChild(video);

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    console.warn('[FaceAPI] Camera access denied:', e.message);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  expressionInterval = setInterval(async () => {
    if (!faceApiModelsLoaded || video.readyState < 2) return;

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions();

      let isSmiling = false;
      detections.forEach(det => {
        const smile = det.expressions.get('happy');
        if (smile && smile > 0.5) {
          isSmiling = true;
        }
      });

      const now = Date.now();
      if (isSmiling && now - lastSmileTime > 3000) {
        lastSmileTime = now;
        showAvatarExpression('😊');
      }
    } catch (e) {
      // Silent fail on detection errors
    }
  }, 1000);
}

// Show expression emoji bubble above own avatar
function showAvatarExpression(emoji, duration = 3000) {
  // Find own camera element
  const myCamera = document.getElementById(`camera-${myUserId}`);
  if (!myCamera) return;

  // Create or update expression bubble
  let bubble = myCamera.querySelector('.expression-bubble');
  if (!bubble) {
    bubble = document.createElement('a-text');
    bubble.setAttribute('class', 'expression-bubble');
    bubble.setAttribute('value', emoji);
    bubble.setAttribute('position', '0 0.8 0');
    bubble.setAttribute('scale', '0.8 0.8 0.8');
    bubble.setAttribute('align', 'center');
    myCamera.appendChild(bubble);
  }
  bubble.setAttribute('value', emoji);

  setTimeout(() => {
    if (bubble) bubble.setAttribute('value', '');
  }, duration);

  // Broadcast expression to other users via socket
  if (posSocket && posSocketConnected) {
    posSocket.emit('expression', {
      room_id: roomId,
      userId: myUserId,
      expression: emoji
    });
  }
}

// Handle hand-raise wave detection (called from hand tracking)
function onHandRaiseDetected(side) {
  const emoji = side === 'left' ? '👋' : '👋';
  showAvatarExpression(emoji, 2000);
}

// ─── Receive and display others' expressions ─────────────────────────────────

function initExpressionReceiver() {
  if (!posSocket) return;

  posSocket.on('expression', (data) => {
    if (data.userId === myUserId) return;
    showExpressionForUser(data.userId, data.expression);
  });
}

function showExpressionForUser(userId, emoji) {
  const cam = document.getElementById(`camera-${userId}`);
  if (!cam) return;

  let bubble = cam.querySelector('.expression-bubble');
  if (!bubble) {
    bubble = document.createElement('a-text');
    bubble.setAttribute('class', 'expression-bubble');
    bubble.setAttribute('value', emoji);
    bubble.setAttribute('position', '0 0.8 0');
    bubble.setAttribute('scale', '0.8 0.8 0.8');
    bubble.setAttribute('align', 'center');
    cam.appendChild(bubble);
  }
  bubble.setAttribute('value', emoji);

  setTimeout(() => {
    if (bubble) bubble.setAttribute('value', '');
  }, 3000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initAvatarExpressions() {
  // Start face detection (desktop browsers with camera)
  loadFaceAPI();

  // Init receiver for others' expressions
  initExpressionReceiver();
}

window.initAvatarExpressions = initAvatarExpressions;
window.showAvatarExpression = showAvatarExpression;
window.onHandRaiseDetected = onHandRaiseDetected;
