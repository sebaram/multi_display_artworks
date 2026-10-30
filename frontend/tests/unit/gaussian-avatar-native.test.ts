import { describe, expect, it, vi } from "vitest";
import * as ThreeMath from "../../src/wall-engine/reference/vendor/three.core.js";
import {
  createNativeGaussianAvatar,
  computeFaceFrames,
  deformGaussian,
  parseBoundGaussianPly,
} from "../../public/vendor/gaussian-avatar-native.js";

const properties = [
  "x", "y", "z", "nx", "ny", "nz",
  ...Array.from({ length: 3 }, (_, i) => `f_dc_${i}`),
  ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`),
  "opacity", "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3", "binding_0",
];
function ply(changes: Record<string, number> = {}) {
  const header = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${properties.map((p) => `property float ${p}`).join("\n")}\nend_header\n`,
  );
  const bytes = new Uint8Array(header.length + properties.length * 4);
  bytes.set(header);
  const data = new DataView(bytes.buffer);
  const values = { x: .1, y: .2, z: .3, opacity: 0, scale_0: Math.log(.5), scale_1: Math.log(.25), scale_2: Math.log(.125), rot_0: 2, f_dc_0: 1, f_rest_0: 2, f_rest_15: 3, f_rest_30: 4, ...changes };
  properties.forEach((name, index) => data.setFloat32(header.length + index * 4, values[name as keyof typeof values] ?? 0, true));
  return bytes.buffer;
}
const faces = new Uint32Array([0, 1, 2]);
const vertices = new Float32Array([0, 0, 0, 2, 0, 0, 0, 0, 2]);
function close(actual: ArrayLike<number>, expected: number[]) {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 6));
}

describe("native GaussianAvatars binding", () => {
  it("retains binding/index and converts WXYZ, log scale, sigmoid and channel-major SH", () => {
    const parsed = parseBoundGaussianPly(ply(), 1);
    expect(parsed.count).toBe(1);
    expect(parsed.bindings[0]).toBe(0);
    close(parsed.values.slice(4, 8), [.5, .25, .125, .5]);
    close(parsed.values.slice(8, 12), [0, 0, 0, 1]);
    close(parsed.values.slice(12, 16), [1, 0, 0, 0]);
    close(parsed.values.slice(16, 20), [2, 3, 4, 0]);
  });

  it("matches the original face frame and local Gaussian covariance axes", () => {
    const frames = computeFaceFrames(vertices, faces);
    const output = deformGaussian(parseBoundGaussianPly(ply(), 1), 0, frames);
    close(frames.slice(0, 4), [2 / 3, 0, 2 / 3, 2]);
    close(output.center, [13 / 15, -.4, 1 / 15]);
    close(output.scales, [1, .5, .25]);
    close(output.quaternion, [1, 0, 0, 0]);
  });

  it("follows triangle rigid rotation/translation and size changes", () => {
    // Rotate the fixture +90deg about Z, enlarge twice, translate (1,2,3).
    const moved = new Float32Array([1, 2, 3, 1, 6, 3, 1, 2, 7]);
    const result = deformGaussian(parseBoundGaussianPly(ply(), 1), 0, computeFaceFrames(moved, faces));
    close(result.center, [1.8, 56 / 15, 47 / 15]);
    close(result.scales, [2, 1, .5]);
    close(result.quaternion, [Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
  });

  it.each([-1, .5, 1, Infinity])("rejects invalid face binding %s", (binding_0) => {
    expect(() => parseBoundGaussianPly(ply({ binding_0 }), 1)).toThrow();
  });

  it("rejects truncated/nonfinite Gaussian data and degenerate topology", () => {
    const bytes = ply();
    expect(() => parseBoundGaussianPly(bytes.slice(0, -1), 1)).toThrow();
    expect(() => parseBoundGaussianPly(ply({ x: NaN }), 1)).toThrow();
    expect(() => parseBoundGaussianPly(ply({ rot_0: 0 }), 1)).toThrow();
    expect(() => computeFaceFrames(vertices, new Uint32Array([0, 1, 20]))).toThrow();
    expect(() => computeFaceFrames(vertices, new Uint32Array([0, 0, 0]))).toThrow();
  });

  it("keeps FLAME upright, updates the covariance source and releases its own GPU resources", async () => {
    // Real Spark graph/material and Three objects; fetching and WebGL ownership
    // are the external boundaries. This does not assert actual GPU rendering.
    const THREE = { ...ThreeMath, ShaderChunk: {} };
    vi.stubGlobal("AFRAME", { THREE });
    vi.stubGlobal("fetch", async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => ply() }));
    try {
      const scene = new THREE.Scene();
      const sparkRenderer = Object.assign(new THREE.Group(), { setDirty() {} });
      scene.add(sparkRenderer);
      const avatar = await createNativeGaussianAvatar({ scene, renderer: { capabilities: { maxTextureSize: 2048 } }, sparkRenderer,
        plyUrl: "/private/subject306.ply", faces, vertices });
      expect(avatar.root.rotation.x).toBe(0);
      expect(avatar.root.rotation.y).toBe(Math.PI);
      scene.updateMatrixWorld(true);
      avatar.mesh.update({ renderer: undefined, time: 0, deltaTime: 0, viewToWorld: new THREE.Matrix4(), camera: undefined, renderSize: undefined, globalEdits: [], lodIndices: undefined });
      const { SplatAccumulator } = await import("../../public/vendor/spark-2.4.0.module.js");
      const { program, material } = SplatAccumulator.prototype.prepareProgramMaterial.call({ extSplats: true, covSplats: true }, avatar.mesh.generator, avatar.mesh.covGenerator);
      expect(avatar.mesh.covGenerator).toBeDefined();
      expect(avatar.mesh.generator).toBeUndefined();
      const textures = Object.values(program.uniforms).map((uniform: any) => uniform.value).filter((value: any) => value?.isDataTexture && value.type === THREE.FloatType);
      expect(textures).toHaveLength(2);
      let disposedTextures = 0, disposedMaterials = 0;
      textures.forEach((tex: any) => tex.addEventListener("dispose", () => disposedTextures++));
      material.addEventListener("dispose", () => disposedMaterials++);
      const oldBounds = avatar.bounds.clone();
      avatar.updateVertices(vertices.map((value, index) => value + (index % 3 === 0 ? 5 : 0)));
      expect(avatar.bounds.min.x - oldBounds.min.x).toBeCloseTo(5);
      expect(avatar.bounds.max.x - oldBounds.max.x).toBeCloseTo(5);
      const generator = avatar.mesh.covGenerator;
      avatar.dispose();
      avatar.dispose();
      expect(avatar.root.parent).toBeNull();
      expect(sparkRenderer.parent).toBe(scene);
      expect(disposedTextures).toBe(2);
      expect(disposedMaterials).toBe(1);
      expect(SplatAccumulator.generatorProgram?.has(generator)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
