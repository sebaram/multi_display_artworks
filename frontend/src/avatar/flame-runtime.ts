/**
 * CPU FLAME evaluation for locally exported GaussianAvatars rigs.
 * Equations/teeth layout follow GaussianAvatars (Shenhan Qian et al.), revision
 * 29b0021308d45c6dce0b522044a4893e189c7a23, CC-BY-NC-SA-4.0:
 * https://github.com/ShenhanQian/GaussianAvatars/blob/main/LICENSE.md
 * Its FLAME/LBS sources and model retain separate MPG/SMPL-X license terms:
 * https://github.com/vchoutas/smplx/blob/main/LICENSE
 * The model and subject package must remain private; this source grants no
 * permission to redistribute their data.
 */

export interface FlameParameters {
  expression: ArrayLike<number>;
  rotation: ArrayLike<number>;
  neck: ArrayLike<number>;
  jaw: ArrayLike<number>;
  eyes: ArrayLike<number>;
  translation: ArrayLike<number>;
  zeroCenteredAtRoot?: boolean;
}

export interface FlameArrayDescriptor {
  file: string;
  byteOffset: number;
  length: number;
  type: 'float32' | 'uint32' | 'int32';
  shape: number[];
}

export interface FlameManifest {
  format: 'gaussian-avatars-native-v1';
  byteOrder: 'little-endian';
  sourceRevision: string;
  licenseStatus: 'private-local-only';
  vertexCount: number;
  faceCount: number;
  jointCount: number;
  expressionCount: number;
  defaultParameters: FlameParameters;
  arrays: Record<string, FlameArrayDescriptor>;
  gaussian: { file: string; count: number };
  references?: string;
}

export interface FlameModel {
  manifest: FlameManifest;
  defaultParameters: FlameParameters;
  template: Float32Array;
  expressionDirections: Float32Array;
  poseDirections: Float32Array;
  jointRegressor: Float32Array;
  weights: Float32Array;
  parents: Int32Array;
  faces: Uint32Array;
  restJoints: Float32Array;
  leftEyeVertices: Uint32Array;
  rightEyeVertices: Uint32Array;
}

const fields = ['expression', 'rotation', 'neck', 'jaw', 'eyes', 'translation'] as const;
const localFile = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid FLAME rig: ${message}`);
}

function checkParameters(parameters: FlameParameters, expressions: number) {
  for (const field of fields) {
    const values = parameters[field];
    const length = field === 'expression' ? expressions : field === 'eyes' ? 6 : 3;
    assert(values != null && values.length === length, `${field} must have ${length} values`);
    for (let i = 0; i < length; i++) assert(Number.isFinite(values[i]), `${field} must be finite`);
  }
  assert(parameters.zeroCenteredAtRoot === undefined || typeof parameters.zeroCenteredAtRoot === 'boolean', 'root centering flag');
}

/** Decode data-only little-endian arrays; never deserialize pickle in a browser/server. */
export function decodeFlameModel(manifest: FlameManifest, files: Record<string, ArrayBuffer>): FlameModel {
  assert(manifest?.format === 'gaussian-avatars-native-v1' && manifest.byteOrder === 'little-endian', 'unsupported format');
  assert(manifest.licenseStatus === 'private-local-only', 'missing private model status');
  assert(new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, 'little-endian host required');
  const { vertexCount: v, faceCount: f, expressionCount: e } = manifest;
  assert(Number.isInteger(v) && v > 0 && v <= 10000, 'vertex count');
  assert(Number.isInteger(f) && f > 0 && f <= 30000, 'face count');
  assert(manifest.jointCount === 5 && Number.isInteger(e) && e > 0 && e <= 100, 'joint/expression count');
  assert(manifest.arrays && typeof manifest.arrays === 'object', 'array descriptors');
  checkParameters(manifest.defaultParameters, e);
  function array(name: string, type: FlameArrayDescriptor['type'], shape: number[]) {
    const descriptor = manifest.arrays[name];
    const length = shape.reduce((a, b) => a * b, 1);
    assert(descriptor && descriptor.type === type && Array.isArray(descriptor.shape) &&
      descriptor.shape.length === shape.length && descriptor.shape.every((n, i) => n === shape[i]), `${name} shape/type`);
    assert(localFile.test(descriptor.file), `${name} filename`);
    assert(descriptor.length === length && Number.isSafeInteger(descriptor.byteOffset) &&
      descriptor.byteOffset >= 0 && descriptor.byteOffset % 4 === 0, `${name} length/offset`);
    const data = files[descriptor.file];
    assert(Object.prototype.toString.call(data) === '[object ArrayBuffer]' && data.byteLength <= 64 * 1024 * 1024 &&
      descriptor.byteOffset + length * 4 <= data.byteLength, `${name} buffer bounds`);
    const ArrayType = type === 'float32' ? Float32Array : type === 'uint32' ? Uint32Array : Int32Array;
    const values = new ArrayType(data, descriptor.byteOffset, length);
    if (type === 'float32') for (const value of values) assert(Number.isFinite(value), `${name} contains non-finite data`);
    return values;
  }
  const model: FlameModel = {
    manifest, defaultParameters: manifest.defaultParameters,
    template: array('template', 'float32', [v, 3]) as Float32Array,
    expressionDirections: array('expressionDirections', 'float32', [e, v, 3]) as Float32Array,
    poseDirections: array('poseDirections', 'float32', [36, v, 3]) as Float32Array,
    jointRegressor: array('jointRegressor', 'float32', [5, v]) as Float32Array,
    weights: array('weights', 'float32', [v, 5]) as Float32Array,
    parents: array('parents', 'int32', [5]) as Int32Array,
    faces: array('faces', 'uint32', [f, 3]) as Uint32Array,
    restJoints: array('restJoints', 'float32', [5, 3]) as Float32Array,
    leftEyeVertices: new Uint32Array(), rightEyeVertices: new Uint32Array(),
  };
  for (const name of ['leftEyeVertices', 'rightEyeVertices'] as const) {
    const count = manifest.arrays[name]?.length;
    assert(typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= v, `${name} count`);
    model[name] = array(name, 'uint32', [count]) as Uint32Array;
    for (const index of model[name]) assert(index < v, `${name} index`);
  }
  assert(model.parents[0] === -1, 'root parent');
  for (let joint = 1; joint < 5; joint++) assert(model.parents[joint] >= 0 && model.parents[joint] < joint, 'parent order');
  for (const index of model.faces) assert(index < v, 'face index');
  for (let vertex = 0; vertex < v; vertex++) {
    let sum = 0;
    for (let joint = 0; joint < 5; joint++) {
      const weight = model.weights[vertex * 5 + joint];
      assert(weight >= 0 && weight <= 1.00001, 'skinning weight');
      sum += weight;
    }
    assert(Math.abs(sum - 1) < 1e-4, 'skinning weight sum');
  }
  return model;
}

export async function loadFlameModel(manifestUrl: string | URL, options: { signal?: AbortSignal } = {}): Promise<FlameModel> {
  const url = new URL(manifestUrl, globalThis.location?.href);
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`FLAME manifest: HTTP ${response.status}`);
  const manifest = await response.json() as FlameManifest;
  assert(manifest?.format === 'gaussian-avatars-native-v1' && manifest.arrays && typeof manifest.arrays === 'object', 'manifest');
  const names = [...new Set(Object.values(manifest.arrays).map(descriptor => descriptor?.file))];
  assert(names.length > 0 && names.length <= 8 && names.every(name => typeof name === 'string' && localFile.test(name)), 'array filenames');
  const entries = await Promise.all(names.map(async name => {
    const data = await fetch(new URL(name, url), options);
    if (!data.ok) throw new Error(`FLAME ${name}: HTTP ${data.status}`);
    return [name, await data.arrayBuffer()] as const;
  }));
  return decodeFlameModel(manifest, Object.fromEntries(entries));
}

function rotation(vector: ArrayLike<number>, offset: number, result: Float64Array, start: number) {
  const ax = vector[offset], ay = vector[offset + 1], az = vector[offset + 2];
  // Match upstream's norm(rotvec + 1e-8), including exactly zero axis angles.
  const angle = Math.hypot(ax + 1e-8, ay + 1e-8, az + 1e-8);
  assert(angle > 0 && Number.isFinite(angle), 'axis-angle norm');
  const x = ax / angle, y = ay / angle, z = az / angle;
  const s = Math.sin(angle), c = 1 - Math.cos(angle);
  result[start] = 1 - c * (y * y + z * z);
  result[start + 1] = c * x * y - s * z;
  result[start + 2] = c * x * z + s * y;
  result[start + 3] = c * x * y + s * z;
  result[start + 4] = 1 - c * (x * x + z * z);
  result[start + 5] = c * y * z - s * x;
  result[start + 6] = c * x * z - s * y;
  result[start + 7] = c * y * z + s * x;
  result[start + 8] = 1 - c * (x * x + y * y);
}

/** Full FLAME shape/expression -> regressed joints -> pose correctives -> LBS.
 * Returns original upstream coordinates. The renderer owns any world-axis flip.
 * Parameters override frame 0; eyes are two XYZ axis-angle vectors in radians.
 */
export function evaluateFlame(model: FlameModel, overrides: Partial<FlameParameters> = {}, output?: Float32Array): Float32Array {
  const parameters = { ...model.defaultParameters, ...overrides };
  const { vertexCount: count, expressionCount } = model.manifest;
  checkParameters(parameters, expressionCount);
  const size = count * 3;
  assert(!output || output.length === size, 'output vertex length');
  const result = output ?? new Float32Array(size);
  const shaped = new Float64Array(model.template);
  for (let expression = 0; expression < expressionCount; expression++) {
    const coefficient = parameters.expression[expression];
    if (coefficient === 0) continue;
    const start = expression * size;
    for (let i = 0; i < size; i++) shaped[i] += coefficient * model.expressionDirections[start + i];
  }
  const joints = new Float64Array(15);
  for (let joint = 0; joint < 5; joint++) {
    for (let vertex = 0; vertex < count; vertex++) {
      const weight = model.jointRegressor[joint * count + vertex];
      if (weight === 0) continue;
      for (let axis = 0; axis < 3; axis++) joints[joint * 3 + axis] += weight * shaped[vertex * 3 + axis];
    }
  }
  const rotations = new Float64Array(45);
  rotation(parameters.rotation, 0, rotations, 0);
  rotation(parameters.neck, 0, rotations, 9);
  rotation(parameters.jaw, 0, rotations, 18);
  rotation(parameters.eyes, 0, rotations, 27);
  rotation(parameters.eyes, 3, rotations, 36);
  const posed = shaped.slice();
  for (let basis = 0; basis < 36; basis++) {
    const coefficient = rotations[basis + 9] - (basis % 9 % 4 === 0 ? 1 : 0);
    if (coefficient === 0) continue;
    const start = basis * size;
    for (let i = 0; i < size; i++) posed[i] += coefficient * model.poseDirections[start + i];
  }
  // Row-major 3x4 global transforms, then subtract the transformed rest joint.
  const chain = new Float64Array(60);
  for (let joint = 0; joint < 5; joint++) {
    const parent = model.parents[joint], at = joint * 12, r = joint * 9, p = parent * 12;
    const delta = [0, 1, 2].map(axis => joints[joint * 3 + axis] - (parent < 0 ? 0 : joints[parent * 3 + axis]));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        chain[at + row * 4 + col] = parent < 0 ? rotations[r + row * 3 + col] :
          chain[p + row * 4] * rotations[r + col] + chain[p + row * 4 + 1] * rotations[r + 3 + col] +
          chain[p + row * 4 + 2] * rotations[r + 6 + col];
      }
      chain[at + row * 4 + 3] = parent < 0 ? delta[row] : chain[p + row * 4 + 3] +
        chain[p + row * 4] * delta[0] + chain[p + row * 4 + 1] * delta[1] + chain[p + row * 4 + 2] * delta[2];
    }
  }
  for (let joint = 0; joint < 5; joint++) {
    for (let row = 0; row < 3; row++) {
      const at = joint * 12 + row * 4, j = joint * 3;
      chain[at + 3] -= chain[at] * joints[j] + chain[at + 1] * joints[j + 1] + chain[at + 2] * joints[j + 2];
    }
  }
  for (let vertex = 0; vertex < count; vertex++) {
    const at = vertex * 3, x = posed[at], y = posed[at + 1], z = posed[at + 2];
    for (let axis = 0; axis < 3; axis++) {
      let value = 0;
      for (let joint = 0; joint < 5; joint++) {
        const weight = model.weights[vertex * 5 + joint], t = joint * 12 + axis * 4;
        if (weight !== 0) value += weight * (chain[t] * x + chain[t + 1] * y + chain[t + 2] * z + chain[t + 3]);
      }
      result[at + axis] = value + parameters.translation[axis] - (parameters.zeroCenteredAtRoot ? joints[axis] : 0);
    }
  }
  return result;
}
