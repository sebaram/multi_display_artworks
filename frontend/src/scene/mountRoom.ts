import Hls from "hls.js";
import { createWallRenderer } from "../wall-engine";
import { createLifetime } from "./lifetime";
import { elementPosition, vector } from "./coordinates";
import { animationTime, mediaTime, createServerClock } from "./clocks";
import { registerLocationComponents } from "./location-features.js";
import { mountAR } from "./ar";
import { createViewVisibility, registerRenderScheduler, createQualityController, qualitySettings, selectResidents, imageSizeLimit } from "./render-policy";
import { createArtworkSource, createResourceRegistry } from "./artwork-resources";
import type { ElementDTO, RoomScene, WallDTO } from "../api/types";
type Entity = HTMLElement & {
  object3D?: any;
  getObject3D?: (name: string) => any;
  renderer?: any;
  pause?: () => void;
  exitVR?: () => void;
  components?: any;
  emit?: (event: string, detail?: unknown, bubbles?: boolean) => void;
};
type Services = {
  startRealtime?: (
    scene: Entity,
    data: RoomScene,
    events: (name: string, payload: any) => void,
    signal: AbortSignal,
  ) => Promise<any> | any;
  onSelect?: (id: string) => void;
  onDrag?: (id: string, patch: Record<string, number>) => void;
  onError?: (message: string) => void;
  onReady?: () => void;
  onDesignChange?: (wallId: string, design: any) => void;
};
let runtime: Promise<void> | undefined;
export function loadAFrame() {
  if ((window as any).AFRAME?.components?.gaussian_splatting)
    return Promise.resolve();
  if (!runtime)
    runtime = new Promise((resolve, reject) => {
      const splat = () => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = "/vendor/gaussian-splatting.js";
        script.onload = () => resolve();
        script.onerror = () => {
          runtime = undefined;
          reject(Error("Gaussian splat 런타임을 불러오지 못했습니다."));
        };
        document.head.append(script);
      };
      if ((window as any).AFRAME) {
        splat();
        return;
      }
      const script = document.createElement("script");
      script.src = "/vendor/aframe-1.8.0.min.js";
      script.onload = splat;
      script.onerror = () => {
        runtime = undefined;
        reject(
          Error(
            "3D 런타임을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.",
          ),
        );
      };
      document.head.append(script);
    });
  return runtime;
}
export function safeMediaUrl(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function entity(tag: string, attrs: Record<string, unknown> = {}) {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attrs))
    if (value !== undefined && value !== null)
      el.setAttribute(
        key,
        typeof value === "object"
          ? `${(value as any).x} ${(value as any).y} ${(value as any).z}`
          : String(value),
      );
  return el;
}
export function mountRoom({
  container,
  bootstrap,
  services = {},
}: {
  container: HTMLElement;
  bootstrap: RoomScene;
  services?: Services;
}) {
  const life = createLifetime();
  const abort = new AbortController();
  life.add(() => abort.abort());
  const clock = createServerClock();
  const AFRAME = (window as any).AFRAME;
  if (AFRAME) registerLocationComponents(AFRAME);
  const ownsRenderLoop = !!AFRAME?.registerComponent;
  if (ownsRenderLoop) registerRenderScheduler(AFRAME);
  const scene = entity("a-scene", {
    embedded: "",
    renderer: "colorManagement: true; antialias: true",
    background: "color: #1a2028",
    "xr-mode-ui": "enabled: false",
    webxr: "referenceSpaceType: local-floor; requiredFeatures: local-floor; optionalFeatures: bounded-floor, hand-tracking",
    cursor: "rayOrigin: mouse",
    raycaster: "objects: .artwork-source, .artwork-pick-target, .wall-surface, .wall-occluder; interval: 50",
  });
  scene.setAttribute("aria-label", bootstrap.room?.name || "3D 전시 공간");
  let refreshPicking = true;
  const pickTargetsChanged = () => { refreshPicking = true; };
  scene.addEventListener("artwork-pick-target-changed", pickTargetsChanged);
  life.add(() => scene.removeEventListener("artwork-pick-target-changed", pickTargetsChanged));
  if (bootstrap.isArMarker) {
    scene.setAttribute(
      "arjs",
      "sourceType: webcam; debugUIEnabled: false; cameraParametersUrl: /vendor/arjs/camera_para.dat",
    );
    scene.setAttribute(
      "renderer",
      "colorManagement: true; antialias: true; alpha: true",
    );
    scene.removeAttribute("background");
  }
  const assets = entity("a-assets", { timeout: 10000 });
  scene.append(assets);
  scene.append(
    entity("a-entity", {
      // Match A-Frame 1.6's legacy ambient irradiance after its PI factor was removed.
      light: `type: ambient; color: #ffffff; intensity: ${1.5 * Math.PI}`,
    }),
  );
  const camera = entity("a-camera", {
    id: "camera",
    position: bootstrap.spawn_preset?.position || "0 1.6 5",
    rotation: bootstrap.spawn_preset?.rotation || "0 0 0",
    "wasd-controls": "acceleration: 18",
    "look-controls": "pointerLockEnabled: false",
  });
  if (bootstrap.boundary && !bootstrap.isArCompanion && !bootstrap.isArMarker)
    camera.setAttribute(
      "boundary-clamp",
      `minX:${bootstrap.boundary.min_x};maxX:${bootstrap.boundary.max_x};minY:${bootstrap.boundary.min_y};maxY:${bootstrap.boundary.max_y};minZ:${bootstrap.boundary.min_z};maxZ:${bootstrap.boundary.max_z}`,
    );
  const xrOrigin = entity('a-entity', { id: 'avatar-xr-origin' });
  xrOrigin.append(camera);
  scene.append(xrOrigin);
  const elementNodes = new Map<
      string,
      { node: Entity; wall: WallDTO; data: ElementDTO; source?: ReturnType<typeof createArtworkSource>; lastVisible: number; imageLimit?: number }
    >(),
    walls = new Map<
      string,
      {
        node: Entity;
        renderer?: ReturnType<typeof createWallRenderer>;
        texture?: any;
        binding: any;
        playback?: any;
        pointer?: any;
        dispose: () => void;
      }
    >();
  let realtime: any;
  let frame = 0;
  const view = AFRAME?.THREE?.Matrix4 ? createViewVisibility(AFRAME.THREE, scene) : undefined;
  const quality = createQualityController();
  let appliedQuality = "", lastWallWidth = 1024;
  let fixedQuality: number | null = null;
  const mobile = window.matchMedia?.("(pointer: coarse)")?.matches && window.innerWidth < 1100;
  const performanceState = { level: 0, wallsRendered: 0, wallsSkipped: 0, residentArtworks: 0, settings: qualitySettings({ mobile: !!mobile, xr: false, dpr: window.devicePixelRatio }, 0),
    setFixedQuality(level: number | null) { fixedQuality = level === null ? null : Math.max(0, Math.min(2, Math.round(level))); } };
  (scene as any).galleryPerformance = performanceState;
  const resourceRegistry = AFRAME?.THREE?.Texture && AFRAME?.THREE?.Mesh ? createResourceRegistry(scene, AFRAME.THREE) : undefined;
  life.add(() => resourceRegistry?.dispose());
  let pinnedSelection: string | null = null, lastResidency = -Infinity;
  let lastPointer = 0;
  let sequence = 0;
  const structures = new Map<
    string,
    { wall: WallDTO; node: Entity; base: ReturnType<typeof createLifetime> }
  >();
  life.add(() => {
    for (const wall of walls.values()) wall.dispose();
    for (const structure of structures.values()) structure.base.dispose();
  });
  const media = new Set<HTMLMediaElement>();
  let locallyMuted = true;
  const addVideo = (url: string, owner = life) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = locallyMuted;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.id = `media-${crypto.randomUUID()}`;
    assets.append(video);
    media.add(video);
    owner.add(() => {
      media.delete(video);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    });
    if (
      /\.m3u8(?:\?|$)/i.test(url) &&
      !video.canPlayType("application/vnd.apple.mpegurl") &&
      Hls.isSupported()
    ) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      owner.add(() => hls.destroy());
    } else video.src = url;
    video.play().catch(() => {});
    return video;
  };
  function bindDesign(wall: WallDTO, node: Entity) {
    const binding = wall.design;
    if (!binding?.config) return;
    walls.get(wall.id)?.dispose();
    walls.delete(wall.id);
    structures.get(wall.id)?.base.dispose();
    const wallLife = createLifetime();
    const canvas = document.createElement("canvas");
    canvas.width = performanceState.settings.wallWidth;
    canvas.height = Math.max(
      128,
      Math.round((canvas.width * wall.height) / wall.width),
    );
    canvas.id = `design-${wall.id}`;
    assets.append(canvas);
    wallLife.add(() => canvas.remove());
    let renderer;
    try {
      renderer = createWallRenderer({
        canvas,
        config: binding.config,
        assetResolver: (id: string) =>
          `/api/v1/wall-assets/${encodeURIComponent(id)}/content`,
        onError: (error) => services.onError?.(error.message),
      });
      renderer.resize(canvas.width, canvas.height);
      renderer.setMuted(locallyMuted);
    } catch (error) {
      wallLife.dispose();
      services.onError?.((error as Error).message);
      return;
    }
    const surface = entity("a-plane", {
      width: wall.width,
      height: wall.height,
      position: `0 0 ${wall.depth / 2 + 0.004}`,
      class: "wall-surface",
      material: "shader: flat; side: double",
      "data-wall-id": wall.id,
    });
    // Asset selectors resolve against document, so wait until an initially
    // detached scene has connected before binding its design canvas.
    const bindTexture = () =>
      surface.setAttribute(
        "material",
        `shader: flat; side: double; src: #${canvas.id}`,
      );
    surface.addEventListener("loaded", bindTexture, { once: true });
    node.append(surface);
    if ((surface as any).hasLoaded) bindTexture();
    wallLife.add(() => surface.removeEventListener("loaded", bindTexture));
    wallLife.add(() => surface.remove());
    wallLife.add(() => renderer.dispose());
    walls.set(wall.id, {
      node: surface,
      renderer,
      binding,
      playback: binding.playback,
      dispose: wallLife.dispose,
    });
    const move = (event: any) => {
      const uv = event.detail?.intersection?.uv;
      if (!uv || Date.now() - lastPointer < 50) return;
      lastPointer = Date.now();
      realtime?.client.emit("wall.interaction", {
        wall_id: wall.id,
        binding_revision: walls.get(wall.id)?.binding.revision,
        client_seq: ++sequence,
        kind: "move",
        uv: { u: uv.x, v: uv.y },
      });
    };
    surface.addEventListener("mousemove", move);
    surface.addEventListener("mouseenter", move);
    const leave = () =>
      realtime?.client.emit("wall.interaction", {
        wall_id: wall.id,
        binding_revision: walls.get(wall.id)?.binding.revision,
        client_seq: ++sequence,
        kind: "leave",
      });
    surface.addEventListener("mouseleave", leave);
    wallLife.add(() => {
      surface.removeEventListener("mousemove", move);
      surface.removeEventListener("mouseenter", move);
      surface.removeEventListener("mouseleave", leave);
    });
  }
  function legacyBackground(wall: WallDTO, node: Entity) {
    const base = createLifetime();
    structures.set(wall.id, { wall, node, base });
    if (safeMediaUrl(wall.video_url)) {
      const video = addVideo(safeMediaUrl(wall.video_url), base);
      const surface = entity("a-video", {
        src: `#${video.id}`,
        width: wall.width,
        height: wall.height,
        position: `0 0 ${wall.depth / 2 + 0.005}`,
      });
      node.append(surface);
      base.add(() => surface.remove());
    } else if (safeMediaUrl(wall.image_url)) {
      const surface = entity("a-image", {
        src: safeMediaUrl(wall.image_url),
        width: wall.width,
        height: wall.height,
        position: `0 0 ${wall.depth / 2 + 0.005}`,
      });
      node.append(surface);
      base.add(() => surface.remove());
    }
  }
  for (const wall of bootstrap.walls || []) {
    const node = entity("a-entity", {
      position: wall.position,
      rotation: wall.rotation,
      "data-wall-id": wall.id,
    });
    scene.append(node);
    node.append(
      entity("a-box", {
        class: "wall-occluder",
        width: wall.width,
        height: wall.height,
        depth: wall.depth,
        color: wall.color || "#e1e0dc",
      }),
    );
    if (wall.design?.config) {
      structures.set(wall.id, { wall, node, base: createLifetime() });
      bindDesign(wall, node);
    } else legacyBackground(wall, node);
    for (const element of wall.elements || []) {
      const root = entity("a-entity", {
        "data-element-id": element.id,
        "data-element-type": element.wall_element_type,
        class: "artwork",
        position: elementPosition(element, wall),
        rotation: `${element.rotation_x || 0} ${element.rotation_y || 0} ${element.rotation_z || 0}`,
        scale: `${element.scale_x ?? 1} ${element.scale_y ?? 1} ${element.scale_z ?? 1}`,
      });
      root.setAttribute("title", element.name || "작품");
      const source = resourceRegistry && ["image", "gltf", "gaussian_splat"].includes(element.wall_element_type)
        ? createArtworkSource({ root, data: element, AFRAME, resources: resourceRegistry, onError: services.onError, maxImageSize: performanceState.settings.maxImageSize })
        : undefined;
      if (source) { /* Stable artwork root owns its lazily resident source. */ }
      else if (element.wall_element_type === "image")
        root.append(
          entity("a-image", {
            src: safeMediaUrl(element.image_url),
            width: element.width || 1,
            height: element.height || 1,
            material: "side: double",
            class: "artwork-source",
          }),
        );
      else if (element.wall_element_type === "gltf")
        root.append(
          entity("a-entity", {
            "gltf-model": safeMediaUrl(element.gltf_url),
            rotation: element.default_rotation || "0 0 0",
            class: "gltf-source artwork-source",
          }),
        );
      else if (element.wall_element_type === "gaussian_splat") {
        if (AFRAME?.components?.gaussian_splatting) {
          let cutout = "";
          if (element.cutout_scale) {
            const box = entity("a-box", {
              id: `cutout-${element.id}`,
              visible: false,
              scale: element.cutout_scale,
              position: element.cutout_position || "0 0 0",
            });
            root.append(box);
            cutout = `; cutoutEntity: #cutout-${element.id}`;
          }
          root.setAttribute(
            "gaussian_splatting",
            `src: ${safeMediaUrl(element.splat_url)}${cutout}`,
          );
          const error = (event: any) =>
            services.onError?.(`Gaussian splat: ${event.detail.message}`);
          root.addEventListener("splat-error", error);
          life.add(() => root.removeEventListener("splat-error", error));
        } else
          services.onError?.(
            "Gaussian splat 렌더러를 불러오지 못했습니다. 작품 원본 링크에서 확인하세요.",
          );
      } else
        root.append(
          entity("a-plane", {
            width: element.width || 1.5,
            height: element.height || 1,
            color: "#18576d",
            material: "side: double",
            class: "artwork-source",
          }),
        );
      const select = () => { pinnedSelection = element.id; lastResidency = -Infinity; services.onSelect?.(element.id); };
      root.addEventListener("click", select);
      const down = (event: any) => {
        if (!bootstrap.isAdmin || !event.detail?.intersection) return;
        services.onSelect?.(element.id);
        pinnedSelection = element.id; lastResidency = -Infinity;
        dragging = element.id;
        camera.setAttribute("look-controls", "enabled: false");
      };
      root.addEventListener("mousedown", down);
      life.add(() => {
        root.removeEventListener("click", select);
        root.removeEventListener("mousedown", down);
      });
      node.append(root);
      elementNodes.set(element.id, { node: root, wall, data: element, source, lastVisible: -Infinity });
    }
  }
  let dragging: string | undefined;
  const raycaster = AFRAME ? new AFRAME.THREE.Raycaster() : undefined;
  let moving = [0, 0];
  const moveTimer = window.setInterval(() => {
    if (life.disposed || (!moving[0] && !moving[1])) return;
    const p = camera.object3D?.position,
      r = camera.object3D?.rotation;
    if (!p || !r) return;
    const speed = 0.06;
    p.x += (-Math.sin(r.y) * moving[0] + Math.cos(r.y) * moving[1]) * speed;
    p.z += (-Math.cos(r.y) * moving[0] - Math.sin(r.y) * moving[1]) * speed;
  }, 33);
  life.add(() => clearInterval(moveTimer));
  function mouseMove(event: PointerEvent) {
    if (!raycaster || (scene as any).camera === undefined) return;
    const rect = (scene as any).canvas?.getBoundingClientRect();
    if (!rect) return;
    raycaster.setFromCamera(
      new AFRAME.THREE.Vector2(
        (2 * (event.clientX - rect.left)) / rect.width - 1,
        1 - (2 * (event.clientY - rect.top)) / rect.height,
      ),
      (scene as any).camera,
    );
    if (dragging) {
      const entry = elementNodes.get(dragging);
      const parent = entry?.node.parentElement as Entity;
      if (!entry || !parent?.object3D) return;
      const normal = new AFRAME.THREE.Vector3(0, 0, 1).applyQuaternion(
        parent.object3D.getWorldQuaternion(new AFRAME.THREE.Quaternion()),
      );
      const plane = new AFRAME.THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        parent.object3D.getWorldPosition(new AFRAME.THREE.Vector3()),
      );
      const point = raycaster.ray.intersectPlane(
        plane,
        new AFRAME.THREE.Vector3(),
      );
      if (!point) return;
      parent.object3D.worldToLocal(point);
      const patch = {
        position_x: Math.max(
          -entry.wall.width / 2,
          Math.min(entry.wall.width / 2, point.x),
        ),
        position_y: Math.max(
          -entry.wall.height / 2,
          Math.min(entry.wall.height / 2, point.y),
        ),
      };
      entry.data = { ...entry.data, ...patch };
      entry.node.setAttribute(
        "position",
        Object.values(elementPosition(entry.data, entry.wall)).join(" "),
      );
      services.onDrag?.(dragging, patch);
      return;
    }
    if (Date.now() - lastPointer < 50) return;
    const candidates = new Map<any, string | undefined>();
    for (const [id, structure] of structures) {
      const surface = walls.get(id)?.node;
      // Ordinary wall bodies also occlude interactive surfaces behind them.
      for (const node of [surface, structure.node.querySelector('a-box') as Entity | null]) {
        const mesh = node?.getObject3D?.('mesh');
        if (!mesh) continue;
        let visible = true;
        for (let parent = mesh; parent; parent = parent.parent)
          if (parent.visible === false) { visible = false; break; }
        if (visible) candidates.set(mesh, node === surface ? id : undefined);
      }
    }
    const hit = raycaster.intersectObjects([...candidates.keys()], false)[0];
    const id = hit && candidates.get(hit.object), wall = id && walls.get(id);
    if (!wall || !hit.uv || wall.binding.config.state?.interactive === false) return;
    lastPointer = Date.now();
    realtime?.client.emit("wall.interaction", {
      wall_id: id, binding_revision: wall.binding.revision,
      client_seq: ++sequence, kind: "move", uv: { u: hit.uv.x, v: hit.uv.y },
    });
  }
  function mouseUp() {
    dragging = undefined;
    if (!bootstrap.isArMarker && !bootstrap.isArCompanion)
      camera.setAttribute("look-controls", "enabled: true");
  }
  scene.addEventListener("pointermove", mouseMove);
  const movementFocus = (event: Event) => {
    // A-Frame captures WASD only on body; a native canvas click focuses #main-content.
    if (!bootstrap.roomControlsEnabled || !(event.target instanceof HTMLCanvasElement)) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.contains(scene)) active.blur();
  };
  scene.addEventListener('pointerup', movementFocus);
  life.add(() => scene.removeEventListener('pointerup', movementFocus));
  window.addEventListener("pointerup", mouseUp);
  window.addEventListener("blur", mouseUp);
  life.add(() => {
    scene.removeEventListener("pointermove", mouseMove);
    window.removeEventListener("pointerup", mouseUp);
    window.removeEventListener("blur", mouseUp);
  });
  container.append(scene);
  let started = false;
  let sampledClock = false;
  const syncClock = (client: any = realtime?.client) => {
    const sent = Date.now();
    client?.request?.("wall.clock", {}, (response: any) => {
      if (life.disposed || !Number.isFinite(response?.server_time_ms)) return;
      clock.observe(response.server_time_ms, (sent + Date.now()) / 2);
      sampledClock = true;
    });
  };
  const clockTimer = window.setInterval(() => syncClock(), 30000);
  life.add(() => clearInterval(clockTimer));
  function applyDesign(design: any) {
    const structure = structures.get(design.wall_id);
    if (!structure || !design.config) return;
    const current = walls.get(design.wall_id);
    if (current && current.binding.revision > design.revision) return;
    if (current) {
      current.binding = design;
      current.playback = design.playback;
      current.renderer?.setConfig(design.config);
    } else bindDesign({ ...structure.wall, design }, structure.node);
    services.onDesignChange?.(design.wall_id, design);
  }
  function removeDesign(id: string, revision: number) {
    const current = walls.get(id),
      structure = structures.get(id);
    if (!current || !structure || revision < current.binding.revision) return;
    current.dispose();
    walls.delete(id);
    legacyBackground(structure.wall, structure.node);
    services.onDesignChange?.(id, null);
  }
  const events = (name: string, payload: any) => {
    if (name === "connect") {
      syncClock(payload.client);
      return;
    }
    if (!sampledClock && payload?.server_time_ms)
      clock.observe(payload.server_time_ms);
    if (name === "wall.snapshot") {
      const active = new Set<string>();
      for (const snapshot of payload.walls || []) {
        if (!snapshot.design) continue;
        active.add(snapshot.design.wall_id);
        applyDesign(snapshot.design);
        if (snapshot.interaction)
          events("wall.interaction_state", snapshot.interaction);
      }
      for (const [id, current] of walls)
        if (!active.has(id)) removeDesign(id, current.binding.revision);
      return;
    }
    if (name === "wall.design_applied") {
      applyDesign(payload);
      return;
    }
    if (name === "wall.design_removed") {
      removeDesign(payload.wall_id, payload.revision);
      return;
    }
    const wall = walls.get(payload?.wall_id);
    if (!wall) return;
    if (
      payload.binding_revision &&
      payload.binding_revision !== wall.binding.revision &&
      name !== "wall.design_applied"
    )
      return;
    if (name === "wall.interaction_state") {
      if (
        wall.pointer?.runtime_id === payload.runtime_id &&
        wall.pointer.sequence >= payload.sequence
      )
        return;
      wall.pointer = payload;
      wall.renderer?.setInteraction(payload.pointer);
    }
    if (
      name === "wall.playback_state" &&
      (!wall.playback || payload.revision >= wall.playback.revision)
    )
      wall.playback = payload;
  };
  async function ready() {
    if (started || life.disposed) return;
    started = true;
    services.onReady?.();
    if (bootstrap.isArMarker || bootstrap.isArCompanion) {
      const ar = mountAR({
        scene,
        roomId: bootstrap.roomId,
        marker: bootstrap.isArMarker,
        onStatus: services.onError,
      });
      life.add(ar.dispose);
    }
    try {
      const pending = await services.startRealtime?.(
        scene,
        bootstrap,
        events,
        abort.signal,
      );
      if (life.disposed) {
        pending?.dispose();
        return;
      }
      realtime = pending;
      life.add(() => pending?.dispose());
    } catch (error) {
      if (!life.disposed) services.onError?.((error as Error).message);
    }
  }
  scene.addEventListener("loaded", ready);
  life.add(() => scene.removeEventListener("loaded", ready));
  function updateResidency(time: number) {
    if (!resourceRegistry || time - lastResidency < 250) return;
    lastResidency = time;
    (scene as any).object3D?.updateMatrixWorld(true);
    const candidates = [];
    for (const [id, entry] of elementNodes) {
      if (!entry.source) continue;
      const measured = view?.measure(entry.source.bounds) || { visible: true, near: true, distance: 0, pixels: Infinity };
      const pinned = id === pinnedSelection || id === dragging;
      const visible = measured.visible && measured.pixels >= (entry.source.resident ? 4 : 8);
      if (visible || pinned) entry.lastVisible = time;
      if (entry.data.wall_element_type === "image") {
        entry.imageLimit = imageSizeLimit(measured.pixels, performanceState.settings.maxImageSize, entry.imageLimit, pinned);
      }
      candidates.push({ id, visible, pinned, near: measured.near && measured.pixels >= 4, distance: measured.distance, lastVisible: entry.lastVisible, resident: entry.source.resident });
    }
    const wanted = selectResidents(candidates, time, performanceState.settings.prefetch);
    performanceState.residentArtworks = 0;
    for (const [id, entry] of elementNodes) {
      if (!entry.source) continue;
      entry.source.setQuality({ maxImageSize: entry.imageLimit || performanceState.settings.maxImageSize });
      entry.source.setResident(wanted.has(id));
      const resident = String(entry.source.resident);
      if (entry.node.dataset.resident !== resident) {
        entry.node.classList.toggle("resident-artwork", entry.source.resident);
        entry.node.dataset.resident = resident;
      }
      if (entry.source.resident) performanceState.residentArtworks++;
    }
  }
  function render(time = performance.now(), delta = 16) {
    if (life.disposed) return;
    view?.update();
    const xr = !!scene.renderer?.xr?.isPresenting;
    const target = 1000 / (xr ? scene.renderer.xr.getSession?.()?.frameRate || 72 : 60);
    const level = fixedQuality ?? quality.sample(time, delta, target, document.visibilityState !== "hidden");
    const settings = qualitySettings({ mobile: !!mobile, xr, dpr: window.devicePixelRatio }, level);
    const qualityKey = `${xr}/${level}/${settings.pixelRatio}`;
    if (scene.renderer && qualityKey !== appliedQuality) {
      appliedQuality = qualityKey;
      if (!xr) scene.renderer.setPixelRatio(settings.pixelRatio);
      else scene.renderer.xr.setFoveation?.([0, 0.4, 0.7][level]);
      scene.components?.["gaussian-splatting-system"]?.setBudget?.(settings.splatBudget);
      if (lastWallWidth !== settings.wallWidth) {
        lastWallWidth = settings.wallWidth;
        for (const wall of walls.values()) {
          const image = wall.node.getObject3D?.("mesh")?.material?.map?.image;
          const ratio = image?.width && image?.height ? image.height / image.width : 9 / 16;
          wall.renderer?.resize(settings.wallWidth, Math.max(1, Math.round(settings.wallWidth * ratio)));
        }
      }
    }
    performanceState.level = level; performanceState.settings = settings;
    updateResidency(time);
    if (refreshPicking) {
      scene.components?.raycaster?.refreshObjects?.();
      refreshPicking = false;
    }
    performanceState.wallsRendered = performanceState.wallsSkipped = 0;
    for (const wall of walls.values()) {
      const epoch = wall.binding.animation_epoch_ms || 0;
      const now = clock.now();
      const playback = wall.playback ? mediaTime(wall.playback, now) : { positionSeconds: animationTime(wall.binding.config, epoch, now), playing: !wall.binding.config.state?.paused, rate: wall.binding.config.state?.speed ?? 1 };
      wall.renderer?.syncPlayback?.(playback);
      const mesh = wall.node.getObject3D?.("mesh");
      if (document.visibilityState === "hidden" || (view && !view.intersects(mesh))) {
        performanceState.wallsSkipped++; continue;
      }
      const changed = wall.renderer?.render(
        animationTime(wall.binding.config, epoch, now),
        playback,
      );
      const texture = mesh?.material?.map;
      if (texture && changed !== false) texture.needsUpdate = true;
      if (changed !== false) performanceState.wallsRendered++;
      else performanceState.wallsSkipped++;
    }
    if (!ownsRenderLoop) frame = requestAnimationFrame(render);
  }
  if (ownsRenderLoop) {
    (scene as any).galleryRenderWork = render;
    scene.setAttribute("gallery-render-work", "");
    life.add(() => { delete (scene as any).galleryRenderWork; scene.removeAttribute("gallery-render-work"); });
  } else if (typeof requestAnimationFrame === "function")
    frame = requestAnimationFrame(render);
  life.add(() => cancelAnimationFrame(frame));
  life.add(() => {
    for (const entry of elementNodes.values()) entry.source?.dispose();
    resourceRegistry?.dispose();
    for (const video of media) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    }
    scene.pause?.();
    scene.renderer?.xr?.getSession?.()?.end?.();
    scene.renderer?.dispose?.();
    scene.renderer?.forceContextLoss?.();
    scene.remove();
  });
  return {
    scene,
    select(id: string | null) { pinnedSelection = id; lastResidency = -Infinity; },
    getCameraPose() {
      const position =
        camera.object3D?.position || vector(camera.getAttribute("position"));
      const rotation = camera.object3D?.rotation
        ? {
            x: (camera.object3D.rotation.x * 180) / Math.PI,
            y: (camera.object3D.rotation.y * 180) / Math.PI,
            z: (camera.object3D.rotation.z * 180) / Math.PI,
          }
        : vector(camera.getAttribute("rotation"));
      return {
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        rotation_x: rotation.x,
        rotation_y: rotation.y,
        rotation_z: rotation.z,
      };
    },
    getYouTubeClock(wallId: string, layerId: string) {
      const layer = walls
        .get(wallId)
        ?.renderer?.getYouTubeLayers()
        .find((layer) => layer.id === layerId);
      return layer ? { ...layer.playback, layer } : undefined;
    },
    playbackCommand(
      wallId: string,
      action: "play" | "pause" | "seek",
      position?: number,
    ) {
      const wall = walls.get(wallId);
      if (!wall?.playback || !bootstrap.isAdmin) return false;
      return !!realtime?.client.request(
        "wall.playback_command",
        {
          wall_id: wallId,
          binding_revision: wall.binding.revision,
          expected_playback_revision: wall.playback.revision,
          action,
          ...(action === "seek" ? { position_seconds: position } : {}),
        },
        (response: any) => {
          if (response?.ok && response.state)
            events("wall.playback_state", response.state);
          else if (response && !response.ok)
            services.onError?.(
              `공유 재생 변경 실패 (${response.status}). ${response.detail || "다시 시도하세요."}`,
            );
        },
      );
    },
    move(forward: number, right: number) {
      moving = [forward, right];
    },
    update(patches: ElementDTO[]) {
      for (const patch of patches) {
        const entry = elementNodes.get(patch.id);
        if (!entry) continue;
        if (patch.wall && patch.wall !== entry.wall.id) {
          const destination = structures.get(patch.wall);
          if (!destination) continue;
          destination.node.append(entry.node);
          entry.wall = destination.wall;
        }
        if (
          !entry.source && entry.data.wall_element_type === "gaussian_splat" &&
          patch.splat_url !== undefined &&
          safeMediaUrl(patch.splat_url) !== safeMediaUrl(entry.data.splat_url) &&
          entry.node.hasAttribute("gaussian_splatting")
        ) {
          const cutout = entry.data.cutout_scale
            ? `; cutoutEntity: #cutout-${patch.id}`
            : "";
          // The vendor loads only in init; removal releases its previous worker/GPU resources.
          entry.node.removeAttribute("gaussian_splatting");
          entry.node.setAttribute(
            "gaussian_splatting",
            `src: ${safeMediaUrl(patch.splat_url)}${cutout}`,
          );
        }
        entry.data = { ...entry.data, ...patch };
        entry.node.setAttribute(
          "position",
          Object.values(elementPosition(entry.data, entry.wall)).join(" "),
        );
        entry.node.setAttribute(
          "scale",
          `${entry.data.scale_x ?? 1} ${entry.data.scale_y ?? 1} ${entry.data.scale_z ?? 1}`,
        );
        entry.node.setAttribute(
          "rotation",
          `${entry.data.rotation_x || 0} ${entry.data.rotation_y || 0} ${entry.data.rotation_z || 0}`,
        );
        if (entry.source) { entry.source.setData(entry.data); lastResidency = -Infinity; continue; }
        const image = entry.node.querySelector("a-image");
        if (image && patch.image_url)
          image.setAttribute("src", safeMediaUrl(patch.image_url));
        if (patch.gltf_url)
          entry.node
            .querySelector(".gltf-source")
            ?.setAttribute("gltf-model", safeMediaUrl(patch.gltf_url));
      }
    },
    teleport(preset: any) {
      lastResidency = -Infinity;
      camera.setAttribute("position", preset.position);
      camera.setAttribute("rotation", preset.rotation);
      const rotation = vector(preset.rotation);
      const look = camera.components?.["look-controls"];
      if (look?.yawObject)
        look.yawObject.rotation.y = (rotation.y * Math.PI) / 180;
      if (look?.pitchObject)
        look.pitchObject.rotation.x = (rotation.x * Math.PI) / 180;
        camera.emit?.('avatar-teleport', {}, false);
    },
    sound(enabled: boolean) {
      locallyMuted = !enabled;
      for (const wall of walls.values()) wall.renderer?.setMuted(!enabled);
      media.forEach((video) => {
        video.muted = !enabled;
        if (enabled) void video.play().catch(() => {});
      });
    },
    emit(event: string, payload: any) {
      return realtime?.client.emit(event, payload);
    },
    dispose: life.dispose,
  };
}
