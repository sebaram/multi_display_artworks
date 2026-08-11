import { AVATAR_CATALOG } from './avatar-catalog.js';
import { createAvatarEntity } from './avatar-renderer.js';
import { mountProfilePanel } from './profile-panel.js';
import { loadProfile, saveProfile } from './profile-store.js';
import { mountMinimap } from './minimap.js';
import { mountMobileGuidance } from './mobile-guidance.js';
import { createRoomState } from './core/room-state.js';
import { createSocketClient } from './core/socket-client.js';

const FORWARDED_SOCKET_EVENTS = [
  'expression',
  'voice_admin_toggle',
  'voice.offer',
  'voice.answer',
  'voice.ice',
  'voice.join',
  'voice.leave',
  'voice.mute',
  'voice.transcript',
  'room_effects',
  'room_effects_cleared',
];

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
  let socketClient = null;

  const panel = mountProfilePanel({
    profile: currentProfile,
    catalog,
    document,
    onSave(draft) {
      currentProfile = saveProfile(storage, visitorId, draft);
      socketClient?.emit('profile_update', {
        room_id: roomId,
        profile: currentProfile,
      });
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
    setSocketClient(nextSocketClient) {
      socketClient = nextSocketClient;
    },
    createAvatarEntity(profile) {
      return createAvatarEntity(profile, document);
    },
    openProfile: panel.open,
    destroy: panel.destroy,
  };
}

export function bootstrapRoomRealtime({
  bootstrapData,
  ioFactory,
  profileController,
  socketUrl,
  consumers = {},
}) {
  const { visitorId, roomId } = bootstrapData;
  const state = createRoomState(visitorId);
  const renderUsers = () => consumers.renderUsers?.(
    state.users().filter((user) => user.position != null && user.rotation != null),
  );
  let socketClient;

  const handlers = {
    connect() {
      socketClient.emit('join_position_room', profileController.joinPayload());
      socketClient.emit('voice.get_state', { room_id: roomId });
    },
    disconnect() {},
    room_state(data) {
      state.applyRoomState(data?.users);
      renderUsers();
    },
    user_joined(data) {
      state.applyJoin(data);
    },
    user_left(data) {
      state.applyLeave(data);
      renderUsers();
      consumers.handleSocketEvent?.('user_left', data);
    },
    position_update(data) {
      state.applyUpdate(data);
      renderUsers();
    },
    profile_updated(data) {
      state.applyUpdate(data);
      renderUsers();
    },
  };

  FORWARDED_SOCKET_EVENTS.forEach((eventName) => {
    handlers[eventName] = (data) => consumers.handleSocketEvent?.(eventName, data);
  });

  socketClient = createSocketClient(ioFactory, handlers);
  profileController.setSocketClient(socketClient);
  consumers.initialize?.(socketClient);
  socketClient.connect(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  return {
    socketClient,
    state,
    destroy: socketClient.destroy,
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

  // Temporary bridge for the inline scene code. Task 4 moves these callbacks
  // into modules; until then the socket and state still remain module-owned.
  const consumers = window.roomLegacySocketAdapter ?? {};
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const realtime = bootstrapRoomRealtime({
    bootstrapData,
    ioFactory: window.io,
    profileController: controller,
    socketUrl: `${proto}//${window.location.host}`,
    consumers,
  });
  window.addEventListener('beforeunload', realtime.destroy, { once: true });
}
