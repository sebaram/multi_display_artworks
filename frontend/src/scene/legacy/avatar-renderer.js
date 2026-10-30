import { AVATAR_CATALOG } from './avatar-catalog.js';
import { normalizeProfile } from './profile-store.js';

function addPrimitive(parent, document, tagName, attributes) {
  const primitive = document.createElement(tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    primitive.setAttribute(name, value);
  });
  parent.appendChild(primitive);
}

function createRobot(color, document) {
  const wrapper = document.createElement('a-entity');
  wrapper.setAttribute('class', 'remote-avatar');
  wrapper.setAttribute('position', '0 -1 0');
  wrapper.setAttribute('rotation', '0 180 0');

  addPrimitive(wrapper, document, 'a-box', {
    color,
    width: '0.4',
    height: '0.6',
    depth: '0.2',
    position: '0 0 0',
  });
  addPrimitive(wrapper, document, 'a-sphere', {
    color,
    radius: '0.15',
    position: '0 0.45 0',
  });
  addPrimitive(wrapper, document, 'a-sphere', {
    color: '#ffffff',
    radius: '0.04',
    position: '-0.06 0.48 -0.12',
  });
  addPrimitive(wrapper, document, 'a-sphere', {
    color: '#ffffff',
    radius: '0.04',
    position: '0.06 0.48 -0.12',
  });

  [
    ['-0.3 -0.1 0', '0.1', '0.4', '0.1'],
    ['0.3 -0.1 0', '0.1', '0.4', '0.1'],
    ['-0.12 -0.5 0', '0.12', '0.4', '0.12'],
    ['0.12 -0.5 0', '0.12', '0.4', '0.12'],
  ].forEach(([position, width, height, depth]) => {
    addPrimitive(wrapper, document, 'a-box', {
      color,
      width,
      height,
      depth,
      position,
    });
  });

  return wrapper;
}

function createGltfAvatar(avatarId, color, document) {
  const avatar = document.createElement('a-entity');
  avatar.setAttribute('class', 'remote-avatar');
  avatar.setAttribute('gltf-model', AVATAR_CATALOG[avatarId].assetUrl);
  avatar.setAttribute('rotation', '0 180 0');
  avatar.setAttribute('position', '0 -1 0');
  avatar.setAttribute('scale', '0.5 0.5 0.5');

  addPrimitive(avatar, document, 'a-sphere', {
    class: 'avatar-color-accent',
    color,
    radius: '0.1',
    position: '0 1.8 0',
  });
  return avatar;
}

function createHumanoidAvatar(profile, document) {
  const wrapper = document.createElement('a-entity');
  wrapper.setAttribute('class', 'remote-avatar');
  const controller = new AbortController();
  let instance, pendingAppearance = profile.appearance, bodyPose;
  const preset = AVATAR_CATALOG[profile.appearance?.presetId || profile.avatarId];
  wrapper.canApplyProfile = next => AVATAR_CATALOG[next.appearance?.presetId || next.avatarId]?.rigVersion === preset.rigVersion;
  wrapper.applyAppearance = next => { pendingAppearance = next; if (instance) instance.applyAppearance(next || preset.defaultAppearance); };
  // The wrapper owns lifecycle under the head/name entity; the actual body is
  // attached to scene coordinates so camera pitch/roll cannot tilt the body.
  wrapper.setBodyTransform = pose => {
    bodyPose = pose;
    if (!instance) return;
    instance.root.position.set(pose.position.x, Math.max(0, pose.position.y - 1.65), pose.position.z);
    instance.root.rotation.set(0, pose.rotation.y * Math.PI / 180, 0);
  };
  wrapper.disposeAvatar = () => { controller.abort(); instance?.dispose(); };
  wrapper.avatarReady = import('../../avatar/resources').then(async ({ createAvatarInstance }) => {
    if (controller.signal.aborted) return;
    const scene = wrapper.sceneEl || document.querySelector('a-scene');
    instance = await createAvatarInstance({ scene: scene.object3D, preset, appearance: pendingAppearance, signal: controller.signal });
    wrapper.avatarInstance = instance;
    if (bodyPose) wrapper.setBodyTransform(bodyPose);
    return instance;
  }).catch(error => { if (error.name !== 'AbortError') wrapper.emit?.('avatar-error', { message: error.message }); });
  return wrapper;
}

export function createAvatarEntity(profile, document) {
  const normalized = normalizeProfile(profile);
  const candidate = profile?.appearance?.presetId || normalized.avatarId;
  const id = Object.hasOwn(AVATAR_CATALOG, candidate) ? candidate : normalized.avatarId;
  const avatar = AVATAR_CATALOG[id];

  if (avatar.kind === 'none') return null;
  if (avatar.kind === 'humanoid') return createHumanoidAvatar({ ...normalized, avatarId: id, appearance: profile.appearance?.presetId === id ? profile.appearance : undefined }, document);
  if (avatar.kind === 'primitive') return createRobot(normalized.color, document);
  return createGltfAvatar(id, normalized.color, document);
}
