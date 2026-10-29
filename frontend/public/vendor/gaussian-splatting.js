import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatAccumulator, releaseSplatWorkerPool } from "./spark-2.4.0.module.js";

// Spark and A-Frame share the same Three classes and WebGL renderer.
const THREE = AFRAME.THREE;
const SYSTEM = "gaussian-splatting-system";
const MAX_STD_DEV = Math.sqrt(8);
const disposedMeshes = new WeakSet();
const meshGenerators = new WeakMap();

function disposeMesh(mesh) {
  if (!mesh || disposedMeshes.has(mesh)) return;
  disposedMeshes.add(mesh);
  mesh.removeFromParent();
  // Spark 2.4's SplatMesh.dispose does not release its compiled edit texture.
  mesh.rgbaDisplaceEdits?.sdfTexture?.dispose();
  // Spark caches compute materials independently of SplatMesh.dispose.
  for (const generator of meshGenerators.get(mesh) || []) {
    SplatAccumulator.generatorProgram.get(generator)?.prepareMaterial().dispose();
    SplatAccumulator.generatorProgram.delete(generator);
  }
  meshGenerators.delete(mesh);
  mesh.dispose();
}

function sourceBounds(source, mesh) {
  const box = new THREE.Box3();
  const low = new THREE.Vector3(), high = new THREE.Vector3();
  let valid = true;
  source.forEachSplat((_index, center, scales) => {
    // A sphere with the largest Gaussian axis encloses every rotation, including
    // nonuniform parent transforms applied later by the residency controller.
    const radius = MAX_STD_DEV * Math.max(Math.abs(scales.x), Math.abs(scales.y), Math.abs(scales.z));
    if (![center.x, center.y, center.z, radius].every(Number.isFinite)) { valid = false; return; }
    box.expandByPoint(low.copy(center).addScalar(-radius));
    box.expandByPoint(high.copy(center).addScalar(radius));
  });
  mesh.updateMatrix();
  return valid && !box.isEmpty() ? box.applyMatrix4(mesh.matrix) : undefined;
}

AFRAME.registerComponent(SYSTEM, {
  init() {
    this.members = new Set();
    this.renderer = null;
    this.disposed = false;
    this.budget = this.el.galleryPerformance?.settings?.splatBudget || 1500000;
    Object.defineProperty(this, "statistics", { get: () => ({
      meshes: this.members.size,
      loadedVertexCount: [...this.members].reduce((sum, component) => sum + component.loadedVertexCount, 0),
      activeSplats: this.renderer?.activeSplats || 0,
      budget: this.budget,
    }) });
  },
  setBudget(count) {
    if (!Number.isFinite(count) || count <= 0) return;
    this.budget = Math.floor(count);
    if (this.renderer && this.renderer.lodSplatCount !== this.budget) {
      this.renderer.lodSplatCount = this.budget;
      this.renderer.setDirty();
    }
  },
  acquire(component) {
    if (this.disposed) throw new Error("Splat scene has been removed");
    if (!this.renderer) {
      this.renderer = new SparkRenderer({
        renderer: this.el.renderer,
        covSplats: true,
        accumExtSplats: true,
        lodSplatCount: this.budget,
        minSortIntervalMs: 33,
        maxStdDev: MAX_STD_DEV,
        lodCleanupTimeoutMs: 0,
        // Artwork selection uses its persistent proxy; no splat raycast tree.
        lodRaycast: 0,
      });
      this.el.object3D.add(this.renderer);
    }
    this.members.add(component);
  },
  release(component) {
    this.members.delete(component);
    if (!this.members.size && this.renderer) {
      this.renderer.removeFromParent();
      this.renderer.dispose();
      this.renderer = null;
      releaseSplatWorkerPool();
    }
  },
  remove() {
    if (this.disposed) return;
    this.disposed = true;
    for (const component of [...this.members]) component.remove();
  },
});

AFRAME.registerComponent("gaussian_splatting", {
  schema: {
    src: { type: "string", default: "train.splat" },
    cutoutEntity: { type: "selector" },
    // Retained for saved markup. Scene-wide quality belongs to render policy.
    pixelRatio: { type: "number", default: 1 },
    xrPixelRatio: { type: "number", default: 0.5 },
  },
  init() {
    this.disposed = false;
    this.loadedVertexCount = 0;
    this.splatMesh = null;
    this.start = () => {
      if (this.disposed || this.started) return;
      this.started = true;
      this.el.sceneEl.removeEventListener("loaded", this.start);
      this.loadSource();
    };
    this.el.sceneEl.addEventListener("loaded", this.start);
    if (this.el.sceneEl.hasLoaded) this.start();
  },
  update(previous) {
    if (!this.started || this.disposed || !previous) return;
    if (previous.src !== undefined && previous.src !== this.data.src) {
      this.unload();
      this.boundingBox = undefined;
      this.loadSource();
    } else if (previous.cutoutEntity !== this.data.cutoutEntity && this.splatMesh) {
      this.updateCutout();
    }
  },
  async loadSource() {
    const token = { controller: new AbortController(), cancelled: false, mesh: null };
    this.loadToken = token;
    const src = this.data.src;
    const scene = this.el.sceneEl;
    try {
      if (!scene.components[SYSTEM]) scene.setAttribute(SYSTEM, "");
      this.system = scene.components[SYSTEM];
      this.system.acquire(this);
      const response = await fetch(src, { signal: token.controller.signal });
      if (!response.ok) throw new Error(`Splat download failed (${response.status})`);
      const fileBytes = await response.arrayBuffer();
      if (token.cancelled) return;
      const generators = new Set();
      const mesh = token.mesh = new SplatMesh({
        fileBytes, fileName: src,
        extSplats: true, covSplats: true, lod: true, nonLod: true,
        raycastable: false,
        onFrame: ({ mesh }) => {
          if (mesh.generator) generators.add(mesh.generator);
          if (mesh.covGenerator) generators.add(mesh.covGenerator);
        },
      });
      meshGenerators.set(mesh, generators);
      mesh.rotation.x = Math.PI;
      await mesh.initialized;
      if (token.cancelled) { disposeMesh(mesh); return; }
      const full = mesh.extSplats;
      const source = full.getNumSplats() ? full : full.lodSplats;
      this.loadedVertexCount = source?.getNumSplats() || 0;
      this.boundingBox = source ? sourceBounds(source, mesh) : undefined;
      // Keep the hierarchy, release the original full-resolution buffers after
      // measuring every source splat. Bounds never depend on selected LOD points.
      if (full.lodSplats && full.getNumSplats()) {
        const lodSplats = full.lodSplats;
        full.lodSplats = undefined;
        full.dispose();
        full.reinitialize({ lodSplats });
      }
      this.splatMesh = mesh;
      this.updateCutout();
      this.el.object3D.add(mesh);
      this.el.emit("splat-loaded", { src, loadedVertexCount: this.loadedVertexCount }, false);
    } catch (error) {
      disposeMesh(token.mesh);
      if (!token.cancelled && !this.disposed) {
        this.unload();
        this.el.emit("splat-error", { src, message: String(error?.message || error) }, false);
      }
    } finally {
      if (token.cancelled) releaseSplatWorkerPool();
    }
  },
  updateCutout() {
    this.cutoutSdf?.removeFromParent();
    this.cutoutSdf = null;
    const mesh = this.splatMesh;
    if (!mesh) return;
    const cutout = this.data.cutoutEntity?.object3D;
    if (cutout) {
      const sdf = this.cutoutSdf = new SplatEditSdf({
        type: SplatEditSdfType.BOX, opacity: 0, invert: true,
      });
      sdf.scale.setScalar(0.5);
      cutout.add(sdf);
      mesh.edits = [new SplatEdit({ sdfs: [sdf] })];
    } else mesh.edits = [];
    mesh.updateGenerator();
  },
  unload() {
    if (this.loadToken) {
      this.loadToken.cancelled = true;
      this.loadToken.controller.abort();
    }
    this.cutoutSdf?.removeFromParent();
    this.cutoutSdf = null;
    disposeMesh(this.splatMesh);
    this.splatMesh = null;
    this.loadedVertexCount = 0;
    this.system?.release(this);
  },
  remove() {
    if (this.disposed) return;
    this.disposed = true;
    this.el.sceneEl.removeEventListener("loaded", this.start);
    this.unload();
  },
});
