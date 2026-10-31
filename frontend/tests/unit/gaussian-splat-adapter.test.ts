import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ThreeMath from "../../src/wall-engine/reference/vendor/three.core.js";

const THREE: any = ThreeMath;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let definitions: Record<string, any>,
  meshes: Mesh[],
  renderers: Renderer[],
  requests: any[];
let samples: { center: number[]; scales: number[] }[],
  computePrograms: WeakMap<object, any>;

// WebGL and decoder completion are external; actual Three scene graphs and bounds
// math remain real so transform, ownership and late-attachment bugs are visible.
class Source {
  disposed = 0;
  lodSplats: any = { dispose: vi.fn() };
  constructor(public points = samples) {}
  getNumSplats() {
    return this.points.length;
  }
  forEachSplat(visit: (...args: any[]) => void) {
    this.points.forEach((point, index) =>
      visit(
        index,
        new THREE.Vector3(...point.center),
        new THREE.Vector3(...point.scales),
      ),
    );
  }
  dispose() {
    this.disposed++;
    this.points = [];
    this.lodSplats?.dispose();
    this.lodSplats = undefined;
  }
  reinitialize(options: any) {
    this.lodSplats = options.lodSplats;
  }
}
class Mesh extends THREE.Object3D {
  done = deferred<Mesh>();
  initialized = this.done.promise;
  extSplats = new Source();
  splats = this.extSplats;
  edits: any[] = [];
  rgbaDisplaceEdits = { sdfTexture: { dispose: vi.fn() } };
  disposed = 0;
  updateGenerator = vi.fn();
  constructor(public options: any) {
    super();
    meshes.push(this);
  }
  dispose() {
    this.disposed++;
    this.extSplats.dispose();
  }
}
class Renderer extends THREE.Object3D {
  disposed = 0;
  activeSplats = 0;
  lodSplatCount: number;
  setDirty = vi.fn();
  constructor(public options: any) {
    super();
    this.lodSplatCount = options.lodSplatCount;
    renderers.push(this);
  }
  dispose() {
    this.disposed++;
  }
}
class Sdf extends THREE.Object3D {
  constructor(public options: any) {
    super();
    Object.assign(this, options);
  }
}
class Edit {
  constructor(public options: any) {
    Object.assign(this, options);
  }
}
function scene(loaded = true) {
  const node: any = new EventTarget();
  Object.assign(node, {
    object3D: new THREE.Scene(),
    components: {},
    hasLoaded: loaded,
    renderer: {
      setPixelRatio: vi.fn(),
      xr: { setFramebufferScaleFactor: vi.fn() },
    },
    galleryPerformance: { settings: { splatBudget: 500000 } },
    setAttribute: (name: string) => {
      if (!node.components[name] && definitions[name]) {
        const instance = Object.assign(Object.create(definitions[name]), {
          el: node,
        });
        node.components[name] = instance;
        instance.init?.();
      }
    },
  });
  return node;
}
function component(owner = scene(), data: Record<string, any> = {}) {
  const el: any = new EventTarget();
  Object.assign(el, {
    sceneEl: owner,
    object3D: new THREE.Object3D(),
    emit: vi.fn(),
  });
  owner.object3D.add(el.object3D);
  const instance = Object.assign(
    Object.create(definitions.gaussian_splatting),
    {
      el,
      data: {
        src: "/first.splat",
        cutoutEntity: null,
        pixelRatio: 2,
        xrPixelRatio: 0.5,
        ...data,
      },
    },
  );
  instance.init();
  return instance;
}
function binarySamples(points = samples) {
  const bytes = new ArrayBuffer(points.length * 32);
  const view = new DataView(bytes);
  points.forEach((point, index) => {
    [...point.center, ...point.scales].forEach((value, field) =>
      view.setFloat32(index * 32 + field * 4, value, true),
    );
    new Uint8Array(bytes, index * 32 + 24, 8).set([
      255, 255, 255, 255, 255, 128, 128, 128,
    ]);
  });
  return bytes;
}
async function download(index = 0, bytes = binarySamples()) {
  requests[index].done.resolve({
    ok: true,
    arrayBuffer: async () => bytes,
  });
  await settle();
}
async function initialize(index = 0) {
  await download(index);
  meshes[index].done.resolve(meshes[index]);
  await settle();
}

beforeEach(() => {
  definitions = {};
  meshes = [];
  renderers = [];
  requests = [];
  computePrograms = new WeakMap();
  samples = [
    { center: [2, 3, 4], scales: [1, 0.5, 0.25] },
    { center: [-10, -8, -6], scales: [0.5, 0.5, 0.5] },
  ];
  const Spark = {
    SparkRenderer: Renderer,
    SplatMesh: Mesh,
    SplatEditSdf: Sdf,
    SplatEdit: Edit,
    SplatEditSdfType: { BOX: "box" },
    SplatAccumulator: { generatorProgram: computePrograms },
    releaseSplatWorkerPool: vi.fn(),
    getSplatFileType: (bytes: Uint8Array) =>
      bytes[0] === 112 && bytes[1] === 108 && bytes[2] === 121
        ? "ply"
        : undefined,
  };
  const source = readFileSync(
    "public/vendor/gaussian-splatting.js",
    "utf8",
  ).replace(/^import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];?\s*/m, "");
  runInNewContext(source, {
    ...Spark,
    AFRAME: {
      THREE,
      registerComponent: (name: string, definition: any) => {
        definitions[name] = definition;
      },
    },
    AbortController,
    fetch: (url: string, options: any) => {
      const done = deferred<any>();
      requests.push({ url, options, done });
      return done.promise;
    },
    console,
    URL,
    Math,
    Set,
    WeakSet,
    Number,
    Error,
  });
});

describe("shared Gaussian splat adapter", () => {
  it("registers the scene-owned renderer component for aggregate quality controls", () => {
    expect(definitions["gaussian-splatting-system"]).toBeDefined();
  });

  it("aborts a waiting download and ignores its late completion after removal", async () => {
    const c = component();
    c.remove();
    expect(requests[0].options.signal.aborted).toBe(true);
    await download();
    expect(meshes).toHaveLength(0);
    expect(c.el.object3D.children).toHaveLength(0);
    expect(c.el.emit).not.toHaveBeenCalled();
  });

  it("waits for the owning scene and cancels its pending start listener", async () => {
    const s = scene(false),
      c = component(s);
    c.remove();
    s.hasLoaded = true;
    s.dispatchEvent(new Event("loaded"));
    await settle();
    expect(requests).toHaveLength(0);
    expect(renderers).toHaveLength(0);
  });

  it("shares one aggregate budget and releases the renderer only after the last user", async () => {
    const s = scene(),
      first = component(s),
      second = component(s);
    await initialize(0);
    await initialize(1);
    const system = s.components["gaussian-splatting-system"];
    expect(renderers).toHaveLength(1);
    expect(system.renderer).toBe(renderers[0]);
    expect(renderers[0].lodSplatCount).toBe(500000);
    expect(system.statistics.meshes).toBe(2);
    expect(system.statistics.loadedVertexCount).toBe(4);
    system.setBudget(175000);
    expect(renderers[0].lodSplatCount).toBe(175000);
    expect(system.statistics.budget).toBe(175000);
    first.remove();
    first.remove();
    expect(renderers[0].disposed).toBe(0);
    expect(system.statistics.meshes).toBe(1);
    second.remove();
    expect(renderers[0].disposed).toBe(1);
    expect(system.statistics.meshes).toBe(0);
    expect(system.renderer).toBeNull();
    expect(s.renderer.setPixelRatio).not.toHaveBeenCalled();
    expect(s.renderer.xr.setFramebufferScaleFactor).not.toHaveBeenCalled();
  });

  it("does not attach a stale decoded mesh and disposes its cutout texture once", async () => {
    const c = component();
    await download();
    const mesh = meshes[0];
    c.remove();
    mesh.done.resolve(mesh);
    await settle();
    expect(c.el.object3D.children).toHaveLength(0);
    expect(c.splatMesh).toBeFalsy();
    expect(mesh.disposed).toBe(1);
    expect(mesh.rgbaDisplaceEdits.sdfTexture.dispose).toHaveBeenCalledTimes(1);
    expect(c.el.emit).not.toHaveBeenCalled();
  });

  it("releases every compute material used by successive mesh generator versions", async () => {
    const c = component();
    await initialize();
    const mesh = meshes[0],
      first = {},
      second = {};
    const material1 = { dispose: vi.fn() },
      material2 = { dispose: vi.fn() };
    computePrograms.set(first, { prepareMaterial: () => material1 });
    computePrograms.set(second, { prepareMaterial: () => material2 });
    Object.assign(mesh, { covGenerator: first });
    mesh.options.onFrame?.({ mesh });
    Object.assign(mesh, { covGenerator: second });
    mesh.options.onFrame?.({ mesh });
    c.remove();
    c.remove();
    expect(material1.dispose).toHaveBeenCalledTimes(1);
    expect(material2.dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces a source without allowing the old asynchronous decode to win", async () => {
    const c = component();
    await download();
    const oldMesh = meshes[0],
      previous = { ...c.data };
    c.data.src = "/replacement.splat";
    c.update(previous);
    await initialize(1);
    oldMesh.done.resolve(oldMesh);
    await settle();
    expect(requests[0].options.signal.aborted).toBe(true);
    expect(c.splatMesh).toBe(meshes[1]);
    expect(c.el.object3D.children).toEqual([meshes[1]]);
    expect(oldMesh.disposed).toBe(1);
    c.remove();
  });

  it("retains all-source Gaussian bounds in artwork-local coordinates and legacy orientation", async () => {
    const c = component();
    c.el.object3D.scale.set(2, 0.5, 3);
    c.el.object3D.rotation.set(0.1, 0.2, 0.3);
    await initialize();
    expect(c.loadedVertexCount).toBe(2);
    expect(c.splatMesh.rotation.x).toBe(Math.PI);
    expect(c.el.object3D.scale.toArray()).toEqual([2, 0.5, 3]);
    expect(c.splatMesh.options).toMatchObject({
      extSplats: true,
      covSplats: true,
      lod: true,
      nonLod: true,
      fileName: "/first.splat",
    });
    expect(c.boundingBox.min.x).toBeCloseTo(-11.4707821);
    expect(c.boundingBox.min.y).toBeCloseTo(-5.94156421);
    expect(c.boundingBox.min.z).toBeCloseTo(-6.94156421);
    expect(c.boundingBox.max.x).toBeCloseTo(4.94156421);
    expect(c.boundingBox.max.y).toBeCloseTo(9.4707821);
    expect(c.boundingBox.max.z).toBeCloseTo(7.4707821);
    // Full source buffers can be released after bounds/count are measured.
    expect(c.splatMesh.extSplats.getNumSplats()).toBe(0);
    expect(c.splatMesh.extSplats.lodSplats).toBeTruthy();
    c.remove();
  });

  it("measures a legacy binary's Gaussian extent without unpacking decoded splats", async () => {
    const c = component(scene(), { src: "/legacy.SPLAT?version=2#asset" });
    c.el.object3D.scale.set(2, 0.5, 3);
    await download();
    const mesh = meshes[0];
    const unpack = vi
      .spyOn(mesh.extSplats, "forEachSplat")
      .mockImplementation(() => {
        throw new Error("Legacy bounds must not unpack Spark splats");
      });
    mesh.done.resolve(mesh);
    await settle();
    expect(c.splatMesh).toBe(mesh);
    expect(c.loadedVertexCount).toBe(2);
    expect(c.boundingBox.min.x).toBeCloseTo(-11.4707821);
    expect(c.boundingBox.min.y).toBeCloseTo(-5.94156421);
    expect(c.boundingBox.min.z).toBeCloseTo(-6.94156421);
    expect(c.boundingBox.max.x).toBeCloseTo(4.94156421);
    expect(c.boundingBox.max.y).toBeCloseTo(9.4707821);
    expect(c.boundingBox.max.z).toBeCloseTo(7.4707821);
    expect(c.el.object3D.scale.toArray()).toEqual([2, 0.5, 3]);
    expect(unpack).not.toHaveBeenCalled();
    c.remove();
  });

  it.each(["/cloud.ply", "/cloud.spz", "/download?id=raw.splat"])(
    "keeps decoded all-source bounds for the non-legacy URL %s",
    async (src) => {
      const c = component(scene(), { src });
      await download();
      const unpack = vi.spyOn(meshes[0].extSplats, "forEachSplat");
      meshes[0].done.resolve(meshes[0]);
      await settle();
      expect(unpack).toHaveBeenCalledTimes(1);
      expect(c.loadedVertexCount).toBe(2);
      expect(c.boundingBox.min.x).toBeCloseTo(-11.41421356);
      c.remove();
    },
  );

  it("encloses scales rounded upward by Spark's half-float logarithmic encoding", async () => {
    samples = [
      { center: [0, 0, 0], scales: [Math.fround(Math.exp(-80.03)), 0, 0] },
    ];
    const c = component();
    await initialize();
    // At this magnitude a half-float logarithm rounds -80.03 to -80.
    expect(c.boundingBox.max.x).toBeGreaterThanOrEqual(
      Math.sqrt(8) * Math.exp(-80),
    );
    c.remove();
  });

  it("preserves signed Float32 centers with valid positive scales", async () => {
    samples = [{ center: [-2.5, 3.5, -4.5], scales: [1, 0.25, 0.5] }];
    const c = component();
    await initialize();
    expect(c.loadedVertexCount).toBe(1);
    expect(c.boundingBox.min.x).toBeLessThanOrEqual(-2.5 - Math.sqrt(8));
    expect(c.boundingBox.min.y).toBeLessThanOrEqual(-3.5 - Math.sqrt(8));
    expect(c.boundingBox.max.z).toBeGreaterThanOrEqual(4.5 + Math.sqrt(8));
    c.remove();
  });

  it.each([
    ["negative", -1, NaN],
    ["near Float32 maximum", Math.fround(3.39e38), Infinity],
  ])(
    "keeps bounds unknown when %s raw scales decode to a nonfinite extent",
    async (_label, rawScale, decodedScale) => {
      samples = [
        { center: [0, 0, 0], scales: [rawScale as number, 0.25, 0.5] },
      ];
      const bytes = binarySamples();
      // Match Spark's decoded invalid scale rather than hiding it behind the raw value.
      samples = [
        { center: [0, 0, 0], scales: [decodedScale as number, 0.25, 0.5] },
      ];
      const c = component();
      await download(0, bytes);
      const unpack = vi.spyOn(meshes[0].extSplats, "forEachSplat");
      meshes[0].done.resolve(meshes[0]);
      await settle();
      expect(unpack).toHaveBeenCalledTimes(1);
      expect(c.splatMesh).toBe(meshes[0]);
      expect(c.loadedVertexCount).toBe(1);
      expect(c.boundingBox).toBeUndefined();
      c.remove();
    },
  );

  it.each([
    "empty",
    "partial-record",
    "nonfinite-center",
    "nonfinite-scale",
    "wrong-count",
    "recognized-format",
  ])(
    "falls back to decoded source bounds for %s instead of trusting raw bytes",
    async (kind) => {
      const c = component();
      let bytes =
        kind === "empty"
          ? new ArrayBuffer(0)
          : kind === "partial-record"
            ? new ArrayBuffer(63)
            : kind === "wrong-count"
              ? binarySamples([...samples, samples[0]])
              : binarySamples();
      if (kind === "nonfinite-center")
        new DataView(bytes).setFloat32(0, NaN, true);
      if (kind === "nonfinite-scale")
        new DataView(bytes).setFloat32(12, Infinity, true);
      if (kind === "recognized-format")
        new Uint8Array(bytes, 0, 4).set([112, 108, 121, 10]);
      await download(0, bytes);
      const unpack = vi.spyOn(meshes[0].extSplats, "forEachSplat");
      meshes[0].done.resolve(meshes[0]);
      await settle();
      expect(unpack).toHaveBeenCalledTimes(1);
      expect(c.loadedVertexCount).toBe(2);
      expect(c.boundingBox.min.x).toBeCloseTo(-11.41421356);
      c.remove();
    },
  );

  it("keeps a local box cutout under its existing transform and removes only its own SDF", async () => {
    const cutoutEntity = { object3D: new THREE.Object3D() },
      c = component(scene(), { cutoutEntity });
    const existing = new THREE.Object3D();
    cutoutEntity.object3D.add(existing);
    cutoutEntity.object3D.scale.set(2, 4, 6);
    await initialize();
    const sdf = cutoutEntity.object3D.children[1];
    expect(sdf).toMatchObject({ type: "box", opacity: 0, invert: true });
    expect(sdf.scale.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(c.splatMesh.edits[0].sdfs).toEqual([sdf]);
    c.remove();
    expect(cutoutEntity.object3D.children).toEqual([existing]);
  });

  it("emits a scoped failure and releases its renderer lease", async () => {
    const c = component();
    requests[0].done.resolve({ ok: false, status: 404 });
    await settle();
    expect(c.el.emit).toHaveBeenCalledWith(
      "splat-error",
      expect.objectContaining({ src: "/first.splat" }),
      false,
    );
    expect(
      c.el.sceneEl.components["gaussian-splatting-system"].statistics.meshes,
    ).toBe(0);
    expect(c.splatMesh).toBeFalsy();
    c.remove();
  });

  it("tears down pending decodes when the scene is removed", async () => {
    const s = scene(),
      c = component(s);
    await download();
    const system = s.components["gaussian-splatting-system"];
    system.remove();
    meshes[0].done.resolve(meshes[0]);
    await settle();
    expect(c.splatMesh).toBeFalsy();
    expect(meshes[0].disposed).toBe(1);
    expect(renderers[0].disposed).toBe(1);
    expect(system.statistics.meshes).toBe(0);
  });
});
