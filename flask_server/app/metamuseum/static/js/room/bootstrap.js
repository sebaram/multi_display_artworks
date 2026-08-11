import { AVATAR_CATALOG } from './avatar-catalog.js';
import { createAvatarEntity } from './avatar-renderer.js';
import { mountProfilePanel } from './profile-panel.js';
import { loadProfile, saveProfile } from './profile-store.js';

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

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const controller = bootstrapRoomProfile({
    bootstrapData: readRoomBootstrap(document),
    document,
    storage: window.localStorage,
  });
  window.roomProfileController = controller;
  window.dispatchEvent(new CustomEvent('room-profile-ready', { detail: controller }));
}
