import type { ElementDTO } from "../api/types";

type Options = {
  root: HTMLElement;
  data: ElementDTO;
  AFRAME: any;
  resources?: ReturnType<typeof createResourceRegistry>;
  onError?: (message: string) => void;
  maxImageSize?: number;
};

export function createResourceRegistry(scene: any, THREE: any) {
  const references = new Map<string, number>();
  type Subscriber = { loaded: (texture: any) => void; failed: () => void };
  type DisplayImage = {
    image: HTMLImageElement;
    texture?: any;
    canvas?: HTMLCanvasElement;
    failed: boolean;
    subscribers: Set<Subscriber>;
    dispose: () => void;
  };
  const displayImages = new Map<string, DisplayImage>();
  let disposed = false;
  function evict(url: string) {
    // r184 prefixes loader cache keys; older A-Frame also used the plain URL.
    for (const key of [
      url,
      `file:${url}`,
      `image:${url}`,
      `image-bitmap:${url}`,
    ])
      THREE?.Cache?.remove(key);
    const material = scene?.systems?.material;
    if (material?.sourceCache)
      delete material.sourceCache[material.hash?.(url) ?? url];
  }
  return {
    acquireImage(
      url: string,
      maxSize: number,
      loaded: Subscriber["loaded"],
      failed: Subscriber["failed"],
    ) {
      if (disposed) return () => {};
      const key = `${maxSize}:${url}`;
      const subscriber = { loaded, failed };
      let entry = displayImages.get(key);
      if (!entry) {
        const image = new Image();
        image.crossOrigin = "anonymous";
        const shared: DisplayImage = {
          image,
          failed: false,
          subscribers: new Set(),
          dispose: () => {},
        };
        entry = shared;
        displayImages.set(key, shared);
        const error = () => {
          if (displayImages.get(key) !== shared) return;
          shared.failed = true;
          for (const consumer of [...shared.subscribers])
            if (shared.subscribers.has(consumer)) consumer.failed();
        };
        const ready = () => {
          if (displayImages.get(key) !== shared) return;
          let display: HTMLImageElement | HTMLCanvasElement = image;
          const scale = Math.min(
            1,
            maxSize / Math.max(image.naturalWidth, image.naturalHeight),
          );
          if (scale < 1) {
            const canvas = (shared.canvas = document.createElement("canvas"));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(
              1,
              Math.round(image.naturalHeight * scale),
            );
            const context = canvas.getContext("2d");
            if (!context) {
              error();
              return;
            }
            try {
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
            } catch {
              error();
              return;
            }
            display = canvas;
          }
          const texture = (shared.texture = new THREE.Texture(display));
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          if (shared.canvas) {
            image.removeEventListener("error", error);
            image.removeAttribute("src");
          }
          for (const consumer of [...shared.subscribers])
            if (shared.subscribers.has(consumer)) consumer.loaded(texture);
        };
        image.addEventListener("load", ready, { once: true });
        image.addEventListener("error", error, { once: true });
        shared.dispose = () => {
          image.removeEventListener("load", ready);
          image.removeEventListener("error", error);
          image.removeAttribute("src");
          shared.texture?.dispose();
          if (shared.canvas) {
            shared.canvas.width = 1;
            shared.canvas.height = 1;
          }
          shared.subscribers.clear();
        };
        shared.subscribers.add(subscriber);
        image.src = url;
      } else {
        entry.subscribers.add(subscriber);
        const shared = entry;
        if (entry.texture || entry.failed)
          queueMicrotask(() => {
            if (!shared.subscribers.has(subscriber)) return;
            if (shared.texture) loaded(shared.texture);
            else failed();
          });
      }
      const shared = entry;
      return () => {
        shared.subscribers.delete(subscriber);
        if (!shared.subscribers.size && displayImages.get(key) === shared) {
          displayImages.delete(key);
          shared.dispose();
        }
      };
    },
    retain(urls: Iterable<string>) {
      const owned = [...new Set(urls)];
      if (!disposed)
        for (const url of owned)
          references.set(url, (references.get(url) || 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const url of owned) {
          const remaining = (references.get(url) || 1) - 1;
          if (remaining > 0) references.set(url, remaining);
          else {
            references.delete(url);
            evict(url);
          }
        }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const url of references.keys()) evict(url);
      references.clear();
      for (const image of displayImages.values()) image.dispose();
      displayImages.clear();
    },
  };
}

function mediaUrl(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function entity(tag: string, attrs: Record<string, unknown>) {
  const node = document.createElement(tag) as HTMLElement & {
    setObject3D?: (key: string, object: any) => void;
    removeObject3D?: (key: string) => void;
    object3D?: any;
  };
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

// GLTFLoader creates a dedicated graph per parse. Do not use this on A-Frame's
// geometry/material caches, which can still belong to another entity.
function disposeModel(gltf: any, closedImages = new Set<any>()) {
  const geometries = new Set<any>(),
    materials = new Set<any>(),
    textures = new Set<any>();
  const images = new Set<any>(),
    skeletons = new Set<any>();
  const findTextures = (value: any) => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(findTextures);
  };
  for (const graph of new Set([gltf.scene, ...(gltf.scenes || [])])) {
    graph?.parent?.remove(graph);
    graph?.traverse((node: any) => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        if (material) materials.add(material);
      if (node.skeleton) skeletons.add(node.skeleton);
      if (node.isInstancedMesh) node.dispose?.();
    });
  }
  for (const material of materials) {
    Object.values(material).forEach(findTextures);
    if (material.uniforms)
      for (const uniform of Object.values(material.uniforms) as any[])
        findTextures(uniform?.value);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    for (const image of Array.isArray(texture.image)
      ? texture.image
      : [texture.image])
      if (image?.close) images.add(image);
  }
  for (const image of images)
    if (!closedImages.has(image)) {
      closedImages.add(image);
      image.close();
    }
  for (const skeleton of skeletons) skeleton.dispose?.();
  for (const geometry of geometries) geometry.dispose();
}

let nextModelGeneration = 0;

export function createArtworkSource({
  root,
  data: initialData,
  AFRAME,
  resources,
  onError,
  maxImageSize = 2048,
}: Options) {
  const THREE = AFRAME?.THREE;
  const registry =
    resources || createResourceRegistry((root as any).sceneEl, THREE);
  let data = initialData,
    resident = false,
    disposed = false,
    generation = 0;
  let source: ReturnType<typeof entity> | undefined;
  let cutout: ReturnType<typeof entity> | undefined;
  let cleanup: (() => void) | undefined;
  let imageMesh: any,
    measuredLocal: any,
    imageWidth = 0,
    imageHeight = 0;
  const placeholder = entity("a-plane", {
    class: "artwork-placeholder artwork-pick-target",
    color: "#18576d",
    material: "side: double",
  });
  root.append(placeholder);
  let proxyVisible = true;
  function syncProxy() {
    const object = placeholder.object3D, parent = (root as any).object3D;
    if (!object || !parent) return;
    object.visible = proxyVisible;
    if (proxyVisible || data.wall_element_type === "gaussian_splat") { if (object.parent !== parent) parent.add(object); }
    else object.removeFromParent();
  }
  function showPlaceholder(visible: boolean) {
    proxyVisible = visible;
    const pickable = visible || data.wall_element_type === "gaussian_splat";
    const changed = placeholder.classList.contains("artwork-pick-target") !== pickable;
    placeholder.classList.toggle("artwork-pick-target", pickable);
    placeholder.setAttribute("visible", String(visible));
    // Invisible A-Frame entities still incur matrix traversal; keep only the
    // pick proxy's DOM identity until its artwork is evicted again.
    syncProxy();
    if (changed) root.dispatchEvent(new CustomEvent("artwork-pick-target-changed", { bubbles: true }));
  }
  placeholder.addEventListener("loaded", syncProxy);

  function dimensions() {
    return {
      width: data.width || (data.wall_element_type === "image" ? 1 : 1.5),
      height: data.height || 1,
    };
  }
  function updateMetadata() {
    const { width, height } = dimensions();
    placeholder.setAttribute("width", String(width));
    placeholder.setAttribute("height", String(height));
    if (data.wall_element_type === "image" && THREE?.Box3)
      measuredLocal = new THREE.Box3(
        new THREE.Vector3(-width / 2, -height / 2, 0),
        new THREE.Vector3(width / 2, height / 2, 0),
      );
    if (data.wall_element_type === "gaussian_splat" && data.cutout_scale) {
      if (!cutout) {
        cutout = entity("a-box", { id: `cutout-${data.id}`, visible: false });
        root.append(cutout);
      }
      cutout.setAttribute("scale", String(data.cutout_scale));
      cutout.setAttribute("position", String(data.cutout_position || "0 0 0"));
    } else {
      cutout?.remove();
      cutout = undefined;
    }
    if (source && data.wall_element_type === "gltf")
      source.setAttribute("rotation", data.default_rotation || "0 0 0");
    if (imageMesh && (width !== imageWidth || height !== imageHeight)) {
      imageMesh.geometry.dispose();
      imageMesh.geometry = new THREE.PlaneGeometry(width, height);
      imageWidth = width;
      imageHeight = height;
    }
  }
  function measure() {
    const object = (root as any).object3D;
    if (!THREE?.Box3 || !object?.matrixWorld) return;
    object.updateWorldMatrix?.(true, false);
    const component = (root as any).components?.gaussian_splatting;
    const splatBounds = component?.boundingBox;
    if (splatBounds && !splatBounds.isEmpty())
      measuredLocal = splatBounds.clone();
    else if (
      !measuredLocal &&
      source?.object3D &&
      (imageMesh || source.getAttribute("data-loaded") === "true")
    ) {
      object.updateWorldMatrix?.(true, true);
      const determinant = object.matrixWorld.determinant();
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return;
      const bound = new THREE.Box3().setFromObject(source.object3D);
      if (!bound.isEmpty()) {
        bound.applyMatrix4(object.matrixWorld.clone().invert());
        if ([...bound.min.toArray(), ...bound.max.toArray()].every(Number.isFinite)) measuredLocal = bound;
      }
    }
  }
  function attach(
    node: ReturnType<typeof entity>,
    object: any,
    current: number,
  ) {
    const apply = () => {
      if (disposed || !resident || current !== generation) return;
      node.setObject3D?.("mesh", object);
      node.setAttribute("data-loaded", "true");
      showPlaceholder(false);
      measure();
    };
    // A cached resource can finish before a detached A-Frame entity initializes.
    node.addEventListener("loaded", apply, { once: true });
    if (node.object3D) apply();
    return () => node.removeEventListener("loaded", apply);
  }
  function report(message: string, current: number) {
    if (!disposed && resident && generation === current) onError?.(message);
  }
  function unload() {
    measure();
    generation++;
    cleanup?.();
    cleanup = undefined;
    imageMesh = undefined;
    source?.removeObject3D?.("mesh");
    source?.remove();
    source = undefined;
    root.removeAttribute("gaussian_splatting");
    showPlaceholder(true);
  }
  function load() {
    const current = ++generation;
    const kind = data.wall_element_type;
    const url = mediaUrl(
      kind === "image"
        ? data.image_url
        : kind === "gltf"
          ? data.gltf_url
          : data.splat_url,
    );
    if (!["image", "gltf", "gaussian_splat"].includes(kind) || !url) return;
    if (kind === "gaussian_splat") {
      if (!AFRAME?.components?.gaussian_splatting) {
        report(
          "Gaussian splat 렌더러를 불러오지 못했습니다. 작품 원본 링크에서 확인하세요.",
          current,
        );
        return;
      }
      root.setAttribute(
        "gaussian_splatting",
        `src: ${url}${cutout ? `; cutoutEntity: #${cutout.id}` : ""}`,
      );
      return;
    }
    source = entity("a-entity", {
      class: `artwork-source ${kind === "image" ? "image" : "gltf"}-source`,
      "data-source-url": url,
    });
    root.append(source);
    const node = source;
    if (kind === "image") {
      if (!THREE?.Texture || !THREE?.Mesh) return;
      let mesh: any, detach: (() => void) | undefined;
      const releaseImage = registry.acquireImage(
        url,
        maxImageSize,
        (texture) => {
          if (disposed || !resident || current !== generation) return;
          const { width, height } = dimensions();
          imageWidth = width;
          imageHeight = height;
          mesh = imageMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width, height),
            new THREE.MeshBasicMaterial({
              map: texture,
              side: THREE.DoubleSide,
              transparent: true,
            }),
          );
          detach = attach(node, mesh, current);
        },
        () => report("작품 이미지를 불러오지 못했습니다.", current),
      );
      cleanup = () => {
        detach?.();
        if (mesh) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        releaseImage();
      };
      return;
    }
    node.setAttribute("rotation", data.default_rotation || "0 0 0");
    if (!THREE?.GLTFLoader || !THREE?.LoadingManager) {
      report("3D 모델 로더를 불러오지 못했습니다.", current);
      return;
    }
    const manager = new THREE.LoadingManager();
    const ownedUrls = new Set<string>(),
      releases: (() => void)[] = [];
    const closedImages = new Set<any>();
    const namespace = `artwork-${++nextModelGeneration}`;
    let retired = false,
      gltf: any,
      detach: (() => void) | undefined;
    const clearCaches = () => {
      // A failed parse can still finish decoding images without returning a
      // graph. These URLs are generation-private, so no other artwork owns them.
      for (const owned of ownedUrls) {
        const image = THREE.Cache?.get(`image-bitmap:${owned}`);
        if (image?.close && !closedImages.has(image)) {
          closedImages.add(image);
          image.close();
        }
      }
      registry.retain(ownedUrls)();
    };
    manager.setURLModifier((value: string) => {
      // Isolate Three's global in-flight requests, so aborting this generation
      // cannot cancel another artwork's request for the same original URL.
      const resolved = new URL(value, location.href);
      resolved.hash = namespace;
      const owned = resolved.href;
      if (!ownedUrls.has(owned)) {
        ownedUrls.add(owned);
        const release = registry.retain([owned]);
        if (retired) release();
        else releases.push(release);
      }
      return owned;
    });
    manager.onLoad = () => {
      if (retired) clearCaches();
    };
    cleanup = () => {
      retired = true;
      detach?.();
      manager.abort?.();
      if (gltf) {
        disposeModel(gltf, closedImages);
        gltf = undefined;
      }
      clearCaches();
      for (const release of releases) release();
    };
    const failed = (error: Error) => {
      if (retired) clearCaches();
      else {
        report(`3D 모델: ${error?.message || "불러오지 못했습니다."}`, current);
        node.dispatchEvent(
          new CustomEvent("model-error", {
            bubbles: true,
            detail: { format: "gltf", src: url },
          }),
        );
        unload();
      }
    };
    const loader = new THREE.GLTFLoader(manager);
    const system = (root as any).sceneEl?.systems?.["gltf-model"];
    const draco = system?.getDRACOLoader?.(),
      ktx = system?.getKTX2Loader?.();
    if (draco) loader.setDRACOLoader(draco);
    if (ktx) {
      // Share transcoder workers, but fetch each model's texture through its
      // owning manager. The resulting buffers/textures remain dedicated.
      const ownedKtx = Object.create(ktx);
      ownedKtx.manager = manager;
      ownedKtx.parse = ktx.parse.bind(ktx);
      loader.setKTX2Loader(ownedKtx);
    }
    const start = () => {
      if (disposed || retired || current !== generation) return;
      try {
        loader.load(
          url,
          (result: any) => {
            if (disposed || !resident || current !== generation) {
              disposeModel(result, closedImages);
              clearCaches();
              return;
            }
            gltf = result;
            const model = result.scene || result.scenes?.[0];
            if (!model) {
              failed(new Error("모델의 장면을 찾지 못했습니다."));
              return;
            }
            model.animations = result.animations;
            detach = attach(node, model, current);
            node.dispatchEvent(
              new CustomEvent("model-loaded", {
                bubbles: true,
                detail: { format: "gltf", model },
              }),
            );
          },
          undefined,
          failed,
        );
      } catch (error) {
        failed(error as Error);
      }
    };
    const decoder = system?.getMeshoptDecoder?.();
    if (decoder)
      Promise.resolve(decoder).then((value) => {
        loader.setMeshoptDecoder(value);
        start();
      }, failed);
    else start();
  }
  const splatError = (event: Event) => {
    showPlaceholder(true);
    report(
      `Gaussian splat: ${(event as CustomEvent).detail?.message || "불러오지 못했습니다."}`,
      generation,
    );
  };
  const splatLoaded = () => { if (!disposed && resident) showPlaceholder(false); };
  root.addEventListener("splat-error", splatError);
  root.addEventListener("splat-loaded", splatLoaded);
  updateMetadata();
  return {
    setData(next: ElementDTO) {
      if (disposed) return;
      const changed =
        data.wall_element_type !== next.wall_element_type ||
        mediaUrl(data.image_url) !== mediaUrl(next.image_url) ||
        mediaUrl(data.gltf_url) !== mediaUrl(next.gltf_url) ||
        mediaUrl(data.splat_url) !== mediaUrl(next.splat_url);
      if (changed) {
        unload();
        measuredLocal = undefined;
      } else if (
        data.wall_element_type === "gltf" &&
        data.default_rotation !== next.default_rotation
      )
        measuredLocal = undefined;
      data = next;
      updateMetadata();
      if (resident && changed) load();
      else if (resident && data.wall_element_type === "gaussian_splat") {
        const url = mediaUrl(data.splat_url);
        if (url && AFRAME?.components?.gaussian_splatting)
          root.setAttribute(
            "gaussian_splatting",
            `src: ${url}${cutout ? `; cutoutEntity: #${cutout.id}` : ""}`,
          );
      }
    },
    setResident(next: boolean) {
      if (disposed || resident === next) return;
      resident = next;
      if (next) load();
      else unload();
    },
    setQuality(quality: { maxImageSize: number }) {
      const limit = Math.max(1, Math.floor(quality.maxImageSize));
      if (disposed || !Number.isFinite(limit) || limit === maxImageSize) return;
      maxImageSize = limit;
      if (resident && data.wall_element_type === "image") {
        unload();
        load();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resident = false;
      unload();
      root.removeEventListener("splat-error", splatError);
      root.removeEventListener("splat-loaded", splatLoaded);
      placeholder.removeEventListener("loaded", syncProxy);
      cutout?.remove();
      placeholder.remove();
      if (!resources) registry.dispose();
    },
    get resident() {
      return resident;
    },
    get bounds(): any {
      measure();
      const object = (root as any).object3D;
      return measuredLocal && object?.matrixWorld
        ? measuredLocal.clone().applyMatrix4(object.matrixWorld)
        : undefined;
    },
  };
}
