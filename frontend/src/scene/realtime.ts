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
import { api, write, refreshCsrf } from "../api/client";
import { loadAvatarCatalog } from '../avatar/catalog';
import { normalizeAppearance, resolveSavedProfile } from '../avatar/appearance';
import { mountAvatarEditor, type SavedAvatar } from '../features/avatar/AvatarEditor';
import { mountAvatarXRPanel } from '../features/avatar/xr-panel';
import { createAvatarInstance } from '../avatar/resources';
import { updateAvatarMotion } from '../avatar/motion';
import { createRemoteAvatarDisplay } from '../avatar/display';
import { avatarSocketParser } from '../avatar/socket-parser';
import { AvatarPoseBuffer, avatarPoseChanged, sub, mul } from '../avatar/pose';
import { mountAvatarXRInput } from '../avatar/xr-scene';
import { createAvatarPoseTransport } from '../avatar/transport';
import { SmplPlayback } from '../avatar/smpl-playback';
import { validateParametric } from '../avatar/appearance-core.js';
import type { AvatarInstance, AvatarPoseV2, Vec3, Quat } from '../avatar/types';
import type { RoomScene } from "../api/types";
export async function startRealtime(
  scene: any,
  data: RoomScene,
  onWallEvent?: (event: string, payload: any) => void,
  signal?: AbortSignal,
) {
  const socketCsrf = await refreshCsrf();
  const catalog = await loadAvatarCatalog();
  let saved = await api<SavedAvatar>('/api/v1/me/avatar');
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
  visitor.profile = resolveSavedProfile(visitor.profile, saved, sessionStorage, catalog);
  updateVisitorSession({ storage: sessionStorage, visitorSession: visitor });
  let closeEditor: (() => void) | undefined;
  life.add(() => closeEditor?.());
  const importedMotion = new SmplPlayback();
  importedMotion.resetOwner(`${visitor.visitorId}:${saved.ownerScopeToken}`);
  life.add(() => importedMotion.dispose());
  let motionReset = false;
  const motionControls = document.createElement('span');
  motionControls.setAttribute('aria-label', 'Imported motion controls');
  const motionStatus = document.createElement('span'); motionStatus.setAttribute('role', 'status');
  const playMotion = document.createElement('button'), pauseMotion = document.createElement('button'), stopMotion = document.createElement('button');
  playMotion.textContent = 'Play motion'; pauseMotion.textContent = 'Pause motion'; stopMotion.textContent = 'Stop motion';
  const refreshMotion = () => {
    motionStatus.textContent = `Motion: ${importedMotion.state} `;
    playMotion.disabled = importedMotion.state !== 'paused'; pauseMotion.disabled = importedMotion.state !== 'playing'; stopMotion.disabled = importedMotion.state === 'stopped';
  };
  playMotion.onclick = () => { importedMotion.play(performance.now()); refreshMotion(); };
  pauseMotion.onclick = () => { importedMotion.pause(performance.now()); refreshMotion(); };
  const stopImportedMotion = () => { importedMotion.stop(); motionReset = true; refreshMotion(); };
  stopMotion.onclick = stopImportedMotion;
  motionControls.append(motionStatus, playMotion, pauseMotion, stopMotion);
  document.getElementById('room-toolbar')?.append(motionControls); refreshMotion();
  scene.addEventListener('enter-vr', stopImportedMotion);
  life.add(() => { scene.removeEventListener('enter-vr', stopImportedMotion); motionControls.remove(); });
  async function saveAppearance(draft: any, scope = saved) {
    if ((draft.appearance ?? draft).parametric !== undefined) validateParametric((draft.appearance ?? draft).parametric);
    const appearance = normalizeAppearance(draft.appearance ?? draft, catalog);
    await refreshCsrf();
    saved = await write('/api/v1/me/avatar', 'PUT', {
      appearance, expectedRevision: scope.revision, ownerScopeToken: scope.ownerScopeToken,
    });
    if (life.disposed) return draft;
    importedMotion.resetOwner(`${visitor.visitorId}:${saved.ownerScopeToken}`); refreshMotion();
    return { ...draft, appearance: saved.appearance, avatarId: appearance.presetId, color: appearance.colors.top };
  }
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
  const manualExpression = document.createElement('button');
  manualExpression.textContent = '표정 😊';
  manualExpression.onclick = () => expressions.showLocalExpression('😊');
  document.getElementById('room-toolbar')?.append(manualExpression);
  life.add(() => manualExpression.remove());
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
    persistAppearance: saveAppearance,
    onCustomize: () => {
      if (closeEditor) return;
      let scope = saved;
      closeEditor = mountAvatarEditor({
        catalog, initial: normalizeAppearance(panel.profile.appearance ?? panel.profile, catalog),
        onApply: async (appearance, clip) => {
          const next = await saveAppearance({ ...panel.profile, appearance }, scope);
          if (life.disposed) return;
          panel.applyProfile(next);
          if (clip && !scene.is('vr-mode') && !scene.is('ar-mode') && appearance.presetId && catalog.presets.find(p => p.id === appearance.presetId)?.kind === 'humanoid') {
            importedMotion.apply(clip, performance.now()); motionReset = true; refreshMotion();
          }
        },
        onReload: async () => {
          // Cancel must leave the public profile and its saved scope together.
          scope = await api<SavedAvatar>('/api/v1/me/avatar');
          return resolveSavedProfile(panel.profile, scope, sessionStorage, catalog).appearance;
        },
        onClose: () => { closeEditor = undefined; },
      });
    },
    persistVisitorSession: (nextVisitor: any = visitor) => {
      visitor = nextVisitor;
      updateVisitorSession({
        storage: sessionStorage,
        visitorSession: visitor,
      });
    },
    onNewVisitor: async () => {
      await replaceVisitorSession({ ...deps, tabMarker: visitor.tabMarker });
      stopImportedMotion();
      location.reload();
    },
  });
  life.add(panel.destroy);
  life.add(mountAvatarXRPanel({ scene, catalog,
    current: () => normalizeAppearance(panel.profile.appearance ?? panel.profile, catalog),
    apply: async appearance => { panel.applyProfile(await saveAppearance({ ...panel.profile, appearance })); },
  }));
  let debug: any;
  const avatarBuffer = new AvatarPoseBuffer();
  const avatarDisplay = createRemoteAvatarDisplay({scene, buffer:avatarBuffer, targets:renderer.avatars, THREE:(window as any).AFRAME.THREE});
  scene.avatarPerformance = avatarDisplay.stats;
  life.add(() => { avatarDisplay.dispose(); delete scene.avatarPerformance; });
  const realtime = bootstrapRoomRealtime({
    bootstrapData: data,
    visitorSession: visitor,
    ioFactory: (url: string, options: any) => io(url, { ...options, parser: avatarSocketParser }),
    socketUrl: location.origin,
    socketAuth: data.isAdmin ? { csrfToken: socketCsrf } : {},
    profileController: panel,
    consumers: {
      onRoomState: (data: any) => { avatarBuffer.clear(); avatarBuffer.synchronizeClock(data?.serverTime, Date.now()); },
      onConnect: (client: any) => onWallEvent?.("connect", { client }),
      syncRoster: renderer.syncRoster,
      onPacketReceived: () => debug?.recordReceive(),
      initialize(next: any) {
        expressions.init(next, data.roomId, visitor.visitorId);
        voice.init(data.roomId, visitor.visitorId, data.isAdmin, next);
        effects.init(data.roomId, next);
      },
      handleSocketEvent(event: string, payload: any) {
        if (event === 'user_left') avatarBuffer.forget(payload?.userId);
        if (event === "expression") expressions.handleSocketEvent(payload);
        voice.handleSocketEvent(event, payload);
        effects.handleSocketEvent(event, payload);
        onWallEvent?.(event, payload);
      },
    },
  });
  client = realtime.socketClient;
  life.add(realtime.destroy);
  const avatarTransport = createAvatarPoseTransport(client, data.roomId);
  life.add(avatarTransport.dispose);
  life.add(avatarTransport.subscribe(delivery => {
    avatarBuffer.record(delivery.userId, delivery.pose, delivery.generation, delivery.serverTime, Date.now());
  }));
  life.add(client.on('profile_updated', (profile: any) => {
    if (catalog.presets.find(p => p.id === profile.avatarId)?.kind !== 'humanoid') avatarBuffer.forget(profile.userId);
  }));
  let owner: AvatarInstance | undefined, loadingOwner = false, nextOwnerAttempt = 0, previousPosition: Vec3 | undefined;
  let previousFrame = 0, sentAt = 0, sentPose: AvatarPoseV2 | undefined, ownerProfile = '';
  let requestedTeleport = false, outgoingTeleport = false;
  const ownCamera = scene.querySelector('#camera');
  const resetMotion = () => { requestedTeleport = true; };
  ownCamera?.addEventListener('avatar-teleport', resetMotion);
  life.add(() => ownCamera?.removeEventListener('avatar-teleport', resetMotion));
  const ownerAbort = new AbortController();
  life.add(() => { ownerAbort.abort(); owner?.dispose(); });
  const ground = data.roomControlsEnabled && !data.isArMarker && !data.isArCompanion && data.boundary ? { height: data.boundary.min_y } : null;
  const xrInput = mountAvatarXRInput({
    scene,
    camera: ownCamera,
    ground,
    THREE: (window as any).AFRAME.THREE,
    onReset: resetMotion,
  });
  life.add(xrInput.dispose);
  function avatarFrame(time: number) {
    if (xrInput.active && importedMotion.state !== 'stopped') stopImportedMotion();
    const explicitTeleport = requestedTeleport || motionReset;
    motionReset = false;
    requestedTeleport = false;
    const xrSample = xrInput.sample(performance.now(), explicitTeleport);
    hands.tick(time);
    avatarDisplay.frame(time);
    avatarDisplay.stats.ownerMs = 0;
    const profile = panel.profile,
      preset = catalog.presets.find(
        (p) => p.id === (profile.appearance?.presetId || profile.avatarId),
      );
    if (preset?.kind !== "humanoid") {
      if (importedMotion.state !== 'stopped') stopImportedMotion();
      owner?.dispose();
      owner = undefined;
      previousPosition = undefined;
      sentPose = undefined;
      return;
    }
    if (!owner) {
      if (!loadingOwner && time >= nextOwnerAttempt) {
        loadingOwner = true;
        createAvatarInstance({
          scene: scene.object3D,
          preset,
          appearance: profile.appearance,
          signal: ownerAbort.signal,
        })
          .then((instance) => {
            if (life.disposed) {
              instance.dispose();
              return;
            }
            owner = instance;
            instance.root.name = "avatar-owner";
            instance.setDetail("hidden");
          })
          .catch((error) => {
            nextOwnerAttempt = time + 5000;
            if (!ownerAbort.signal.aborted)
              console.warn("Owner avatar motion unavailable:", error);
          })
          .finally(() => {
            loadingOwner = false;
          });
      }
      return;
    }
    const profileKey = JSON.stringify(profile.appearance);
    if (profileKey !== ownerProfile) {
      owner.applyAppearance(profile.appearance || preset.defaultAppearance!);
      ownerProfile = profileKey;
      sentPose = undefined;
    }
    const camera = scene.querySelector("#camera");
    if (!camera?.object3D) return;
    const THREE = (window as any).AFRAME.THREE;
    camera.object3D.updateWorldMatrix(true, false);
    const headPosition = camera.object3D
      .getWorldPosition(new THREE.Vector3())
      .toArray() as Vec3;
    const orientation = camera.object3D
      .getWorldQuaternion(new THREE.Quaternion())
      .toArray() as Quat;
    const delta = previousFrame
      ? Math.min(0.1, Math.max(0.001, (time - previousFrame) / 1000))
      : 0.016;
    const displacement = previousPosition
      ? sub(headPosition, previousPosition)
      : ([0, 0, 0] as Vec3);
    const teleport =
      explicitTeleport || requestedTeleport ||
      !previousPosition ||
      Math.hypot(displacement[0], displacement[2]) > 0.75;
    const velocity = teleport
      ? ([0, 0, 0] as Vec3)
      : mul(displacement, 1 / delta);
    velocity[1] = 0;
    owner.setDetail(xrInput.active ? "full" : "hidden");
    // Skinned head vertices follow bone scale; hiding the bone alone leaves the skin visible.
    owner.root
      .getObjectByName(preset.rigMap.head)
      .scale.setScalar(xrInput.active ? 0.00001 : 1);
    const motionStart = performance.now();
    const importedPose = importedMotion.sample(preset, { position: [headPosition[0], ground?.height ?? headPosition[1] - 1.64, headPosition[2]], orientation: [0, 0, 0, 1] }, performance.now());
    const pose = importedPose ?? updateAvatarMotion(
      owner,
      xrSample ?? {
        version: 2,
        sampleTime: performance.now(),
        root: {
          position: [
            headPosition[0],
            ground?.height ?? headPosition[1] - 1.64,
            headPosition[2],
          ],
          orientation: [0, 0, 0, 1],
        },
        head: { position: headPosition, orientation },
        left: null,
        right: null,
        tracking: { head: true, left: false, right: false },
        locomotion: { velocity, grounded: !!ground, teleport },
      },
      delta,
      ground,
      "full",
    );
    if (importedPose) owner.applyPose(importedPose);
    avatarDisplay.stats.ownerMs = performance.now() - motionStart;
    outgoingTeleport ||= xrSample?.locomotion.teleport ?? teleport;
    pose.teleport = outgoingTeleport;
    previousPosition = headPosition;
    previousFrame = time;
    requestedTeleport = false;
    const changed = avatarPoseChanged(sentPose, pose);
    if (time - sentAt >= 50 && (changed || time - sentAt >= 1000)) {
      avatarTransport.publish(pose);
      sentAt = time;
      sentPose = pose;
      outgoingTeleport = false;
    }
  }
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
    onFrame: avatarFrame,
  });
  loop.start();
  life.add(loop.destroy);
  const hands = mountHandTracking({
    document,
    scene,
    navigator,
    socketClient: client,
    shouldPublish: () =>
      !(
        owner &&
        catalog.presets.find((p) => p.id === panel.profile.avatarId)?.kind ===
          "humanoid"
      ),
    transformHand: xrInput.transformHand,
    cameraPose: xrInput.legacyPose,
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
