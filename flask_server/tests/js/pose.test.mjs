import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toVec3, maxAxisDelta, lerpVec3, lerpAngles,
} from '../../app/metamuseum/static/js/room/core/pose.js';

test('toVec3 accepts the string, object, and array pose shapes', () => {
  assert.deepEqual(toVec3('0 1.6 0'), { x: 0, y: 1.6, z: 0 });
  assert.deepEqual(toVec3({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
  assert.deepEqual(toVec3([1, 2, 3]), { x: 1, y: 2, z: 3 });
});

test('toVec3 rejects unusable values instead of producing NaN', () => {
  assert.equal(toVec3(null), null);
  assert.equal(toVec3('nonsense'), null);
  assert.equal(toVec3({ x: 1, y: 2 }), null);
});

test('maxAxisDelta reports the largest single-axis difference', () => {
  assert.equal(maxAxisDelta({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: -0.5 }), 0.5);
  assert.equal(maxAxisDelta(null, { x: 0, y: 0, z: 0 }), Infinity);
});

test('lerpVec3 interpolates each axis and clamps t to the segment', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 10, y: -10, z: 5 };
  assert.deepEqual(lerpVec3(a, b, 0.5), { x: 5, y: -5, z: 2.5 });
  assert.deepEqual(lerpVec3(a, b, 2), b);
  assert.deepEqual(lerpVec3(a, b, -1), a);
});

test('lerpAngles takes the short way around the 180 degree seam', () => {
  const result = lerpAngles({ x: 0, y: 179, z: 0 }, { x: 0, y: -179, z: 0 }, 0.5);
  assert.equal(Math.round(result.y), 180);
});

test('lerpAngles does not wrap when the short path is direct', () => {
  const result = lerpAngles({ x: 0, y: 10, z: 0 }, { x: 0, y: 50, z: 0 }, 0.25);
  assert.equal(result.y, 20);
});
