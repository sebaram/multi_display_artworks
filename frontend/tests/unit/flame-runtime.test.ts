import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  decodeFlameModel, evaluateFlame,
  type FlameArrayDescriptor, type FlameManifest, type FlameParameters,
} from '../../src/avatar/flame-runtime';

function bytes(path: string): ArrayBuffer {
  const data = readFileSync(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function fixture() {
  const arrays = {
    template: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
    expressionDirections: new Float32Array([0, 0, 0, .5, 0, 0, 0, 0, 0]),
    poseDirections: new Float32Array(36 * 9),
    jointRegressor: new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    weights: new Float32Array([1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
    parents: new Int32Array([-1, 0, 1, 1, 1]),
    faces: new Uint32Array([0, 1, 2]),
    restJoints: new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
    leftEyeVertices: new Uint32Array([1]),
    rightEyeVertices: new Uint32Array([2]),
  };
  // Jaw R[1,0] corrective moves the third vertex in Z before skinning.
  arrays.poseDirections[12 * 9 + 8] = .2;
  const shapes = [[3, 3], [1, 3, 3], [36, 3, 3], [5, 3], [3, 5], [5], [1, 3], [5, 3], [1], [1]];
  const files: Record<string, ArrayBuffer> = {};
  const descriptors: Record<string, FlameArrayDescriptor> = {};
  Object.entries(arrays).forEach(([name, array], i) => {
    const file = `${name}.bin`;
    files[file] = array.buffer;
    descriptors[name] = { file, byteOffset: 0, length: array.length, shape: shapes[i],
      type: array instanceof Float32Array ? 'float32' : array instanceof Uint32Array ? 'uint32' : 'int32' };
  });
  const defaults: FlameParameters = { expression: [0], rotation: [0, 0, 0], neck: [0, 0, 0],
    jaw: [0, 0, 0], eyes: [0, 0, 0, 0, 0, 0], translation: [0, 0, 0] };
  const manifest: FlameManifest = {
    format: 'gaussian-avatars-native-v1', byteOrder: 'little-endian', sourceRevision: 'test-fixture',
    licenseStatus: 'private-local-only', vertexCount: 3, faceCount: 1, jointCount: 5,
    expressionCount: 1, defaultParameters: defaults, arrays: descriptors,
    gaussian: { file: 'fixture.ply', count: 1 },
  };
  return { manifest, files, arrays };
}

function expectVertices(actual: Float32Array, expected: ArrayLike<number>, tolerance = 1e-6) {
  expect(actual.length).toBe(expected.length);
  let error = 0;
  for (let i = 0; i < actual.length; i++) error = Math.max(error, Math.abs(actual[i] - expected[i]));
  expect(error).toBeLessThan(tolerance);
  return error;
}

test('zero pose is identity, with upstream axes and an optional reusable output', () => {
  const { manifest, files, arrays } = fixture();
  const model = decodeFlameModel(manifest, files);
  expectVertices(evaluateFlame(model), arrays.template);
  const output = new Float32Array(9);
  expect(evaluateFlame(model, { rotation: [0, 0, Math.PI / 2], translation: [2, 3, 4] }, output)).toBe(output);
  expectVertices(output, [2, 3, 4, 2, 4, 4, 1, 4, 4]);
});

test('expression changes the regressed jaw pivot; pose correctives precede joint skinning', () => {
  const { manifest, files } = fixture();
  const model = decodeFlameModel(manifest, files);
  const vertices = evaluateFlame(model, { expression: [1], jaw: [0, 0, Math.PI / 2] });
  expectVertices(vertices, [0, 0, 0, 1.5, 0, 0, .5, -.5, .2]);
});

test('malformed rig buffers and parameters cannot enter the evaluator', () => {
  for (const mutate of [
    (m: FlameManifest) => { m.arrays.template.byteOffset = 2; },
    (m: FlameManifest) => { m.arrays.template.length++; },
    (m: FlameManifest) => { m.arrays.faces.file = '../public/model.bin'; },
    (m: FlameManifest) => { m.arrays.poseDirections.shape = [35, 3, 3]; },
  ]) {
    const { manifest, files } = fixture();
    mutate(manifest);
    expect(() => decodeFlameModel(manifest, files)).toThrow('Invalid FLAME rig');
  }
  const { manifest, files, arrays } = fixture();
  arrays.parents[1] = 3;
  expect(() => decodeFlameModel(manifest, files)).toThrow('parent order');
  arrays.parents[1] = 0;
  arrays.faces[1] = 30;
  expect(() => decodeFlameModel(manifest, files)).toThrow('face index');
  arrays.faces[1] = 1;
  const model = decodeFlameModel(manifest, files);
  expect(() => evaluateFlame(model, { eyes: [0, NaN, 0, 0, 0, 0] })).toThrow('finite');
  expect(() => evaluateFlame(model, { expression: [] })).toThrow('expression');
  expect(() => evaluateFlame(model, {}, new Float32Array(3))).toThrow('output');
});

// The licensed model is intentionally absent from Git/CI. Run the exporter to
// enable this bounded full-mesh check on the user's private local assets.
const localPath = resolve(process.cwd(), '../FLAME/derived/web');
const hasPrivateRig = existsSync(`${localPath}/manifest.json`) && existsSync(`${localPath}/references.json`);
describe.skipIf(!hasPrivateRig)('private original FLAME 2023 / actual subject 306', () => {
  test('all vertices match independent Python references for neutral, eyes, jaw, expression and frame 0', () => {
    const manifest = JSON.parse(readFileSync(`${localPath}/manifest.json`, 'utf8')) as FlameManifest;
    const files = Object.fromEntries([...new Set(Object.values(manifest.arrays).map(a => a.file))]
      .map(file => [file, bytes(`${localPath}/${file}`)]));
    const model = decodeFlameModel(manifest, files);
    const references = JSON.parse(readFileSync(`${localPath}/references.json`, 'utf8')) as {
      method: string; absoluteToleranceMeters: number;
      cases: { name: string; parameters: FlameParameters; vertices: FlameArrayDescriptor }[];
    };
    expect(references.method).toBe('independent-vectorized-numpy-float64-flame-equations');
    expect(references.cases.map(c => c.name)).toEqual([
      'neutral', 'frame0', 'eyes-left', 'eyes-right', 'eyes-up', 'eyes-down', 'jaw', 'expression', 'combined',
    ]);
    expect(model.template.length).toBe(5143 * 3);
    expect(model.faces.length).toBe(10144 * 3);
    const expectedFile = bytes(`${localPath}/references.bin`);
    const errors: Record<string, number> = {};
    for (const reference of references.cases) {
      const expected = new Float32Array(expectedFile, reference.vertices.byteOffset, reference.vertices.length);
      errors[reference.name] = expectVertices(evaluateFlame(model, reference.parameters), expected, references.absoluteToleranceMeters);
    }
    console.info('Actual subject 306 FLAME max absolute errors (meters):', errors);
    const neutral = references.cases[0].parameters;
    const baseline = evaluateFlame(model, neutral);
    const leftEyeOnly = evaluateFlame(model, { ...neutral, eyes: [0, .3, 0, 0, 0, 0] });
    const maxEyeMovement = (indices: Uint32Array) => {
      let max = 0;
      for (const vertex of indices) for (let axis = 0; axis < 3; axis++)
        max = Math.max(max, Math.abs(leftEyeOnly[vertex * 3 + axis] - baseline[vertex * 3 + axis]));
      return max;
    };
    expect(maxEyeMovement(model.leftEyeVertices)).toBeGreaterThan(.001);
    expect(maxEyeMovement(model.rightEyeVertices)).toBeLessThan(1e-6);
  });
});
