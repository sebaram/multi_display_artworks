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

export function createAvatarEntity(profile, document) {
  const normalized = normalizeProfile(profile);
  const avatar = AVATAR_CATALOG[normalized.avatarId];

  if (avatar.kind === 'none') return null;
  if (avatar.kind === 'primitive') return createRobot(normalized.color, document);
  return createGltfAvatar(normalized.avatarId, normalized.color, document);
}
