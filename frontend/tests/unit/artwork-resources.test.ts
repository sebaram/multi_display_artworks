import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ThreeMath from "../../src/wall-engine/reference/vendor/three.module.js";
import {
  createArtworkSource,
  createResourceRegistry,
} from "../../src/scene/artwork-resources";
const MathThree: any = ThreeMath;

// The browser supplies A-Frame/Three. Keep their scene graph and disposal effects
// observable here while controlling only external image/model completion.
class Disposable {
  disposed = 0;
  dispose() {
    this.disposed++;
  }
}
class Geometry extends Disposable {
  constructor(
    public width: number,
    public height: number,
  ) {
    super();
  }
}
class Texture extends Disposable {
  isTexture = true;
  needsUpdate = false;
  colorSpace = "";
  constructor(public image: any) {
    super();
  }
}
class Material extends Disposable {
  map?: Texture;
  constructor(options: any) {
    super();
    Object.assign(this, options);
  }
}
class Mesh {
  constructor(
    public geometry: Geometry,
    public material: Material | Material[],
  ) {}
}
class Manager {
  aborted = false;
  onLoad?: () => void;
  modifier = (url: string) => url;
  setURLModifier(modifier: (url: string) => string) {
    this.modifier = modifier;
  }
  resolveURL(url: string) {
    return this.modifier(url);
  }
  abort() {
    this.aborted = true;
  }
}
type Load = {
  url: string;
  manager: Manager;
  loader: Loader;
  complete: (gltf: any) => void;
  error: (error: Error) => void;
};
let loads: Load[], images: HTMLImageElement[], cache: Record<string, any>;
class Loader {
  draco: any;
  ktx: any;
  meshopt: any;
  constructor(private manager: Manager) {}
  setDRACOLoader(value: any) {
    this.draco = value;
    return this;
  }
  setKTX2Loader(value: any) {
    this.ktx = value;
    return this;
  }
  setMeshoptDecoder(value: any) {
    this.meshopt = value;
    return this;
  }
  load(
    url: string,
    complete: Load["complete"],
    _progress: unknown,
    error: Load["error"],
  ) {
    loads.push({
      url: this.manager.resolveURL(url),
      manager: this.manager,
      loader: this,
      complete,
      error,
    });
  }
}
const THREE = {
  PlaneGeometry: Geometry,
  Texture,
  MeshBasicMaterial: Material,
  Mesh,
  DoubleSide: 2,
  SRGBColorSpace: "srgb",
  GLTFLoader: Loader,
  LoadingManager: Manager,
  Cache: {
    get: (key: string) => cache[key],
    remove: (key: string) => {
      delete cache[key];
    },
  },
};
const realAFRAME = {
  THREE: { ...MathThree, GLTFLoader: Loader, LoadingManager: Manager },
  components: { gaussian_splatting: {} },
};
const AFRAME = { THREE, components: { gaussian_splatting: {} } };
const data = (patch: Record<string, unknown> = {}) => ({
  id: "artwork",
  wall: "wall",
  wall_element_type: "image",
  image_url: "https://assets.test/large.png",
  width: 2,
  height: 1,
  ...patch,
});
const root = () => {
  const el = document.createElement("a-entity");
  document.body.append(el);
  return el;
};
const attached = (el: Element | null) => (el as any)?.object3DMap?.mesh;

it("keeps singular model bounds unknown and measures them after scale is restored", () => {
  const el = root(), object = (el as any).object3D;
  object.scale.z = 0;
  const source = createArtworkSource({root:el,data:data({wall_element_type:"gltf",gltf_url:"https://assets.test/model.glb"}),AFRAME:realAFRAME});
  source.setResident(true);
  const model = new MathThree.Group();
  model.add(new MathThree.Mesh(new MathThree.BoxGeometry(2,2,2),new MathThree.MeshBasicMaterial()));
  loads[0].complete({scene:model,scenes:[model]});
  expect(source.bounds).toBeUndefined();
  object.scale.z = 1;
  expect(source.bounds.min.toArray().every(Number.isFinite)).toBe(true);
  expect(source.bounds.max.z).toBeCloseTo(1);
  source.dispose();
});
function graph(meshes: Mesh[]) {
  return {
    traverse: (visit: (item: any) => void) => meshes.forEach(visit),
    parent: null,
  };
}
function completeImage(index = 0, width = 800, height = 400) {
  Object.defineProperties(images[index], {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  images[index].dispatchEvent(new Event("load"));
}
beforeEach(() => {
  loads = [];
  images = [];
  cache = {};
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        const image = document.createElement("img");
        images.push(image);
        return image;
      }
    },
  );
  Object.assign(HTMLElement.prototype, {
    setObject3D(this: any, key: string, object: any) {
      this.object3DMap ||= {};
      this.object3DMap[key] = object;
      if (object.isObject3D) this.object3D.add(object);
    },
    removeObject3D(this: any, key: string) {
      const object = this.object3DMap?.[key];
      if (object?.isObject3D) this.object3D.remove(object);
      delete this.object3DMap?.[key];
    },
  });
  Object.defineProperty(HTMLElement.prototype, "object3D", {
    configurable: true,
    get(this: any) {
      if (!this._object3D) {
        this._object3D = new MathThree.Group();
        const rotation = (this.getAttribute("rotation") || "0 0 0")
          .split(" ")
          .map(Number);
        this._object3D.rotation.set(
          ...rotation.map((value: number) => (value * Math.PI) / 180),
        );
        if (this.parentElement) this.parentElement.object3D.add(this._object3D);
      }
      return this._object3D;
    },
  });
});
afterEach(() => {
  delete (HTMLElement.prototype as any).setObject3D;
  delete (HTMLElement.prototype as any).removeObject3D;
  delete (HTMLElement.prototype as any).object3D;
  document.body.replaceChildren();
  delete (document.body as any)._object3D;
  delete (document.documentElement as any)._object3D;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("artwork resource ownership", () => {
  it("keeps identity and a pickable placeholder while intentionally unloaded", () => {
    const el = root();
    el.dataset.elementId = "artwork";
    const error = vi.fn();
    const source = createArtworkSource({
      root: el,
      data: data(),
      AFRAME,
      onError: error,
    });
    expect(source.resident).toBe(false);
    expect(images).toHaveLength(0);
    expect(el.querySelector(".artwork-placeholder")).not.toBeNull();
    source.dispose();
    source.dispose();
    expect(el.dataset.elementId).toBe("artwork");
    expect(el.children).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("releases an image GPU graph and ignores an image completion after eviction", () => {
    const el = root();
    const source = createArtworkSource({ root: el, data: data(), AFRAME });
    source.setResident(true);
    completeImage();
    const mesh = attached(el.querySelector(".image-source"));
    expect(mesh.geometry.width).toBe(2);
    expect(mesh.geometry.height).toBe(1);
    expect(mesh.material.map.image).toBe(images[0]);
    expect(mesh.material.map.colorSpace).toBe("srgb");
    source.setResident(false);
    expect(mesh.geometry.disposed).toBe(1);
    expect(mesh.material.disposed).toBe(1);
    expect(mesh.material.map.disposed).toBe(1);
    expect(el.querySelector(".image-source")).toBeNull();
    source.setResident(true);
    source.setResident(false);
    completeImage(1);
    expect(el.querySelector(".image-source")).toBeNull();
    expect(el.querySelector(".artwork-placeholder")).not.toBeNull();
    source.dispose();
  });

  it("bounds large display textures while preserving the original source URL", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
    } as any);
    const el = root();
    const source = createArtworkSource({
      root: el,
      data: data(),
      AFRAME,
      maxImageSize: 1024,
    });
    source.setResident(true);
    completeImage(0, 6000, 3000);
    const texture = attached(el.querySelector(".image-source")).material.map;
    expect(texture.image.width).toBe(1024);
    expect(texture.image.height).toBe(512);
    expect(
      el.querySelector(".image-source")?.getAttribute("data-source-url"),
    ).toBe("https://assets.test/large.png");
    expect(images[0].src).toBe("https://assets.test/large.png");
    source.dispose();
  });

  it("updates dimensions without reloading an unchanged image and guards replaced sources", () => {
    const el = root();
    const error = vi.fn();
    const source = createArtworkSource({
      root: el,
      data: data(),
      AFRAME,
      onError: error,
    });
    source.setResident(true);
    source.setData(data({ width: 3 }));
    expect(images).toHaveLength(1);
    source.setData(
      data({ image_url: "https://assets.test/new.png", width: 3 }),
    );
    completeImage(0);
    expect(attached(el.querySelector(".image-source"))).toBeUndefined();
    completeImage(1);
    expect(attached(el.querySelector(".image-source")).geometry.width).toBe(3);
    expect(attached(el.querySelector(".image-source")).material.map.image).toBe(
      images[1],
    );
    images[0].dispatchEvent(new Event("error"));
    expect(error).not.toHaveBeenCalled();
    source.dispose();
  });

  it("keeps the placeholder during load errors and hides it only after a successful image attach", () => {
    const el = root(),
      error = vi.fn();
    const source = createArtworkSource({
      root: el,
      data: data(),
      AFRAME,
      onError: error,
    });
    source.setResident(true);
    images[0].dispatchEvent(new Event("error"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(
      el.querySelector(".artwork-placeholder")?.getAttribute("visible"),
    ).not.toBe("false");
    source.setData(data({ image_url: "https://assets.test/retry.png" }));
    completeImage(1);
    expect(
      el.querySelector(".artwork-placeholder")?.getAttribute("visible"),
    ).toBe("false");
    const geometry = attached(el.querySelector(".image-source")).geometry;
    source.setData(
      data({ image_url: "https://assets.test/retry.png", position_x: 5 }),
    );
    expect(geometry.disposed).toBe(0);
    source.setResident(false);
    expect(
      el.querySelector(".artwork-placeholder")?.getAttribute("visible"),
    ).toBe("true");
    source.dispose();
  });

  it("shares one display texture for repeated image URLs and preserves it until the last artwork unloads", () => {
    const a = root(),
      b = root(),
      resources = createResourceRegistry({}, THREE);
    const first = createArtworkSource({
      root: a,
      data: data(),
      AFRAME,
      resources,
    });
    const second = createArtworkSource({
      root: b,
      data: data(),
      AFRAME,
      resources,
    });
    first.setResident(true);
    second.setResident(true);
    expect(images).toHaveLength(1);
    completeImage();
    const meshA = attached(a.querySelector(".image-source"));
    const meshB = attached(b.querySelector(".image-source"));
    expect(meshA).not.toBe(meshB);
    expect(meshA.material).not.toBe(meshB.material);
    expect(meshA.material.map).toBe(meshB.material.map);
    first.setResident(false);
    expect(meshA.geometry.disposed).toBe(1);
    expect(meshA.material.disposed).toBe(1);
    expect(meshB.material.map.disposed).toBe(0);
    expect(meshB.material.map.image.src).toBe("https://assets.test/large.png");
    second.setResident(false);
    expect(meshB.material.map.disposed).toBe(1);
    first.dispose();
    second.dispose();
    resources.dispose();
    expect(meshB.material.map.disposed).toBe(1);
  });

  it("removes canceled image subscribers while another copy is loading", () => {
    const a = root(),
      b = root(),
      resources = createResourceRegistry({}, THREE);
    const first = createArtworkSource({
      root: a,
      data: data(),
      AFRAME,
      resources,
    });
    const second = createArtworkSource({
      root: b,
      data: data(),
      AFRAME,
      resources,
    });
    first.setResident(true);
    second.setResident(true);
    first.setResident(false);
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe("https://assets.test/large.png");
    completeImage();
    expect(a.querySelector(".image-source")).toBeNull();
    expect(attached(b.querySelector(".image-source")).material.map.image).toBe(
      images[0],
    );
    second.setResident(false);
    expect(images[0].hasAttribute("src")).toBe(false);
    first.dispose();
    second.dispose();
    resources.dispose();
  });

  it("changes a resident image's texture cap without releasing a peer's shared texture", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
    } as any);
    const a = root(),
      b = root(),
      resources = createResourceRegistry({}, THREE);
    const first = createArtworkSource({
      root: a,
      data: data(),
      AFRAME,
      resources,
      maxImageSize: 1024,
    });
    const second = createArtworkSource({
      root: b,
      data: data(),
      AFRAME,
      resources,
      maxImageSize: 1024,
    });
    first.setResident(true);
    second.setResident(true);
    completeImage(0, 6000, 3000);
    const oldMap = attached(b.querySelector(".image-source")).material.map;
    first.setQuality({ maxImageSize: 512 });
    expect(images).toHaveLength(2);
    expect(oldMap.disposed).toBe(0);
    completeImage(1, 6000, 3000);
    const newMap = attached(a.querySelector(".image-source")).material.map;
    expect(newMap).not.toBe(oldMap);
    expect(newMap.image.width).toBe(512);
    expect(newMap.image.height).toBe(256);
    expect(oldMap.image.width).toBe(1024);
    first.setQuality({ maxImageSize: 512.9 });
    expect(images).toHaveLength(2);
    second.setResident(false);
    expect(oldMap.disposed).toBe(1);
    expect(newMap.disposed).toBe(0);
    first.dispose();
    second.dispose();
    resources.dispose();
    expect(newMap.disposed).toBe(1);
  });

  it("isolates duplicate model requests so evicting one does not abort the other", () => {
    const a = root(),
      b = root();
    const model = data({
      wall_element_type: "gltf",
      gltf_url: "https://assets.test/model.gltf#old",
      default_rotation: "0 90 0",
    });
    const first = createArtworkSource({ root: a, data: model, AFRAME });
    const second = createArtworkSource({ root: b, data: model, AFRAME });
    first.setResident(true);
    second.setResident(true);
    expect(loads[0].url).not.toBe(loads[1].url);
    expect(new URL(loads[0].url).pathname).toBe("/model.gltf");
    expect(a.querySelector(".gltf-source")?.getAttribute("rotation")).toBe(
      "0 90 0",
    );
    first.setResident(false);
    expect(loads[0].manager.aborted).toBe(true);
    expect(loads[1].manager.aborted).toBe(false);
    const live = graph([]);
    loads[1].complete({ scene: live, scenes: [live] });
    expect(attached(b.querySelector(".gltf-source"))).toBe(live);
    first.dispose();
    second.dispose();
  });

  it("disposes stale model graphs once and clears every owned external cache entry", () => {
    const el = root();
    const error = vi.fn();
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.gltf",
      }),
      AFRAME,
      onError: error,
    });
    source.setResident(true);
    const load = loads[0];
    const external = load.manager.resolveURL("https://assets.test/model.bin");
    cache[`file:${load.url}`] = new ArrayBuffer(32);
    cache[`file:${external}`] = new ArrayBuffer(32);
    cache["file:https://assets.test/unrelated.bin"] = "keep";
    const geometry = new Geometry(1, 1);
    const bitmap = { close: vi.fn() };
    const texture = new Texture(bitmap);
    const material = new Material({ map: texture, normalMap: texture });
    const model = graph([
      new Mesh(geometry, material),
      new Mesh(geometry, [material]),
    ]);
    source.setResident(false);
    loads[0].complete({ scene: model, scenes: [model] });
    expect(el.querySelector(".gltf-source")).toBeNull();
    expect(geometry.disposed).toBe(1);
    expect(material.disposed).toBe(1);
    expect(texture.disposed).toBe(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(cache).toEqual({ "file:https://assets.test/unrelated.bin": "keep" });
    loads[0].error(new Error("aborted"));
    expect(error).not.toHaveBeenCalled();
    source.dispose();
  });

  it("disposes current model ownership when its source changes", () => {
    const el = root();
    const original = data({
      wall_element_type: "gltf",
      gltf_url: "https://assets.test/model.glb",
    });
    const source = createArtworkSource({ root: el, data: original, AFRAME });
    source.setResident(true);
    const mesh = new Mesh(new Geometry(1, 1), new Material({}));
    const model = graph([mesh]);
    loads[0].complete({ scene: model, scenes: [model] });
    source.setData({ ...original, gltf_url: "https://assets.test/other.glb" });
    expect(mesh.geometry.disposed).toBe(1);
    expect((mesh.material as Material).disposed).toBe(1);
    expect(attached(el.querySelector(".gltf-source"))).toBeUndefined();
    expect(loads).toHaveLength(2);
    source.dispose();
  });

  it("releases dependencies discovered after cancellation, including a late decoded bitmap", () => {
    const el = root();
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.gltf",
      }),
      AFRAME,
    });
    source.setResident(true);
    source.setResident(false);
    const url = loads[0].manager.resolveURL("https://assets.test/late.png");
    const bitmap = { close: vi.fn() };
    cache[`image-bitmap:${url}`] = bitmap;
    loads[0].manager.onLoad?.();
    expect(cache).toEqual({});
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    source.dispose();
  });

  it("keeps splat cutouts stable across source changes and residency transitions", () => {
    const el = root();
    const original = data({
      wall_element_type: "gaussian_splat",
      splat_url: "https://assets.test/a.splat",
      cutout_scale: "0.3 0.4 0.5",
      cutout_position: "0.1 0 0",
    });
    const source = createArtworkSource({ root: el, data: original, AFRAME });
    const cutout = el.querySelector("#cutout-artwork");
    source.setResident(true);
    expect(el.getAttribute("gaussian_splatting")).toBe(
      "src: https://assets.test/a.splat; cutoutEntity: #cutout-artwork",
    );
    source.setResident(false);
    expect(el.hasAttribute("gaussian_splatting")).toBe(false);
    source.setData({ ...original, splat_url: "https://assets.test/b.splat" });
    source.setResident(true);
    expect(el.getAttribute("gaussian_splatting")).toContain("b.splat");
    expect(el.querySelector("#cutout-artwork")).toBe(cutout);
    expect(cutout?.getAttribute("position")).toBe("0.1 0 0");
    source.dispose();
  });

  it("knows an unloaded image's bounds without loading its texture", () => {
    const el = root();
    (el as any).object3D.position.set(10, 0, -4);
    const source = createArtworkSource({
      root: el,
      data: data(),
      AFRAME: realAFRAME,
    });
    expect(source.bounds?.min.toArray()).toEqual([9, -0.5, -4]);
    expect(source.bounds?.max.toArray()).toEqual([11, 0.5, -4]);
    expect(images).toHaveLength(0);
    source.setData(data({ width: 4, height: 2 }));
    expect(source.bounds?.min.toArray()).toEqual([8, -1, -4]);
    source.dispose();
  });

  it("retains measured model bounds after unload and follows parent movement and nonuniform scale", () => {
    const el = root(),
      object = (el as any).object3D;
    object.position.set(10, 0, 0);
    object.scale.set(2, 1, 1);
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.glb",
        default_rotation: "0 90 0",
      }),
      AFRAME: realAFRAME,
    });
    expect(source.bounds).toBeUndefined();
    source.setResident(true);
    const model = new MathThree.Group();
    const mesh = new MathThree.Mesh(
      new MathThree.BoxGeometry(2, 4, 6),
      new MathThree.MeshBasicMaterial(),
    );
    mesh.position.x = 1;
    model.add(mesh);
    loads[0].complete({ scene: model, scenes: [model] });
    expect(source.bounds.min.x).toBeCloseTo(4);
    expect(source.bounds.max.x).toBeCloseTo(16);
    source.setResident(false);
    object.position.x = 20;
    object.scale.set(3, 2, 1);
    object.parent.position.z = 5;
    expect(source.bounds.min.x).toBeCloseTo(11);
    expect(source.bounds.max.x).toBeCloseTo(29);
    expect(source.bounds.min.y).toBeCloseTo(-4);
    expect(source.bounds.min.z).toBeCloseTo(3);
    expect(source.bounds.max.z).toBeCloseTo(5);
    source.dispose();
  });

  it("reuses measured local bounds while the root moves instead of walking the model each frame", () => {
    const el = root(),
      object = (el as any).object3D;
    const update = object.updateWorldMatrix;
    let descendantUpdates = 0;
    object.updateWorldMatrix = function (parents: boolean, children: boolean) {
      if (children) descendantUpdates++;
      return update.call(this, parents, children);
    };
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.glb",
      }),
      AFRAME: realAFRAME,
    });
    source.setResident(true);
    const model = new MathThree.Group();
    model.add(
      new MathThree.Mesh(
        new MathThree.BoxGeometry(2, 2, 2),
        new MathThree.MeshBasicMaterial(),
      ),
    );
    loads[0].complete({ scene: model, scenes: [model] });
    const measuredUpdates = descendantUpdates;
    for (let position = 1; position <= 10; position++) {
      object.position.x = position;
      expect(source.bounds.min.x).toBeCloseTo(position - 1);
    }
    expect(descendantUpdates).toBe(measuredUpdates);
    source.dispose();
  });

  it("preserves configured model decoders, animation metadata and model-loaded events", async () => {
    const el = root();
    const draco = {},
      meshopt = {},
      ktx = { parse() {}, manager: {} };
    (el as any).sceneEl = {
      systems: {
        "gltf-model": {
          getDRACOLoader: () => draco,
          getKTX2Loader: () => ktx,
          getMeshoptDecoder: () => Promise.resolve(meshopt),
        },
      },
    };
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.glb",
      }),
      AFRAME,
    });
    let loaded: any;
    el.addEventListener("model-loaded", ((event: CustomEvent) => {
      loaded = event.detail;
    }) as EventListener);
    source.setResident(true);
    await Promise.resolve();
    expect(loads[0].loader.draco).toBe(draco);
    expect(loads[0].loader.meshopt).toBe(meshopt);
    expect(loads[0].loader.ktx.manager).toBe(loads[0].manager);
    expect(ktx.manager).not.toBe(loads[0].manager);
    const model = graph([]),
      animations = [{ name: "walk" }];
    loads[0].complete({ scene: model, scenes: [model], animations });
    expect((model as any).animations).toBe(animations);
    expect(loaded).toEqual({ format: "gltf", model });
    source.dispose();
  });

  it("does not start a model request if evicted while its decoder is getting ready", async () => {
    const el = root();
    let ready!: (value: object) => void;
    (el as any).sceneEl = {
      systems: {
        "gltf-model": {
          getMeshoptDecoder: () =>
            new Promise((resolve) => {
              ready = resolve;
            }),
        },
      },
    };
    const source = createArtworkSource({
      root: el,
      data: data({
        wall_element_type: "gltf",
        gltf_url: "https://assets.test/model.glb",
      }),
      AFRAME,
    });
    source.setResident(true);
    source.setResident(false);
    ready({});
    await Promise.resolve();
    expect(loads).toHaveLength(0);
    source.dispose();
  });
});

it("releases shared URL caches only after the last owner, without clearing unrelated entries", () => {
  const scene = {
    systems: {
      material: {
        sourceCache: {} as Record<string, any>,
        hash: (url: string) => url,
      },
    },
  };
  const registry = createResourceRegistry(scene, THREE);
  const releaseA = registry.retain(["https://assets.test/shared.png"]);
  const releaseB = registry.retain(["https://assets.test/shared.png"]);
  cache["image:https://assets.test/shared.png"] = "image";
  cache["file:https://assets.test/unrelated.glb"] = "keep";
  scene.systems.material.sourceCache["https://assets.test/shared.png"] =
    Promise.resolve("image");
  releaseA();
  releaseA();
  expect(cache["image:https://assets.test/shared.png"]).toBe("image");
  expect(
    scene.systems.material.sourceCache["https://assets.test/shared.png"],
  ).toBeDefined();
  releaseB();
  expect(cache).toEqual({ "file:https://assets.test/unrelated.glb": "keep" });
  expect(scene.systems.material.sourceCache).toEqual({});
  registry.dispose();
  registry.dispose();
});
