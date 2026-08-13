import { MIN_SEND_INTERVAL_MS } from '../core/sync-constants.js';

function jointPose(frame, referenceSpace, hand, name) {
  const jointSpace = hand.get(name);
  if (!jointSpace || typeof frame?.getJointPose !== 'function' || !referenceSpace) return null;
  const pose = frame.getJointPose(jointSpace, referenceSpace);
  const position = pose?.transform?.position;
  if (!position) return null;
  const orientation = pose.transform.orientation;
  return {
    position: [position.x, position.y, position.z],
    rotation: orientation
      ? [orientation.x, orientation.y, orientation.z, orientation.w]
      : null,
  };
}

export function collectHandPoses(frame, referenceSpace, sources) {
  let leftHand = null;
  let rightHand = null;

  for (const source of sources) {
    if (!source.hand || source.handedness === 'none') continue;
    const data = {
      wrist: jointPose(frame, referenceSpace, source.hand, 'wrist'),
      thumbTip: jointPose(frame, referenceSpace, source.hand, 'thumb-tip'),
      indexTip: jointPose(frame, referenceSpace, source.hand, 'index-tip'),
      middleTip: jointPose(frame, referenceSpace, source.hand, 'middle-tip'),
    };
    if (!Object.values(data).some(Boolean)) continue;
    if (source.handedness === 'left') leftHand = data;
    if (source.handedness === 'right') rightHand = data;
  }
  return { leftHand, rightHand };
}

async function requestTrackingSpace(session) {
  for (const type of ['local-floor', 'local']) {
    try {
      return await session.requestReferenceSpace(type);
    } catch {
      // Try the less capable local space before giving up.
    }
  }
  return null;
}

export function mountHandTracking({
  document,
  navigator,
  socketClient,
  roomId,
  setInterval,
  clearInterval,
  console,
  onHandRaiseDetected,
  posePublisher,
  now,
}) {
  let enabled = false;
  let session = null;
  let referenceSpace = null;
  let button = null;
  let lastHandSend = 0;
  let handsPresent = false;
  const raised = { left: false, right: false };

  function publish(leftHand = null, rightHand = null, handTracking = enabled) {
    const camera = document.getElementById('camera');
    if (!camera) return;
    const position = camera.getAttribute('position');
    const rotation = camera.getAttribute('rotation');
    const hasHands = leftHand !== null || rightHand !== null;
    // A frame that CHANGES the hand state — hands appearing or hands disappearing —
    // bypasses the pose publisher in both directions, so "my hands are gone" is
    // never withheld behind the heartbeat/epsilon gate. Only a frame that repeats
    // the current (no-hands) state goes through the publisher's ordinary gating.
    const handStateChanged = hasHands !== handsPresent;
    handsPresent = hasHands;
    if (!hasHands && !handStateChanged && !posePublisher.shouldSend({ position, rotation }, now())) return;

    const sent = socketClient.emit('position_update', {
      room_id: roomId,
      position,
      rotation,
      leftHand,
      rightHand,
      handTracking,
    });
    // The publisher commits sentAt/sentPosition/sentRotation optimistically before
    // the send happens. If the socket was actually disconnected, undo that so the
    // next real attempt isn't suppressed against a packet that never left.
    if (sent === false) posePublisher.reset();
  }

  function detectRaisedHands(frame, hands) {
    const viewerY = frame.getViewerPose?.(referenceSpace)?.transform?.position?.y;
    if (!Number.isFinite(viewerY)) return;
    for (const side of ['left', 'right']) {
      const wristY = hands[`${side}Hand`]?.wrist?.position?.[1];
      const isRaised = Number.isFinite(wristY) && wristY > viewerY + 0.15;
      if (isRaised && !raised[side]) onHandRaiseDetected?.(side);
      raised[side] = isRaised;
    }
  }

  function trackHands(time, frame) {
    if (!enabled || !session) return;
    if (time - lastHandSend >= 100) {
      lastHandSend = time;
      const hands = collectHandPoses(frame, referenceSpace, session.inputSources ?? []);
      if (hands.leftHand || hands.rightHand) {
        publish(hands.leftHand, hands.rightHand, true);
        detectRaisedHands(frame, hands);
      } else {
        raised.left = false;
        raised.right = false;
        publish(null, null, false);
      }
    }
    session.requestAnimationFrame(trackHands);
  }

  async function enable() {
    if (!navigator.xr) return false;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['hand-tracking', 'local-floor'],
      });
      referenceSpace = await requestTrackingSpace(session);
      if (!referenceSpace || typeof session.requestAnimationFrame !== 'function') {
        await session.end?.();
        session = null;
        return false;
      }
      session.addEventListener('end', () => {
        enabled = false;
        session = null;
        referenceSpace = null;
        if (button) button.style.background = '#666';
      });
      enabled = true;
      if (button) button.style.background = '#4CAF50';
      session.requestAnimationFrame(trackHands);
      return true;
    } catch (error) {
      console.error('Hand tracking error:', error);
      return false;
    }
  }

  async function addButtonWhenSupported() {
    if (!navigator.xr) return;
    try {
      if (!await navigator.xr.isSessionSupported('immersive-vr')) return;
    } catch {
      return;
    }
    button = document.createElement('button');
    button.id = 'hand-tracking-btn';
    button.textContent = '🤚 Hand Tracking';
    button.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 20px;background:#666;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;z-index:9999;';
    button.addEventListener('click', enable);
    document.body.appendChild(button);
  }

  const positionTimer = setInterval(() => {
    if (!enabled) publish(null, null, false);
  }, MIN_SEND_INTERVAL_MS);
  void addButtonWhenSupported();

  return {
    destroy() {
      enabled = false;
      clearInterval(positionTimer);
      button?.remove();
    },
  };
}
