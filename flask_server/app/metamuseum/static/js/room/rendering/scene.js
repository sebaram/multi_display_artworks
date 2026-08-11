function removeElement(element) {
  if (!element) return;
  if (typeof element.remove === 'function') {
    element.remove();
  } else {
    element.parentNode?.removeChild(element);
  }
}

function point(position) {
  return Array.isArray(position) ? position.join(' ') : position;
}

function createHandEntity(document, handData, side) {
  if (!handData) return null;

  const hand = document.createElement('a-entity');
  hand.setAttribute('class', `hand-${side}`);

  const palm = document.createElement('a-box');
  palm.setAttribute('color', '#00ff88');
  palm.setAttribute('width', '0.08');
  palm.setAttribute('height', '0.1');
  palm.setAttribute('depth', '0.02');
  if (handData.wrist?.position) palm.setAttribute('position', point(handData.wrist.position));
  hand.appendChild(palm);

  ['thumbTip', 'indexTip', 'middleTip'].forEach((jointName) => {
    const joint = handData[jointName];
    if (!joint?.position) return;
    const finger = document.createElement('a-sphere');
    finger.setAttribute('color', '#00ff88');
    finger.setAttribute('radius', '0.02');
    finger.setAttribute('position', point(joint.position));
    hand.appendChild(finger);
  });

  return hand;
}

function updateProfile(camera, user, createAvatarEntity) {
  const avatarId = user.avatarId || 'shiba';
  const color = user.color || '#4CAF50';
  const profileKey = `${avatarId}:${color}`;

  if (camera.getAttribute('data-profile-key') !== profileKey) {
    removeElement(camera.querySelector('.remote-avatar'));
    const avatar = createAvatarEntity({ avatarId, color });
    if (avatar) camera.appendChild(avatar);
    camera.setAttribute('data-profile-key', profileKey);
  }

  const nameTag = camera.querySelector('.display-name');
  if (nameTag) {
    nameTag.setAttribute('value', user.displayName || user.userId);
    nameTag.setAttribute('color', color);
  }
}

function updateHands(document, camera, user) {
  const enabled = user.handTracking === true || user.handTracking?.enabled === true;

  ['left', 'right'].forEach((side) => {
    const id = `hand-${side}-${user.userId}`;
    removeElement(document.getElementById(id));
    const handData = enabled ? user[side === 'left' ? 'leftHand' : 'rightHand'] : null;
    const hand = createHandEntity(document, handData, side);
    if (!hand) return;
    hand.setAttribute('id', id);
    camera.appendChild(hand);
  });
}

function createRemoteCamera(document, scene, user) {
  const camera = document.createElement('a-entity');
  camera.setAttribute('id', `camera-${user.userId}`);

  const nameTag = document.createElement('a-text');
  nameTag.setAttribute('class', 'display-name');
  nameTag.setAttribute('position', '0 0 0');
  nameTag.setAttribute('scale', '1 1 1');
  nameTag.setAttribute('rotation', '0 180 0');
  nameTag.setAttribute('align', 'center');
  camera.appendChild(nameTag);
  scene.appendChild(camera);
  return camera;
}

export function createSceneRenderer({ document, scene, selfId, createAvatarEntity }) {
  const renderedIds = new Set();

  function renderUsers(users = []) {
    const activeIds = new Set();

    users.forEach((user) => {
      if (!user?.userId || user.userId === selfId) return;
      const cameraId = `camera-${user.userId}`;
      activeIds.add(cameraId);

      const camera = document.getElementById(cameraId) ?? createRemoteCamera(document, scene, user);
      renderedIds.add(cameraId);
      updateProfile(camera, user, createAvatarEntity);
      camera.setAttribute('position', user.position);
      camera.setAttribute('rotation', user.rotation);
      updateHands(document, camera, user);
    });

    for (const cameraId of renderedIds) {
      if (activeIds.has(cameraId)) continue;
      removeElement(document.getElementById(cameraId));
      renderedIds.delete(cameraId);
    }
  }

  return {
    renderUsers,
    destroy() {
      renderUsers([]);
    },
  };
}
