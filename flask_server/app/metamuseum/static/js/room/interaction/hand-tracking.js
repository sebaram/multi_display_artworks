function jointData(hand, name) {
  const joint = hand.get(name);
  if (!joint?.position) return null;
  return {
    position: [joint.position.x, joint.position.y, joint.position.z],
    rotation: joint.rotation
      ? [joint.rotation.x, joint.rotation.y, joint.rotation.z]
      : null,
  };
}

function collectHands(sources) {
  let leftHand = null;
  let rightHand = null;

  for (const source of sources) {
    if (!source.hand || source.handedness === 'none') continue;
    const data = {
      wrist: jointData(source.hand, 'wrist'),
      thumbTip: jointData(source.hand, 'thumb-tip'),
      indexTip: jointData(source.hand, 'index-tip'),
      middleTip: jointData(source.hand, 'middle-tip'),
    };
    if (source.handedness === 'left') leftHand = data;
    if (source.handedness === 'right') rightHand = data;
  }
  return { leftHand, rightHand };
}

export function mountHandTracking({
  document,
  navigator,
  socketClient,
  roomId,
  setInterval,
  clearInterval,
  requestAnimationFrame,
  now,
  console,
}) {
  let enabled = false;
  let session = null;
  let button = null;
  let lastHandSend = 0;

  function publish(leftHand = null, rightHand = null) {
    const camera = document.getElementById('camera');
    if (!camera) return;
    socketClient.emit('position_update', {
      room_id: roomId,
      position: camera.getAttribute('position'),
      rotation: camera.getAttribute('rotation'),
      leftHand,
      rightHand,
      handTracking: enabled,
    });
  }

  function trackHands(sources) {
    if (!enabled || !session) return;
    const currentTime = now();
    if (currentTime - lastHandSend >= 100) {
      lastHandSend = currentTime;
      const hands = collectHands(sources);
      publish(hands.leftHand, hands.rightHand);
    }
    requestAnimationFrame(() => trackHands(sources));
  }

  async function enable() {
    if (!navigator.xr) return false;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['hand-tracking', 'local-floor'],
      });
      session.addEventListener('end', () => {
        enabled = false;
        if (button) button.style.background = '#666';
      });
      const sources = typeof session.requestHandSources === 'function'
        ? await session.requestHandSources()
        : Array.from(session.inputSources ?? []);
      enabled = true;
      if (button) button.style.background = '#4CAF50';
      trackHands(sources);
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
    if (!enabled) publish();
  }, 100);
  void addButtonWhenSupported();

  return {
    destroy() {
      enabled = false;
      clearInterval(positionTimer);
      button?.remove();
    },
  };
}
