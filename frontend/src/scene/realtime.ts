import { io } from "socket.io-client";
import { createLifetime } from "./lifetime";
import {
  openVisitorSession,
  createTabMarker,
  replaceVisitorSession,
  updateVisitorSession,
} from "./legacy/visitor-session.js";
import { createAvatarEntity } from "./legacy/avatar-renderer.js";
import { createSceneRenderer } from "./legacy/rendering/scene.js";
import { createPosePublisher } from "./legacy/core/pose-publisher.js";
import {
  bootstrapRoomRealtime,
  bootstrapRoomProfile,
} from "./legacy/application.js";
import { createRenderLoop } from "./legacy/rendering/render-loop.js";
import { mountMinimap } from "./legacy/minimap.js";
import { mountHandTracking } from "./legacy/interaction/hand-tracking.js";
import { createAvatarExpressions } from "./avatar-expression.js";
import { createVoiceChat } from "./voice-chat.js";
import { createRoomEffects } from "./room-effects.js";
import { mountShare } from "./legacy/ui/share.js";
import { mountSyncDebug } from "./legacy/ui/sync-debug.js";
import qrcode from "qrcode-generator";
import { refreshCsrf } from "../api/client";
import type { RoomScene } from "../api/types";
export async function startRealtime(
  scene: any,
  data: RoomScene,
  onWallEvent?: (event: string, payload: any) => void,
  signal?: AbortSignal,
) {
  const socketCsrf = await refreshCsrf();
  if (signal?.aborted) return { dispose() {} };
  const life = createLifetime(),
    timeouts = new Set<number>();
  const timer = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      if (!life.disposed) fn();
    }, ms);
    timeouts.add(id);
    return id;
  };
  life.add(() => timeouts.forEach(clearTimeout));
  const deps = {
    storage: sessionStorage,
    fetch: window.fetch.bind(window),
    location,
    history,
    avatarIds: data.avatarCatalog,
    visitorCapabilityUrl: data.visitorCapabilityUrl,
  };
  const owned = await openVisitorSession({
    ...deps,
    tab: window,
    createMarker: () => createTabMarker({ crypto }),
    createProbeId: () => createTabMarker({ crypto }),
    createBroadcastChannel: (name: string) => new BroadcastChannel(name),
    scheduleTimeout: window.setTimeout.bind(window),
    clearScheduledTimeout: window.clearTimeout.bind(window),
  });
  life.add(owned.release);
  if (signal?.aborted) {
    life.dispose();
    return { dispose: life.dispose };
  }
  signal?.addEventListener("abort", life.dispose, { once: true });
  life.add(() => signal?.removeEventListener("abort", life.dispose));
  let visitor = owned.visitorSession;
  const publisher = createPosePublisher();
  const renderer = createSceneRenderer({
    document,
    scene,
    selfId: visitor.visitorId,
    createAvatarEntity: (profile: any) => createAvatarEntity(profile, document),
  });
  life.add(renderer.destroy);
  const expressions = createAvatarExpressions({
    document,
    navigator,
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: timer,
    now: Date.now,
    console,
    autoStart: false,
  });
  life.add(expressions.destroy);
  const expressionButton = document.createElement("button");
  expressionButton.textContent = "표정 감지 시작";
  expressionButton.onclick = () => {
    expressions.enable();
    expressionButton.disabled = true;
    expressionButton.textContent = "표정 감지 켜짐";
  };
  document.getElementById("room-toolbar")?.append(expressionButton);
  life.add(() => expressionButton.remove());
  const voice = createVoiceChat({
    document,
    navigator,
    fetch: window.fetch.bind(window),
    setTimeout: timer,
    RTCPeerConnection: window.RTCPeerConnection,
    MediaRecorder: window.MediaRecorder,
    AudioContext: window.AudioContext,
  });
  life.add(voice.destroy);
  const effects = createRoomEffects({
    document,
    fetch: window.fetch.bind(window),
    setTimeout: timer,
  });
  life.add(effects.destroy);
  let client: any;
  const panel = bootstrapRoomProfile({
    bootstrapData: data,
    visitorSession: visitor,
    document,
    persistVisitorSession: (nextVisitor: any = visitor) => {
      visitor = nextVisitor;
      updateVisitorSession({
        storage: sessionStorage,
        visitorSession: visitor,
      });
    },
    onNewVisitor: async () => {
      await replaceVisitorSession({ ...deps, tabMarker: visitor.tabMarker });
      location.reload();
    },
  });
  life.add(panel.destroy);
  let debug: any;
  const realtime = bootstrapRoomRealtime({
    bootstrapData: data,
    visitorSession: visitor,
    ioFactory: io,
    socketUrl: location.origin,
    socketAuth: data.isAdmin ? { csrfToken: socketCsrf } : {},
    profileController: panel,
    consumers: {
      onConnect: (client: any) => onWallEvent?.("connect", { client }),
      syncRoster: renderer.syncRoster,
      onPacketReceived: () => debug?.recordReceive(),
      initialize(next: any) {
        expressions.init(next, data.roomId, visitor.visitorId);
        voice.init(data.roomId, visitor.visitorId, data.isAdmin, next);
        effects.init(data.roomId, next);
      },
      handleSocketEvent(event: string, payload: any) {
        if (event === "expression") expressions.handleSocketEvent(payload);
        voice.handleSocketEvent(event, payload);
        effects.handleSocketEvent(event, payload);
        onWallEvent?.(event, payload);
      },
    },
  });
  client = realtime.socketClient;
  life.add(realtime.destroy);
  const buffer = realtime.poseBuffer;
  const share = mountShare({
    document,
    location,
    roomId: data.roomId,
    navigator,
    qrcode,
    setTimeout: timer,
  });
  life.add(share.destroy);
  if (data.syncDebugEnabled) {
    debug = mountSyncDebug({
      document,
      poseBuffer: buffer,
      socketClient: client,
      now: Date.now,
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
    });
    life.add(debug.destroy);
  }
  const loop = createRenderLoop({
    AFRAME: (window as any).AFRAME,
    scene,
    poseBuffer: buffer,
    applyPoses: renderer.applyPoses,
    now: Date.now,
    console,
  });
  loop.start();
  life.add(loop.destroy);
  const hands = mountHandTracking({
    document,
    navigator,
    socketClient: client,
    roomId: data.roomId,
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    console,
    onHandRaiseDetected: expressions.onHandRaiseDetected,
    posePublisher: publisher,
    now: Date.now,
  });
  life.add(hands.destroy);
  if (data.roomControlsEnabled && data.boundary) {
    const map = (mountMinimap as any)({
      presets: data.presets,
      boundary: data.boundary,
      wallList: data.wallList,
      getCamera: () => scene.querySelector("#camera"),
      document,
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    });
    life.add(map.destroy);
  }
  return { visitorId: visitor.visitorId, client, dispose: life.dispose };
}
