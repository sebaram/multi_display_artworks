import { AVATAR_CATALOG } from "./avatar-catalog.js";
import { createAvatarEntity } from "./avatar-renderer.js";
import { mountProfilePanel } from "./profile-panel.js";
import { normalizeProfile } from "./profile-store.js";
import { mountMinimap } from "./minimap.js";
import { mountMobileGuidance } from "./mobile-guidance.js";
import { createRoomState } from "./core/room-state.js";
import { createSocketClient } from "./core/socket-client.js";
import { createPoseBuffer } from "./core/pose-buffer.js";
import { handKey } from "./rendering/scene.js";
const FORWARDED_SOCKET_EVENTS = [
  "expression",
  "voice_admin_toggle",
  "voice.offer",
  "voice.answer",
  "voice.ice",
  "voice.join",
  "voice.leave",
  "voice.displaced",
  "voice.mute",
  "voice.transcript",
  "room_effects",
  "room_effects_cleared",
  "wall.interaction_state",
  "wall.playback_state",
  "wall.design_applied",
  "wall.design_removed",
  "wall.snapshot",
];

function allowedCatalog(avatarIds) {
  return Object.fromEntries(
    avatarIds
      .filter((avatarId) => Object.hasOwn(AVATAR_CATALOG, avatarId))
      .map((avatarId) => [avatarId, AVATAR_CATALOG[avatarId]]),
  );
}

export function readRoomBootstrap(document) {
  return JSON.parse(document.getElementById("room-bootstrap").textContent);
}

export function bootstrapRoomProfile({
  bootstrapData,
  visitorSession,
  document,
  persistVisitorSession = () => {},
  onNewVisitor = () => {},
  persistAppearance,
  onCustomize,
}) {
  const { roomId } = bootstrapData;
  const catalog = allowedCatalog(bootstrapData.avatarCatalog);
  let currentSession = {
    ...visitorSession,
    profile: normalizeProfile(visitorSession.profile),
  };
  let currentProfile = currentSession.profile;
  let socketClient = null;
  let destroyed = false;

  function applyProfile(draft) {
    if (destroyed) return currentProfile;
    currentProfile = normalizeProfile(draft);
    currentSession = { ...currentSession, profile: currentProfile };
    persistVisitorSession(currentSession);
    panel.updateProfile(currentProfile);
    socketClient?.emit('profile_update', { room_id: roomId, profile: currentProfile });
    return currentProfile;
  }

  const panel = mountProfilePanel({
    profile: currentProfile,
    catalog,
    document,
    onSave(draft) {
      // Old Edit changes keep humanoid parts only when the selected preset stays the same.
      if (draft.avatarId === currentProfile.appearance?.presetId) {
        draft = { ...draft, appearance: { ...currentProfile.appearance,
          colors: { ...currentProfile.appearance.colors, top: draft.color } } };
      }
      if (persistAppearance) return persistAppearance(draft).then(applyProfile);
      return applyProfile(draft);
    },
    onNewVisitor,
    onCustomize,
  });

  return {
    visitorId: visitorSession.visitorId,
    applyProfile,
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
    destroy() { destroyed = true; panel.destroy(); },
  };
}

export function bootstrapRoomRealtime({
  bootstrapData,
  visitorSession,
  ioFactory,
  profileController,
  socketUrl,
  consumers = {},
  socketAuth = {},
}) {
  const { roomId } = bootstrapData;
  const { visitorId, capability } = visitorSession;
  const state = createRoomState(visitorId);
  const poseBuffer = createPoseBuffer();
  const syncRoster = () =>
    consumers.syncRoster?.(
      state
        .users()
        .filter((user) => user.position != null && user.rotation != null),
    );
  // Hands ride inside position_update packets, which otherwise skip syncRoster once
  // a peer is established (only a brand-new pose-buffer entry syncs the roster).
  // Track each user's last hand key here so a real hand change — including the
  // true→false transition that should tear down a stale hand entity — still
  // reaches the renderer, without resyncing the roster on every ordinary packet.
  const lastHandKeyByUser = new Map();
  const handsChanged = (data) => {
    const userId = data?.userId;
    if (!userId) return false;
    const key = handKey(data);
    const changed = lastHandKeyByUser.get(userId) !== key;
    lastHandKeyByUser.set(userId, key);
    return changed;
  };
  let socketClient;

  const handlers = {
    connect() {
      profileController.clearConnectionError?.();
      socketClient.emit("join_position_room", profileController.joinPayload());
      consumers.onConnect?.(socketClient);
    },
    connect_error() {
      profileController.showConnectionError?.();
    },
    disconnect() {},
    room_state(data) {
      state.applyRoomState(data?.users);
      // A reconnect can miss user_left events; replace caches with this snapshot.
      poseBuffer.userIds().forEach((userId) => poseBuffer.forget(userId));
      lastHandKeyByUser.clear();
      // Seed the pose buffer with each peer's last-known pose so a late joiner's
      // first render frame doesn't sit everyone at the A-Frame default origin
      // until their next packet arrives (up to a full heartbeat away). Also seed
      // the hand-key map so it reflects what syncRoster is about to render below,
      // rather than treating each peer's first live packet as a hand "change".
      (data?.users ?? []).forEach((user) => {
        poseBuffer.record(user?.userId, user, Date.now());
        handsChanged(user);
      });
      syncRoster();
      socketClient.emit("voice.get_state", { room_id: roomId });
    },
    user_joined(data) {
      // user_joined never carries a pose (server only sends userId/displayName/
      // avatarId/color), so there is nothing to seed into the pose buffer here.
      state.applyJoin(data);
    },
    user_left(data) {
      state.applyLeave(data);
      if (data?.userId) {
        poseBuffer.forget(data.userId);
        lastHandKeyByUser.delete(data.userId);
      }
      syncRoster();
      consumers.handleSocketEvent?.("user_left", data);
    },
    position_update(data) {
      state.applyUpdate(data);
      const isNew = poseBuffer.record(data?.userId, data, Date.now());
      // Compute unconditionally (not `isNew ||`) so the hand-key map is always kept
      // current, even on the packet that already triggers a resync for other reasons.
      const handChanged = handsChanged(data);
      if (isNew || handChanged) syncRoster();
      consumers.onPacketReceived?.();
    },
    profile_updated(data) {
      state.applyUpdate(data);
      syncRoster();
    },
  };

  FORWARDED_SOCKET_EVENTS.forEach((eventName) => {
    handlers[eventName] = (data) =>
      consumers.handleSocketEvent?.(eventName, data);
  });

  socketClient = createSocketClient(ioFactory, handlers);
  profileController.setSocketClient(socketClient);
  consumers.initialize?.(socketClient);
  socketClient.connect(socketUrl, {
    auth: { ...socketAuth, visitorCapability: capability },
    transports: ["websocket", "polling"],
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

  const minimap =
    bootstrapData.boundary == null
      ? null
      : mountMinimap({
          presets: bootstrapData.presets,
          boundary: bootstrapData.boundary,
          wallList: bootstrapData.wallList,
          getCamera: () => document.getElementById("camera"),
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
      if (eventName === "expression") expressions?.handleSocketEvent(data);
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
      errorPanel = document.createElement("section");
      errorPanel.setAttribute("role", "alert");
      errorPanel.setAttribute(
        "style",
        "position:fixed;top:12px;left:12px;z-index:10000;padding:12px;" +
          "border-radius:8px;background:#351313;color:white;font-family:sans-serif;" +
          "pointer-events:auto;",
      );
      const message = document.createElement("p");
      message.textContent =
        "Unable to start the visitor session. Check your connection and retry.";
      const retryButton = document.createElement("button");
      retryButton.setAttribute("type", "button");
      retryButton.textContent = "Retry";
      retryButton.addEventListener("click", () => {
        void attempt();
      });
      errorPanel.append(message, retryButton);
      (document.getElementById?.("room-toolbar") ?? document.body).appendChild(
        errorPanel,
      );
      return null;
    }
  }

  return attempt();
}
