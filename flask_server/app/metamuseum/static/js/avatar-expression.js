/* Avatar Expressions — face + gesture → emoji indicator above avatar. */

const FACE_API_MODELS_BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

function renderBubble({ document, target, emoji, duration, position, setTimeout }) {
  let bubble = target.querySelector('.expression-bubble');
  if (!bubble) {
    bubble = document.createElement('a-text');
    bubble.setAttribute('class', 'expression-bubble');
    bubble.setAttribute('position', position);
    bubble.setAttribute('scale', '0.8 0.8 0.8');
    bubble.setAttribute('align', 'center');
    target.appendChild(bubble);
  }
  bubble.setAttribute('value', emoji);
  setTimeout(() => bubble.setAttribute('value', ''), duration);
}

export function createAvatarExpressions({
  document,
  navigator,
  setInterval,
  clearInterval,
  setTimeout,
  now,
  console,
  getFaceApi = () => globalThis.faceapi,
}) {
  let faceApiLoaded = false;
  let faceApiModelsLoaded = false;
  let expressionInterval = null;
  let lastSmileTime = 0;
  let socketClient = null;
  let roomId = null;
  let userId = null;

  async function startExpressionDetection() {
    if (!faceApiModelsLoaded || navigator.maxTouchPoints === 0) return;

    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0;';
    video.autoplay = true;
    video.playsinline = true;
    video.muted = true;
    document.body.appendChild(video);

    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      await video.play();
    } catch (error) {
      console.warn('[FaceAPI] Camera access denied:', error.message);
      return;
    }

    expressionInterval = setInterval(async () => {
      if (!faceApiModelsLoaded || video.readyState < 2) return;
      try {
        const faceapi = getFaceApi();
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceExpressions();
        const isSmiling = detections.some((detection) => detection.expressions?.happy > 0.5);
        const currentTime = now();
        if (isSmiling && currentTime - lastSmileTime > 3000) {
          lastSmileTime = currentTime;
          showLocalExpression('😊');
        }
      } catch {
        // A transient detection error should not stop later samples.
      }
    }, 1000);
  }

  function loadFaceAPI() {
    if (faceApiLoaded) return;
    faceApiLoaded = true;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
    script.onload = async () => {
      try {
        const faceapi = getFaceApi();
        await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODELS_BASE);
        await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODELS_BASE);
        faceApiModelsLoaded = true;
        await startExpressionDetection();
      } catch (error) {
        console.warn('[FaceAPI] Model load failed, expressions disabled:', error);
      }
    };
    script.onerror = () => console.warn('[FaceAPI] Script load failed, expressions disabled');
    document.head.appendChild(script);
  }

  function showLocalExpression(emoji, duration = 3000) {
    socketClient?.emit('expression', {
      room_id: roomId,
      userId,
      expression: emoji,
    });

    const remoteStyleTarget = document.getElementById(`camera-${userId}`);
    const target = remoteStyleTarget ?? document.getElementById('camera');
    if (!target) return;
    renderBubble({
      document,
      target,
      emoji,
      duration,
      position: remoteStyleTarget ? '0 0.8 0' : '0 0.8 -1.5',
      setTimeout,
    });
  }

  function onHandRaiseDetected() {
    showLocalExpression('👋', 2000);
  }

  function showExpressionForUser(remoteUserId, emoji) {
    const target = document.getElementById(`camera-${remoteUserId}`);
    if (!target) return;
    renderBubble({
      document,
      target,
      emoji,
      duration: 3000,
      position: '0 0.8 0',
      setTimeout,
    });
  }

  function handleSocketEvent(data) {
    if (data.userId === userId) return;
    showExpressionForUser(data.userId, data.expression);
  }

  function init(nextSocketClient, nextRoomId, nextUserId) {
    socketClient = nextSocketClient;
    roomId = nextRoomId;
    userId = nextUserId;
    loadFaceAPI();
  }

  return {
    init,
    showLocalExpression,
    onHandRaiseDetected,
    handleSocketEvent,
    destroy() {
      if (expressionInterval !== null) clearInterval(expressionInterval);
    },
  };
}
