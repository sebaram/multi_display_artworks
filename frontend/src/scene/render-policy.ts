type Device = { mobile: boolean; xr: boolean; dpr: number };

export function qualitySettings(device: Device, level: number) {
  const scale = [1, 0.85, 0.7][Math.max(0, Math.min(2, level))];
  const constrained = device.mobile || device.xr;
  return {
    pixelRatio: Math.min(constrained ? 1 : 1.5, device.dpr || 1) * scale,
    wallWidth: Math.round((constrained ? 768 : 1024) * scale / 64) * 64,
    splatBudget: Math.round((device.xr ? 350000 : device.mobile ? 500000 : 1500000) * scale * scale),
    maxImageSize: constrained ? 1024 : 2048,
    prefetch: constrained ? 4 : 12,
  };
}

/** Frame pacing, rather than advertised device names, controls gradual recovery. */
export function createQualityController() {
  let level = 0, start = 0, sum = 0, count = 0, slow = 0, fast = 0, changed = -Infinity;
  return {
    get level() { return level; },
    sample(now: number, frameMs: number, targetMs: number, visible: boolean) {
      if (!visible || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) {
        start = now; sum = count = slow = fast = 0; return level;
      }
      if (!count) start = now;
      sum += Math.min(frameMs, 100); count++;
      if (now - start < 1000) return level;
      const mean = sum / count;
      slow = mean > targetMs * 1.2 ? slow + 1 : 0;
      fast = mean < targetMs * 1.06 ? fast + 1 : 0;
      sum = count = 0;
      if (slow >= 3 && level < 2 && now - changed > 6000) {
        level++; changed = now; slow = fast = 0;
      } else if (fast >= 10 && level > 0 && now - changed > 10000) {
        level--; changed = now; slow = fast = 0;
      }
      return level;
    },
  };
}

type Candidate = { id: string; visible: boolean; near: boolean; distance: number; lastVisible: number; resident: boolean; pinned?: boolean };
export function selectResidents(entries: Candidate[], now: number, prefetch: number) {
  const result = new Set<string>();
  for (const entry of entries)
    if (entry.visible || entry.pinned || (entry.resident && now - entry.lastVisible < 4000)) result.add(entry.id);
  const nearby = entries.filter(entry => entry.near && !result.has(entry.id)).sort((a, b) => a.distance - b.distance);
  for (const entry of nearby.slice(0, prefetch)) result.add(entry.id);
  return result;
}

/** Bounds are transformed with their full parent chain. Unknown bounds fail open. */
export function createViewVisibility(THREE: any, scene: any) {
  let views: { frustum: any; expanded: any; position: any; projection: any }[] = [];
  const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere();
  function update() {
    const xr = scene.renderer?.xr?.isPresenting ? scene.renderer.xr : undefined;
    // XR eye matrices already include the camera entity/teleport rig transform.
    // Recomputing an eye's local matrix would discard that transform.
    if (xr && scene.camera) {
      scene.camera.parent?.updateWorldMatrix?.(true, false);
      xr.updateCamera?.(scene.camera);
    }
    const active = xr ? xr.getCamera() : scene.camera;
    const cameras = active?.isArrayCamera && active.cameras?.length ? active.cameras : active ? [active] : [];
    views = cameras.filter((camera: any) => camera.projectionMatrix && camera.matrixWorldInverse).map((camera: any) => {
      if (!xr) camera.updateWorldMatrix?.(true, false);
      const projection = camera.projectionMatrix.clone();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix.multiplyMatrices(projection, camera.matrixWorldInverse));
      projection.elements[0] /= 1.25; projection.elements[5] /= 1.25;
      const expanded = new THREE.Frustum().setFromProjectionMatrix(matrix.multiplyMatrices(projection, camera.matrixWorldInverse));
      return { frustum, expanded, position: new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), projection: camera.projectionMatrix };
    });
  }
  function objectSphere(object: any) {
    if (!object?.geometry) return undefined;
    object.updateWorldMatrix?.(true, false);
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere?.();
    return object.geometry.boundingSphere ? sphere.copy(object.geometry.boundingSphere).applyMatrix4(object.matrixWorld) : undefined;
  }
  return {
    update,
    intersects(object: any) {
      for (let node = object; node; node = node.parent) if (node.visible === false) return false;
      const bound = objectSphere(object);
      return !bound || !views.length || views.some(view => view.frustum.intersectsSphere(bound));
    },
    measure(box: any) {
      if (!box || box.isEmpty?.() || !views.length) return { visible: true, near: true, distance: 0, pixels: Infinity };
      box.getBoundingSphere(sphere);
      let distance = Infinity, pixels = 0;
      for (const view of views) {
        distance = Math.min(distance, box.distanceToPoint(view.position));
        const centerDistance = view.position.distanceTo(sphere.center);
        pixels = Math.max(pixels, sphere.radius * Math.abs(view.projection.elements[5]) * (scene.canvas?.clientHeight || 900) / Math.max(0.01, centerDistance - sphere.radius));
      }
      return { visible: views.some(view => view.expanded.intersectsBox(box)), near: distance < 8, distance, pixels };
    },
  };
}

/** A-Frame invokes component ticks in its own WebXR-aware animation loop. */
export function registerRenderScheduler(AFRAME: any) {
  if (AFRAME.components["gallery-render-work"]) return;
  AFRAME.registerComponent("gallery-render-work", {
    tick(this: any, time: number, delta: number) { this.el.galleryRenderWork?.(time, delta); },
  });
}
