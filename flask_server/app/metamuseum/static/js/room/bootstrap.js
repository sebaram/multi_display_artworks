import { AVATAR_CATALOG } from './avatar-catalog.js';
import { createAvatarEntity } from './avatar-renderer.js';
import { mountProfilePanel } from './profile-panel.js';
import { normalizeProfile } from './profile-store.js';
import {
  createTabMarker,
  openVisitorSession,
  replaceVisitorSession,
  updateVisitorSession,
} from './visitor-session.js';
import { mountMinimap } from './minimap.js';
import { mountMobileGuidance } from './mobile-guidance.js';
import { createRoomState } from './core/room-state.js';
import { createSocketClient } from './core/socket-client.js';
import { createPoseBuffer } from './core/pose-buffer.js';
import { createPosePublisher } from './core/pose-publisher.js';
import { createSceneRenderer } from './rendering/scene.js';
import { createRenderLoop } from './rendering/render-loop.js';
import { mountTeleportControls } from './interaction/teleport.js';
import { mountAdminTransforms } from './interaction/admin-transforms.js';
import { mountHandTracking } from './interaction/hand-tracking.js';
import { mountShare } from './ui/share.js';
import { registerDragComponent } from '../drag-component.js';
import { registerLocationComponents } from '../location-features.js';
import { addLLMEffectsButton, addLLMLayoutButton } from '../llm-layout.js';
import { RoomEffects } from '../room-effects.js';
import { createAvatarExpressions } from '../avatar-expression.js';
import { initVoiceChat, VoiceChat } from '../voice-chat.js';
import { bootstrapARMode } from '../marker-ar.js';
import { bootstrapARReceiverMode } from '../ar-receiver.js';

const FORWARDED_SOCKET_EVENTS = [
  'expression',
  'voice_admin_toggle',
  'voice.offer',
  'voice.answer',
  'voice.ice',
  'voice.join',
  'voice.leave',
  'voice.displaced',
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

export function readRoomBootstrap(document) {
  return JSON.parse(document.getElementById('room-bootstrap').textContent);
}

export function bootstrapRoomProfile({
  bootstrapData,
  visitorSession,
  document,
  persistVisitorSession = () => {},
  onNewVisitor = () => {},
}) {
  const { roomId } = bootstrapData;
  const catalog = allowedCatalog(bootstrapData.avatarCatalog);
  let currentSession = {
    ...visitorSession,
    profile: normalizeProfile(visitorSession.profile),
  };
  let currentProfile = currentSession.profile;
  let socketClient = null;

  const panel = mountProfilePanel({
    profile: currentProfile,
    catalog,
    document,
    onSave(draft) {
      currentProfile = normalizeProfile(draft);
      currentSession = { ...currentSession, profile: currentProfile };
      persistVisitorSession(currentSession);
      socketClient?.emit('profile_update', {
        room_id: roomId,
        profile: currentProfile,
      });
      return currentProfile;
    },
    onNewVisitor,
  });

  return {
    visitorId: visitorSession.visitorId,
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
    clearConnectionError: panel.clearConnectionError,
    showConnectionError: panel.showConnectionError,
    updateProfile: panel.updateProfile,
    destroy: panel.destroy,
  };
}

export function bootstrapRoomRealtime({
  bootstrapData,
  visitorSession,
  ioFactory,
  profileController,
  socketUrl,
  consumers = {},
}) {
  const { roomId } = bootstrapData;
  const { visitorId, capability } = visitorSession;
  const state = createRoomState(visitorId);
  const poseBuffer = createPoseBuffer();
  const syncRoster = () => consumers.syncRoster?.(
    state.users().filter((user) => user.position != null && user.rotation != null),
  );
  let socketClient;

  const handlers = {
    connect() {
      profileController.clearConnectionError?.();
      socketClient.emit('join_position_room', profileController.joinPayload());
    },
    connect_error() {
      profileController.showConnectionError?.();
    },
    disconnect() {},
    room_state(data) {
      state.applyRoomState(data?.users);
      syncRoster();
      socketClient.emit('voice.get_state', { room_id: roomId });
    },
    user_joined(data) {
      state.applyJoin(data);
    },
    user_left(data) {
      state.applyLeave(data);
      if (data?.userId) poseBuffer.forget(data.userId);
      syncRoster();
      consumers.handleSocketEvent?.('user_left', data);
    },
    position_update(data) {
      state.applyUpdate(data);
      if (poseBuffer.record(data?.userId, data, Date.now())) syncRoster();
    },
    profile_updated(data) {
      state.applyUpdate(data);
      syncRoster();
    },
  };

  FORWARDED_SOCKET_EVENTS.forEach((eventName) => {
    handlers[eventName] = (data) => consumers.handleSocketEvent?.(eventName, data);
  });

  socketClient = createSocketClient(ioFactory, handlers);
  profileController.setSocketClient(socketClient);
  consumers.initialize?.(socketClient);
  socketClient.connect(socketUrl, {
    auth: { visitorCapability: capability },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  return {
    socketClient,
    state,
    poseBuffer,
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
    syncRoster: sceneRenderer.syncRoster,
    handleSocketEvent(eventName, data) {
      effects?.handleSocketEvent(eventName, data);
      if (eventName === 'expression') expressions?.handleSocketEvent(data);
      voice?.handleSocketEvent?.(eventName, data);
    },
  };
}

export async function bootstrapRoomApplication({
  resolveVisitorSession,
  replaceVisitorSession,
  initializeRoom,
  releaseVisitorSession = () => {},
  reload,
}) {
  const visitorSession = await resolveVisitorSession();
  let room;

  async function newVisitor() {
    const replacement = await replaceVisitorSession();
    room.realtime.destroy();
    reload();
    return replacement;
  }

  try {
    room = initializeRoom({ visitorSession, newVisitor });
  } catch (error) {
    releaseVisitorSession();
    throw error;
  }
  return { visitorSession, ...room };
}

export async function bootstrapRoomWithRecovery({ document, startRoom }) {
  let errorPanel = null;

  async function attempt() {
    errorPanel?.remove();
    errorPanel = null;
    try {
      return await startRoom();
    } catch {
      errorPanel = document.createElement('section');
      errorPanel.setAttribute('role', 'alert');
      errorPanel.setAttribute(
        'style',
        'position:fixed;top:12px;left:12px;z-index:10000;padding:12px;'
        + 'border-radius:8px;background:#351313;color:white;font-family:sans-serif;'
        + 'pointer-events:auto;',
      );
      const message = document.createElement('p');
      message.textContent = 'Unable to start the visitor session. Check your connection and retry.';
      const retryButton = document.createElement('button');
      retryButton.setAttribute('type', 'button');
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => { void attempt(); });
      errorPanel.append(message, retryButton);
      (document.getElementById?.('room-toolbar') ?? document.body).appendChild(errorPanel);
      return null;
    }
  }

  return attempt();
}

function initializeBrowserRoom({ window, document, bootstrapData, visitorSession, newVisitor }) {
  const controller = bootstrapRoomProfile({
    bootstrapData,
    visitorSession,
    document,
    persistVisitorSession(nextSession) {
      updateVisitorSession({ storage: window.sessionStorage, visitorSession: nextSession });
    },
    onNewVisitor: newVisitor,
  });
  const roomControls = mountRoomControls({ bootstrapData, document, window });

  const sceneRenderer = createSceneRenderer({
    document,
    scene: document.querySelector('a-scene'),
    selfId: visitorSession.visitorId,
    createAvatarEntity: controller.createAvatarEntity,
  });
  const expressions = createAvatarExpressions({
    document,
    navigator: window.navigator,
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    now: Date.now,
    console: window.console,
  });
  const consumers = createRoomConsumers({
    sceneRenderer,
    roomId: bootstrapData.roomId,
    visitorId: visitorSession.visitorId,
    isAdmin: bootstrapData.isAdmin,
    effects: RoomEffects,
    expressions,
    initializeVoice: initVoiceChat,
    voice: VoiceChat,
  });
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const realtime = bootstrapRoomRealtime({
    bootstrapData,
    visitorSession,
    ioFactory: window.io,
    profileController: controller,
    socketUrl: `${proto}//${window.location.host}`,
    consumers,
  });
  const renderLoop = createRenderLoop({
    poseBuffer: realtime.poseBuffer,
    applyPoses: sceneRenderer.applyPoses,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    now: Date.now,
  });
  renderLoop.start();

  const roomFeatures = [
    sceneRenderer,
    expressions,
    renderLoop,
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
      console: window.console,
      onHandRaiseDetected: expressions.onHandRaiseDetected,
      now: Date.now,
      posePublisher: createPosePublisher(),
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
    addLLMLayoutButton(bootstrapData.roomId);
    addLLMEffectsButton(bootstrapData.roomId);
  }

  if (bootstrapData.isArMarker) bootstrapARMode(bootstrapData.roomId, null);
  if (bootstrapData.isArCompanion) bootstrapARReceiverMode(bootstrapData.roomId, window.io);

  window.addEventListener('beforeunload', () => {
    roomFeatures.forEach((feature) => feature.destroy?.());
    roomControls.destroy();
    controller.destroy();
    realtime.destroy();
  }, { once: true });

  return {
    controller,
    realtime,
    destroy() {
      roomFeatures.forEach((feature) => feature.destroy?.());
      roomControls.destroy();
      controller.destroy();
      realtime.destroy();
    },
  };
}

async function bootstrapBrowserRoom({ window, document }) {
  registerDragComponent(window.AFRAME);
  registerLocationComponents(window.AFRAME);
  const bootstrapData = readRoomBootstrap(document);
  const visitorDependencies = {
    storage: window.sessionStorage,
    fetch: window.fetch.bind(window),
    location: window.location,
    history: window.history,
    avatarIds: bootstrapData.avatarCatalog,
    visitorCapabilityUrl: bootstrapData.visitorCapabilityUrl,
  };

  const ownedVisitorSession = await openVisitorSession({
    ...visitorDependencies,
    tab: window,
    createMarker: () => createTabMarker({ crypto: window.crypto }),
    createProbeId: () => createTabMarker({ crypto: window.crypto }),
    createBroadcastChannel: typeof window.BroadcastChannel === 'function'
      ? (name) => new window.BroadcastChannel(name)
      : undefined,
    scheduleTimeout: window.setTimeout.bind(window),
    clearScheduledTimeout: window.clearTimeout.bind(window),
  });
  const { visitorSession, release } = ownedVisitorSession;
  const activeVisitorDependencies = {
    ...visitorDependencies,
    tabMarker: visitorSession.tabMarker,
  };

  return bootstrapRoomApplication({
    resolveVisitorSession: async () => visitorSession,
    replaceVisitorSession: () => replaceVisitorSession(activeVisitorDependencies),
    releaseVisitorSession: release,
    initializeRoom: ({ visitorSession: resolvedSession, newVisitor }) => {
      const room = initializeBrowserRoom({
        window,
        document,
        bootstrapData,
        visitorSession: resolvedSession,
        newVisitor,
      });
      window.addEventListener('beforeunload', release, { once: true });
      return room;
    },
    reload: () => window.location.reload(),
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void bootstrapRoomWithRecovery({
    document,
    startRoom: () => bootstrapBrowserRoom({ window, document }),
  });
}
