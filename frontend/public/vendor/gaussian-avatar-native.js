/*
 * Native GaussianAvatars browser adapter; face binding equations adapted from
 * Shenhan Qian et al., GaussianAvatars, revision 29b0021308d45c6dce0b522044a4893e189c7a23.
 * https://github.com/ShenhanQian/GaussianAvatars (CC-BY-NC-SA-4.0).
 * Toyota Motor Europe NV/SA and its affiliated companies retain all intellectual
 * property and proprietary rights in and to the binding code and documentation.
 * Any commercial use, reproduction, disclosure or distribution without an express
 * license agreement from Toyota Motor Europe NV/SA is strictly prohibited.
 * FLAME and subject assets retain their separate terms; this file embeds none.
 */

const STRIDE = 76; // Three parameter texels, followed by sixteen RGB SH texels.
const MAX_STD_DEV = Math.sqrt(8);
const PROPERTIES = ["x", "y", "z", "nx", "ny", "nz",
  ...Array.from({ length: 3 }, (_, i) => `f_dc_${i}`),
  ...Array.from({ length: 45 }, (_, i) => `f_rest_${i}`),
  "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "binding_0"];

/** Parse only the bounded original degree-three, binary little-endian layout. */
export function parseBoundGaussianPly(buffer, faceCount) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 64 * 1024 * 1024 ||
      !Number.isInteger(faceCount) || faceCount < 1 || faceCount > 100000) throw new Error("Invalid native Gaussian input");
  const text = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, Math.min(65536, buffer.byteLength)));
  const end = /(?:^|\n)end_header\r?\n/.exec(text);
  if (!end) throw new Error("Gaussian PLY header is missing or too large");
  const offset = end.index + end[0].length;
  const lines = text.slice(0, offset).trim().split(/\r?\n/);
  if (lines[0] !== "ply" || lines[1] !== "format binary_little_endian 1.0") throw new Error("Unsupported Gaussian PLY format");
  let count = 0;
  const names = [];
  for (const line of lines.slice(2, -1)) {
    if (/^comment(?: |$)/.test(line)) continue;
    const element = /^element vertex (\d+)$/.exec(line);
    if (element && !count && !names.length) { count = Number(element[1]); continue; }
    const property = /^property float (\w+)$/.exec(line);
    if (!count || !property) throw new Error("Unsupported Gaussian PLY schema");
    names.push(property[1]);
  }
  if (count < 1 || count > 250000 || names.length !== 63 || new Set(names).size !== 63 ||
      PROPERTIES.some((name) => !names.includes(name)) || offset + count * 252 !== buffer.byteLength) throw new Error("Gaussian PLY size/schema mismatch");
  const fields = Object.fromEntries(names.map((name, i) => [name, i]));
  const values = new Float32Array(count * STRIDE);
  const bindings = new Uint32Array(count);
  const view = new DataView(buffer);
  const record = new Float64Array(63);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 63; j++) {
      const value = view.getFloat32(offset + (i * 63 + j) * 4, true);
      if (!Number.isFinite(value)) throw new Error(`Nonfinite Gaussian ${i}`);
      record[j] = value;
    }
    const binding = record[fields.binding_0];
    if (!Number.isInteger(binding) || binding < 0 || binding >= faceCount) throw new Error(`Invalid Gaussian face binding ${i}`);
    const o = i * STRIDE;
    values.set([record[fields.x], record[fields.y], record[fields.z], binding], o);
    bindings[i] = binding;
    for (let axis = 0; axis < 3; axis++) {
      const scale = Math.fround(Math.exp(record[fields[`scale_${axis}`]]));
      if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid Gaussian scale ${i}`);
      values[o + 4 + axis] = scale;
    }
    values[o + 7] = 1 / (1 + Math.exp(-record[fields.opacity]));
    const w = record[fields.rot_0], x = record[fields.rot_1], y = record[fields.rot_2], z = record[fields.rot_3];
    const norm = Math.hypot(w, x, y, z);
    if (norm < 1e-12) throw new Error(`Invalid Gaussian quaternion ${i}`);
    values.set([x / norm, y / norm, z / norm, w / norm], o + 8);
    for (let coefficient = 0; coefficient < 16; coefficient++) {
      for (let channel = 0; channel < 3; channel++) {
        values[o + 12 + coefficient * 4 + channel] = record[fields[coefficient === 0 ? `f_dc_${channel}` : `f_rest_${channel * 15 + coefficient - 1}`]];
      }
    }
  }
  return { count, values, bindings };
}

// Output is center XYZ, scalar size, quaternion XYZW, in upstream coordinates.
export function computeFaceFrames(vertices, faces, output = new Float32Array(faces.length / 3 * 8)) {
  if (!(vertices instanceof Float32Array) || vertices.length % 3 || !vertices.length ||
      !(faces instanceof Uint32Array || faces instanceof Int32Array) || faces.length % 3 || !faces.length ||
      output.length !== faces.length / 3 * 8) throw new Error("Invalid native FLAME topology");
  for (const value of vertices) if (!Number.isFinite(value)) throw new Error("Nonfinite FLAME vertex");
  for (let f = 0; f < faces.length / 3; f++) {
    const a = faces[f * 3] * 3, b = faces[f * 3 + 1] * 3, c = faces[f * 3 + 2] * 3;
    if (a < 0 || b < 0 || c < 0 || Math.max(a, b, c) >= vertices.length) throw new Error("FLAME face index out of range");
    const ex = vertices[b] - vertices[a], ey = vertices[b + 1] - vertices[a + 1], ez = vertices[b + 2] - vertices[a + 2];
    const bx = vertices[c] - vertices[a], by = vertices[c + 1] - vertices[a + 1], bz = vertices[c + 2] - vertices[a + 2];
    const edge = Math.hypot(ex, ey, ez);
    if (edge < 1e-12) throw new Error(`Degenerate FLAME face ${f}`);
    const x0 = ex / edge, y0 = ey / edge, z0 = ez / edge;
    let x1 = y0 * bz - z0 * by, y1 = z0 * bx - x0 * bz, z1 = x0 * by - y0 * bx;
    const normal = Math.hypot(x1, y1, z1);
    if (normal < 1e-12) throw new Error(`Degenerate FLAME face ${f}`);
    x1 /= normal; y1 /= normal; z1 /= normal;
    const x2 = z1 * y0 - y1 * z0, y2 = x1 * z0 - z1 * x0, z2 = y1 * x0 - x1 * y0;
    const o = f * 8;
    output[o] = (vertices[a] + vertices[b] + vertices[c]) / 3;
    output[o + 1] = (vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3;
    output[o + 2] = (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3;
    output[o + 3] = (edge + Math.abs(x2 * bx + y2 * by + z2 * bz)) / 2;
    // Matrix columns are a0, a1, a2; equivalent to roma's unit quaternion.
    const trace = x0 + y1 + z2;
    let qx, qy, qz, qw;
    if (trace > 0) {
      const s = 2 * Math.sqrt(trace + 1);
      qw = s / 4; qx = (z1 - y2) / s; qy = (x2 - z0) / s; qz = (y0 - x1) / s;
    } else if (x0 > y1 && x0 > z2) {
      const s = 2 * Math.sqrt(1 + x0 - y1 - z2);
      qw = (z1 - y2) / s; qx = s / 4; qy = (x1 + y0) / s; qz = (x2 + z0) / s;
    } else if (y1 > z2) {
      const s = 2 * Math.sqrt(1 + y1 - x0 - z2);
      qw = (x2 - z0) / s; qx = (x1 + y0) / s; qy = s / 4; qz = (y2 + z1) / s;
    } else {
      const s = 2 * Math.sqrt(1 + z2 - x0 - y1);
      qw = (y0 - x1) / s; qx = (x2 + z0) / s; qy = (y2 + z1) / s; qz = s / 4;
    }
    const qn = Math.hypot(qx, qy, qz, qw);
    output.set([qx / qn, qy / qn, qz / qn, qw / qn], o + 4);
  }
  return output;
}

export function deformGaussian(parsed, index, frames) {
  if (!Number.isInteger(index) || index < 0 || index >= parsed.count) throw new Error("Gaussian index out of range");
  const o = index * STRIDE, f = parsed.bindings[index] * 8, p = parsed.values;
  if (f + 7 >= frames.length) throw new Error("Missing Gaussian face frame");
  const x = p[o], y = p[o + 1], z = p[o + 2], s = frames[f + 3];
  const qx = frames[f + 4], qy = frames[f + 5], qz = frames[f + 6], qw = frames[f + 7];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  const lx = p[o + 8], ly = p[o + 9], lz = p[o + 10], lw = p[o + 11];
  return {
    center: [frames[f] + s * (x + qw * tx + qy * tz - qz * ty), frames[f + 1] + s * (y + qw * ty + qz * tx - qx * tz), frames[f + 2] + s * (z + qw * tz + qx * ty - qy * tx)],
    scales: [p[o + 4] * s, p[o + 5] * s, p[o + 6] * s],
    quaternion: [qw * lx + qx * lw + qy * lz - qz * ly, qw * ly - qx * lz + qy * lw + qz * lx, qw * lz + qx * ly - qy * lx + qz * lw, qw * lw - qx * lx - qy * ly - qz * lz],
    opacity: p[o + 7],
  };
}

const SHADER = `
vec4 native_read(sampler2D tex, int index) {
  int width = textureSize(tex, 0).x;
  return texelFetch(tex, ivec2(index % width, index / width), 0);
}
vec3 native_rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec4 native_multiply(vec4 a, vec4 b) {
  return vec4(a.w*b.xyz + b.w*a.xyz + cross(a.xyz,b.xyz), a.w*b.w - dot(a.xyz,b.xyz));
}
vec3 native_sh(sampler2D tex, int base, vec3 d) {
  float x=d.x, y=d.y, z=d.z, xx=x*x, yy=y*y, zz=z*z;
  vec3 rgb = 0.28209479177387814 * native_read(tex, base).rgb;
  rgb += -0.4886025119029199*y*native_read(tex,base+1).rgb;
  rgb +=  0.4886025119029199*z*native_read(tex,base+2).rgb;
  rgb += -0.4886025119029199*x*native_read(tex,base+3).rgb;
  rgb +=  1.0925484305920792*x*y*native_read(tex,base+4).rgb;
  rgb += -1.0925484305920792*y*z*native_read(tex,base+5).rgb;
  rgb +=  0.31539156525252005*(2.0*zz-xx-yy)*native_read(tex,base+6).rgb;
  rgb += -1.0925484305920792*x*z*native_read(tex,base+7).rgb;
  rgb +=  0.5462742152960396*(xx-yy)*native_read(tex,base+8).rgb;
  rgb += -0.5900435899266435*y*(3.0*xx-yy)*native_read(tex,base+9).rgb;
  rgb +=  2.890611442640554*x*y*z*native_read(tex,base+10).rgb;
  rgb += -0.4570457994644658*y*(4.0*zz-xx-yy)*native_read(tex,base+11).rgb;
  rgb +=  0.3731763325901154*z*(2.0*zz-3.0*xx-3.0*yy)*native_read(tex,base+12).rgb;
  rgb += -0.4570457994644658*x*(4.0*zz-xx-yy)*native_read(tex,base+13).rgb;
  rgb +=  1.445305721320277*z*(xx-yy)*native_read(tex,base+14).rgb;
  rgb += -0.5900435899266435*x*(xx-3.0*yy)*native_read(tex,base+15).rgb;
  return max(rgb + 0.5, vec3(0.0));
}`;

/** scene can be a THREE.Scene or A-Frame scene element; renderer is WebGLRenderer.
 * sparkRenderer optionally supplies the scene's existing SparkRenderer.
 * root includes the one upstream-to-Three PI rotation about Y (FLAME is Y-up).
 * bounds is an updated conservative Box3 in root-local upstream coordinates.
 * @param {{scene:any,renderer:any,sparkRenderer?:any,plyUrl:string,faces:Uint32Array|Int32Array,vertices:Float32Array,signal?:AbortSignal}} options
 */
export async function createNativeGaussianAvatar({ scene, renderer, sparkRenderer, plyUrl, faces, vertices, signal }) {
  const THREE = globalThis.AFRAME?.THREE;
  if (!THREE || !renderer || !(scene?.isScene || scene?.object3D)) throw new Error("Native Gaussian avatar requires the shared A-Frame Three runtime");
  signal?.throwIfAborted();
  const response = await fetch(plyUrl, { signal });
  if (!response.ok) throw new Error(`Gaussian PLY request failed (${response.status})`);
  const length = Number(response.headers.get("Content-Length"));
  if (length > 64 * 1024 * 1024) throw new Error("Gaussian PLY exceeds size limit");
  const parsed = parseBoundGaussianPly(await response.arrayBuffer(), faces.length / 3);
  const frames = computeFaceFrames(vertices, faces);
  signal?.throwIfAborted();
  const { SplatMesh, SparkRenderer, SplatAccumulator, dyno } = await import("./spark-2.4.0.module.js");
  signal?.throwIfAborted();
  const maxTextureSize = renderer.capabilities.maxTextureSize;
  function texture(data) {
    const width = Math.min(2048, maxTextureSize);
    const height = Math.ceil(data.length / 4 / width);
    if (height > maxTextureSize) throw new Error("Native Gaussian textures exceed GPU limits");
    const padded = new Float32Array(width * height * 4);
    padded.set(data);
    const tex = new THREE.DataTexture(padded, width, height, THREE.RGBAFormat, THREE.FloatType);
    tex.internalFormat = "RGBA32F";
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }
  const parameters = texture(parsed.values);
  let faceTexture;
  try { faceTexture = texture(frames); } catch (error) { parameters.dispose(); throw error; }
  const parameterUniform = new dyno.DynoSampler2D({ value: parameters });
  const frameUniform = new dyno.DynoSampler2D({ value: faceTexture });
  const source = {
    getNumSplats: () => parsed.count,
    hasRgbDir: () => true,
    setMaxSh() {},
    prepareFetchSplat() {},
    fetchSplat({ index, viewOrigin }) {
      return new dyno.Dyno({
        inTypes: { index: "int", viewOrigin: "vec3", parameters: "sampler2D", frames: "sampler2D" },
        outTypes: { gsplat: dyno.Gsplat },
        inputs: { index, viewOrigin, parameters: parameterUniform, frames: frameUniform },
        globals: () => [dyno.defineGsplat, SHADER],
        statements: ({ inputs: i, outputs: o }) => `
          int native_base = ${i.index} * 19;
          vec4 native_p = native_read(${i.parameters}, native_base);
          vec4 native_s = native_read(${i.parameters}, native_base + 1);
          vec4 native_q = native_read(${i.parameters}, native_base + 2);
          int native_face = int(native_p.w) * 2;
          vec4 native_frame = native_read(${i.frames}, native_face);
          vec4 native_rotation = native_read(${i.frames}, native_face + 1);
          ${o.gsplat}.center = native_frame.xyz + native_frame.w * native_rotate(native_rotation, native_p.xyz);
          ${o.gsplat}.scales = native_s.xyz * native_frame.w;
          ${o.gsplat}.quaternion = normalize(native_multiply(native_rotation, native_q));
          vec3 native_direction = ${o.gsplat}.center - ${i.viewOrigin};
          native_direction /= max(length(native_direction), 1e-12);
          ${o.gsplat}.rgba = vec4(native_sh(${i.parameters}, native_base + 3, native_direction), native_s.w);
          ${o.gsplat}.flags = GSPLAT_FLAG_ACTIVE;
          ${o.gsplat}.index = ${i.index};
        `.trim().split("\n"),
      }).outputs.gsplat;
    },
    dispose() {
      parameters.dispose(); faceTexture.dispose();
      parameters.source.data = null; faceTexture.source.data = null;
      parsed.values = new Float32Array(0); parsed.bindings = new Uint32Array(0);
    },
  };
  const root = new THREE.Group();
  root.name = "native-gaussian-avatar";
  root.rotation.y = Math.PI;
  const mesh = new SplatMesh({ splats: source, enableLod: false, raycastable: false, editable: false });
  // Spark's constructor restricts covSplats to ExtSplats; this custom full-float
  // source supplies the same Gsplat contract to its public covariance generator.
  mesh.covSplats = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  const compiled = new Set();
  const construct = mesh.constructGenerator;
  mesh.constructGenerator = function(context) {
    const result = construct.call(this, context);
    if (this.generator) compiled.add(this.generator);
    if (this.covGenerator) compiled.add(this.covGenerator);
    return result;
  };
  const bounds = new THREE.Box3();
  const radii = new Float32Array(faces.length / 3);
  for (let i = 0; i < parsed.count; i++) {
    const o = i * STRIDE, p = parsed.values;
    const radius = Math.hypot(p[o], p[o + 1], p[o + 2]) + MAX_STD_DEV * 1.04 * Math.max(p[o + 4], p[o + 5], p[o + 6]);
    radii[parsed.bindings[i]] = Math.max(radii[parsed.bindings[i]], radius);
  }
  const low = new THREE.Vector3(), high = new THREE.Vector3();
  function updateBounds() {
    bounds.makeEmpty();
    for (let f = 0; f < radii.length; f++) {
      if (radii[f] === 0) continue;
      const o = f * 8, r = radii[f] * frames[o + 3];
      low.set(frames[o] - r, frames[o + 1] - r, frames[o + 2] - r);
      high.set(frames[o] + r, frames[o + 1] + r, frames[o + 2] + r);
      bounds.expandByPoint(low); bounds.expandByPoint(high);
    }
  }
  updateBounds();
  // A-Frame owns its scene renderer; a standalone lab can own a private one.
  if (scene.object3D && typeof scene.setAttribute === "function" && !scene.components?.["gaussian-splatting-system"]) {
    scene.setAttribute("gaussian-splatting-system", "");
  }
  const system = scene.components?.["gaussian-splatting-system"];
  let ownedRenderer = false, acquired = false, disposed = false;
  const member = { loadedVertexCount: parsed.count, remove: () => dispose() };
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    root.removeFromParent();
    for (const generator of compiled) {
      SplatAccumulator.generatorProgram.get(generator)?.prepareMaterial().dispose();
      SplatAccumulator.generatorProgram.delete(generator);
    }
    compiled.clear();
    mesh.dispose();
    if (acquired) system.release(member);
    if (ownedRenderer) { sparkRenderer.removeFromParent(); sparkRenderer.dispose(); }
    sparkRenderer?.setDirty();
  }
  try {
    if (!sparkRenderer && system) {
      system.acquire(member); acquired = true; sparkRenderer = system.renderer;
    }
    if (!sparkRenderer) {
      sparkRenderer = new SparkRenderer({ renderer, covSplats: true, accumExtSplats: true, maxStdDev: MAX_STD_DEV, minSortIntervalMs: 33 });
      (scene.object3D ?? scene).add(sparkRenderer);
      ownedRenderer = true;
    }
    (scene.object3D ?? scene).add(root);
    signal?.addEventListener("abort", dispose, { once: true });
    signal?.throwIfAborted();
    sparkRenderer.setDirty();
  } catch (error) { dispose(); throw error; }
  return {
    root, mesh, count: parsed.count, bounds,
    updateVertices(nextVertices) {
      if (disposed) return;
      if (nextVertices.length !== vertices.length) throw new Error("FLAME vertex count changed");
      computeFaceFrames(nextVertices, faces, frames);
      faceTexture.image.data.set(frames);
      faceTexture.needsUpdate = true;
      updateBounds();
      mesh.updateVersion();
      sparkRenderer.setDirty();
    },
    setVisible(visible) { root.visible = Boolean(visible); sparkRenderer.setDirty(); },
    dispose,
  };
}
