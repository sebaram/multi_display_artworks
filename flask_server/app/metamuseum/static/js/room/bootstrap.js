import { AVATAR_CATALOG } from './avatar-catalog.js';
import { createAvatarEntity } from './avatar-renderer.js';
import { mountProfilePanel } from './profile-panel.js';
import { loadProfile, saveProfile } from './profile-store.js';
import { mountMinimap } from './minimap.js';
import { mountMobileGuidance } from './mobile-guidance.js';
import { createRoomState } from './core/room-state.js';
import { createSocketClient } from './core/socket-client.js';
import { createSceneRenderer } from './rendering/scene.js';
import { mountTeleportControls } from './interaction/teleport.js';
import { mountAdminTransforms } from './interaction/admin-transforms.js';
import { mountHandTracking } from './interaction/hand-tracking.js';
import { mountShare } from './ui/share.js';

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

export function createRoomConsumers({
  sceneRenderer,
  roomId,
  visitorId,
  isAdmin,
  effects,
  expressions,
  initializeVoice,
  voice,
}) {
  return {
    initialize(socketClient) {
      effects?.init(roomId, socketClient);
      expressions?.init(socketClient, roomId, visitorId);
      initializeVoice?.(roomId, visitorId, isAdmin, socketClient);
    },
    renderUsers: sceneRenderer.renderUsers,
    handleSocketEvent(eventName, data) {
      effects?.handleSocketEvent(eventName, data);
      if (eventName === 'expression') expressions?.handleSocketEvent(data);
      voice?.handleSocketEvent?.(eventName, data);
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

  const sceneRenderer = createSceneRenderer({
    document,
    scene: document.querySelector('a-scene'),
    selfId: bootstrapData.visitorId,
    createAvatarEntity: controller.createAvatarEntity,
  });
  const initializeVoice = window.initVoiceChat;
  const consumers = createRoomConsumers({
    sceneRenderer,
    roomId: bootstrapData.roomId,
    visitorId: bootstrapData.visitorId,
    isAdmin: bootstrapData.isAdmin,
    effects: window.RoomEffects,
    expressions: window.AvatarExpressions,
    initializeVoice,
    voice: window.VoiceChat,
  });
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const realtime = bootstrapRoomRealtime({
    bootstrapData,
    ioFactory: window.io,
    profileController: controller,
    socketUrl: `${proto}//${window.location.host}`,
    consumers,
  });
  const roomFeatures = [
    sceneRenderer,
    mountShare({
      document,
      location: window.location,
      roomId: bootstrapData.roomId,
      navigator: window.navigator,
      qrcode: window.qrcode,
      setTimeout: window.setTimeout.bind(window),
    }),
    mountHandTracking({
      document,
      navigator: window.navigator,
      socketClient: realtime.socketClient,
      roomId: bootstrapData.roomId,
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      now: Date.now,
      console: window.console,
    }),
  ];

  if (bootstrapData.roomControlsEnabled) {
    roomFeatures.push(mountTeleportControls({
      presets: bootstrapData.presets,
      boundary: bootstrapData.boundary,
      roomId: bootstrapData.roomId,
      isAdmin: bootstrapData.isAdmin,
      camera: document.getElementById('camera'),
      document,
      fetch: window.fetch.bind(window),
      prompt: window.prompt.bind(window),
      alert: window.alert.bind(window),
      reload: () => window.location.reload(),
    }));
  }

  if (bootstrapData.isAdmin) {
    roomFeatures.push(mountAdminTransforms({
      document,
      navigator: window.navigator,
      fetch: window.fetch.bind(window),
      alert: window.alert.bind(window),
      setTimeout: window.setTimeout.bind(window),
    }));
    window.addLLMLayoutButton?.();
    window.addLLMEffectsButton?.();
  }

  if (bootstrapData.isArMarker) window.bootstrapARMode?.(bootstrapData.roomId, null);
  if (bootstrapData.isArCompanion) window.bootstrapARReceiverMode?.(bootstrapData.roomId);

  window.addEventListener('beforeunload', () => {
    roomFeatures.forEach((feature) => feature.destroy?.());
    window.roomControls.destroy();
    controller.destroy();
    realtime.destroy();
  }, { once: true });
}
