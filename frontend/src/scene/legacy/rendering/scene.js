import { AVATAR_CATALOG } from '../avatar-catalog.js';

function removeElement(element) {
  if (!element) return;
  element.disposeAvatar?.();
  element.querySelector?.('.remote-avatar')?.disposeAvatar?.();
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
  const hand = document.createElement("a-entity");
  hand.setAttribute("class", `hand-${side}`);
  hand.joints = {};
  for (const name of ["wrist", "thumbTip", "indexTip", "middleTip"]) {
    const joint = document.createElement(
      name === "wrist" ? "a-box" : "a-sphere",
    );
    joint.setAttribute("color", "#00ff88");
    if (name === "wrist") {
      joint.setAttribute("width", ".08");
      joint.setAttribute("height", ".1");
      joint.setAttribute("depth", ".02");
    } else joint.setAttribute("radius", ".02");
    hand.joints[name] = joint;
    hand.appendChild(joint);
  }
  updateHandEntity(hand, handData);
  return hand;
}
function updateHandEntity(hand, data) {
  for (const [name, node] of Object.entries(hand.joints)) {
    const joint = data[name];
    node.setAttribute("visible", !!joint?.position);
    if (joint?.position) node.setAttribute("position", point(joint.position));
    if (joint?.rotation && node.object3D?.quaternion)
      node.object3D.quaternion.fromArray(joint.rotation).normalize();
  }
}
function anchorWorldHands(camera) {
  if (!camera.object3D?.updateWorldMatrix) return;
  camera.object3D.updateWorldMatrix(true, false);
  for (const side of ["left", "right"]) {
    const object = camera.querySelector(`.hand-${side}`)?.object3D;
    if (!object) continue;
    // Raw legacy joints are already world positions; cancel their compatibility head parent.
    object.matrixAutoUpdate = false;
    object.matrix.copy(camera.object3D.matrixWorld).invert();
    object.matrixWorldNeedsUpdate = true;
  }
}

function updateProfile(camera, user, createAvatarEntity) {
  const avatarId = user.avatarId || 'shiba';
  const color = user.color || '#4CAF50';
  const profileKey = JSON.stringify([avatarId, color, user.appearance]);

  if (camera.getAttribute('data-profile-key') !== profileKey) {
    const current = camera.querySelector('.remote-avatar');
    if (current?.canApplyProfile?.(user)) {
      current.applyAppearance(user.appearance || AVATAR_CATALOG[avatarId]?.defaultAppearance);
    } else {
      removeElement(current);
      const profile = { avatarId, color, ...(user.appearance ? { appearance: user.appearance } : {}) };
      const avatar = createAvatarEntity(profile);
      if (avatar) camera.appendChild(avatar);
    }
    camera.setAttribute('data-profile-key', profileKey);
  }

  const nameTag = camera.querySelector('.display-name');
  if (nameTag) {
    camera.humanoidLabel = AVATAR_CATALOG[avatarId]?.kind === 'humanoid';
    nameTag.setAttribute('position', camera.humanoidLabel ? '0 .32 0' : '0 0 0');
    nameTag.setAttribute('width', camera.humanoidLabel ? '2.5' : '5');
    if (!camera.humanoidLabel) nameTag.object3D?.rotation?.set?.(0, Math.PI, 0);
    nameTag.setAttribute('value', user.displayName || user.userId);
    nameTag.setAttribute('color', color);
  }
}

export function handKey(user) {
  const enabled = user.handTracking === true || user.handTracking?.enabled === true;
  if (!enabled) return 'off';
  return JSON.stringify([user.leftHand ?? null, user.rightHand ?? null]);
}

function updateHands(document, camera, user) {
  const key =
    AVATAR_CATALOG[user.avatarId]?.kind === "humanoid" ? "off" : handKey(user);
  if (camera.getAttribute("data-hand-key") === key) return;
  camera.setAttribute("data-hand-key", key);

  ["left", "right"].forEach((side) => {
    const id = `hand-${side}-${user.userId}`;
    const existing = document.getElementById(id);
    const handData =
      key === "off" ? null : user[side === "left" ? "leftHand" : "rightHand"];
    if (!handData) {
      removeElement(existing);
      return;
    }
    if (existing) {
      updateHandEntity(existing, handData);
      return;
    }
    const hand = createHandEntity(document, handData, side);
    hand.setAttribute("id", id);
    camera.appendChild(hand);
  });
  anchorWorldHands(camera);
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

const DEG_TO_RAD = Math.PI / 180;

function writeTransform(camera, pose, scene) {
  camera.querySelector('.remote-avatar')?.setBodyTransform?.(pose);
  if (camera.object3D?.position?.set && camera.object3D?.rotation?.set) {
    camera.object3D.position.set(pose.position.x, pose.position.y, pose.position.z);
    // A-Frame constructs every object3D with rotation.order === 'YXZ'. THREE's
    // Euler#set preserves the existing order when no 4th argument is given, so this
    // is currently a no-op in practice — but pass it explicitly so correctness does
    // not depend on an A-Frame internal we don't control.
    camera.object3D.rotation.set(
      pose.rotation.x * DEG_TO_RAD,
      pose.rotation.y * DEG_TO_RAD,
      pose.rotation.z * DEG_TO_RAD,
      'YXZ',
    );
    if (camera.humanoidLabel && camera.object3D.quaternion?.clone) {
      const label = camera.querySelector('.display-name')?.object3D;
      const inverseHead = camera.object3D.quaternion.clone().invert();
      if (label) {
        label.position.set(0, .32, 0).applyQuaternion(inverseHead);
        if (scene.camera?.getWorldQuaternion) {
          scene.camera.getWorldQuaternion(label.quaternion);
          label.quaternion.premultiply(inverseHead);
        }
      }
    }
    anchorWorldHands(camera);
    return;
  }
  camera.setAttribute('position', pose.position);
  camera.setAttribute('rotation', pose.rotation);
}

export function createSceneRenderer({ document, scene, selfId, createAvatarEntity }) {
  const renderedIds = new Set();
  const avatars = new Map();
  // Retain ownership after React detaches the scene from document during SPA teardown.
  const cameras = new Map();
  let latestUsers = [], destroyed = false;
  if (document.defaultView?.AFRAME) {
    import('../../../avatar/catalog').then(({ loadAvatarCatalog }) => loadAvatarCatalog())
      .then(() => { if (!destroyed) { for (const id of renderedIds) document.getElementById(id)?.setAttribute('data-profile-key', ''); syncRoster(latestUsers); } })
      .catch(() => {}); // Legacy avatars remain usable when the catalog is offline.
  }

  function syncRoster(users = []) {
    latestUsers = users;
    const activeIds = new Set();

    users.forEach((user) => {
      if (!user?.userId || user.userId === selfId) return;
      const cameraId = `camera-${user.userId}`;
      activeIds.add(cameraId);

      const camera = document.getElementById(cameraId) ?? createRemoteCamera(document, scene, user);
      renderedIds.add(cameraId);
      cameras.set(cameraId, camera);
      updateProfile(camera, user, createAvatarEntity);
      avatars.set(user.userId, camera.querySelector('.remote-avatar'));
      updateHands(document, camera, user);
    });

    for (const cameraId of renderedIds) {
      if (activeIds.has(cameraId)) continue;
      removeElement(cameras.get(cameraId));
      cameras.delete(cameraId);
      renderedIds.delete(cameraId);
      avatars.delete(cameraId.slice('camera-'.length));
    }
  }

  function applyPoses(poses) {
    poses.forEach((pose, userId) => {
      if (userId === selfId || !pose) return;
      const camera = document.getElementById(`camera-${userId}`);
      if (camera) writeTransform(camera, pose, scene);
    });
  }

  return {
    syncRoster,
    avatars: () => avatars,
    applyPoses,
    applyAvatarPoses(poses) {
      poses.forEach((pose, userId) => {
        if (userId === selfId || !pose) return;
        document.getElementById(`camera-${userId}`)?.querySelector('.remote-avatar')?.applyAvatarPose?.(pose);
      });
    },
    destroy() {
      destroyed = true;
      syncRoster([]);
    },
  };
}
