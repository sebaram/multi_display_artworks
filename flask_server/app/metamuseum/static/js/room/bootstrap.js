import { AVATAR_CATALOG } from './avatar-catalog.js';
import { createAvatarEntity } from './avatar-renderer.js';
import { mountProfilePanel } from './profile-panel.js';
import { loadProfile, saveProfile } from './profile-store.js';
import { mountMinimap } from './minimap.js';
import { mountMobileGuidance } from './mobile-guidance.js';

function allowedCatalog(avatarIds) {
  return Object.fromEntries(
    avatarIds
      .filter((avatarId) => Object.hasOwn(AVATAR_CATALOG, avatarId))
      .map((avatarId) => [avatarId, AVATAR_CATALOG[avatarId]]),
  );
}

function hasStoredProfile(storage, visitorId) {
  try {
    return storage.getItem(`metamuseum.profile.${visitorId}`) !== null;
  } catch {
    return false;
  }
}

export function readRoomBootstrap(document) {
  return JSON.parse(document.getElementById('room-bootstrap').textContent);
}

export function bootstrapRoomProfile({ bootstrapData, document, storage }) {
  const { visitorId, roomId } = bootstrapData;
  const catalog = allowedCatalog(bootstrapData.avatarCatalog);
  const isFirstEntry = !hasStoredProfile(storage, visitorId);
  let currentProfile = loadProfile(storage, visitorId);
  let socket = null;

  const panel = mountProfilePanel({
    profile: currentProfile,
    catalog,
    document,
    onSave(draft) {
      currentProfile = saveProfile(storage, visitorId, draft);
      if (socket?.connected) {
        socket.emit('profile_update', {
          room_id: roomId,
          profile: currentProfile,
        });
      }
      return currentProfile;
    },
  });

  if (isFirstEntry) panel.open();

  return {
    visitorId,
    roomId,
    get profile() {
      return { ...currentProfile };
    },
    joinPayload() {
      return {
        room_id: roomId,
        profile: { ...currentProfile },
      };
    },
    setSocket(nextSocket) {
      socket = nextSocket;
    },
    createAvatarEntity(profile) {
      return createAvatarEntity(profile, document);
    },
    openProfile: panel.open,
    destroy: panel.destroy,
  };
}

export function mountRoomControls({ bootstrapData, document, window }) {
  if (!bootstrapData.roomControlsEnabled) return { destroy() {} };

  const minimap = bootstrapData.boundary == null ? null : mountMinimap({
    presets: bootstrapData.presets,
    boundary: bootstrapData.boundary,
    wallList: bootstrapData.wallList,
    getCamera: () => document.getElementById('camera'),
    document,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  const mobileGuidance = mountMobileGuidance({
    document,
    matchMedia: window.matchMedia.bind(window),
  });

  return {
    minimap,
    mobileGuidance,
    destroy() {
      minimap?.destroy();
      mobileGuidance.destroy();
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const bootstrapData = readRoomBootstrap(document);
  const controller = bootstrapRoomProfile({
    bootstrapData,
    document,
    storage: window.localStorage,
  });
  window.roomControls = mountRoomControls({ bootstrapData, document, window });
  window.roomProfileController = controller;
  window.dispatchEvent(new CustomEvent('room-profile-ready', { detail: controller }));
}
