// flask_server/tests/js/pose-buffer.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPoseBuffer } from '../../app/metamuseum/static/js/room/core/pose-buffer.js';

const at = (x) => ({ position: { x, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });

test('record reports only the first sample for a user as new', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  assert.equal(buffer.record('a', at(0), 1000), true);
  assert.equal(buffer.record('a', at(1), 1050), false);
  assert.deepEqual(buffer.userIds(), ['a']);
});

test('poseAt interpolates between the two samples bracketing render time', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  buffer.record('a', at(0), 1000);
  buffer.record('a', at(10), 1100);

  const pose = buffer.poseAt('a', 1150);  // renders at 1050
  assert.equal(pose.position.x, 5);
});

test('poseAt holds the last sample instead of extrapolating past it', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  buffer.record('a', at(0), 1000);
  buffer.record('a', at(10), 1100);

  const pose = buffer.poseAt('a', 5000);
  assert.equal(pose.position.x, 10);
});

test('poseAt holds the earliest sample before the buffer starts', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  buffer.record('a', at(4), 1000);

  const pose = buffer.poseAt('a', 1000);  // renders at 900, before any sample
  assert.equal(pose.position.x, 4);
});

test('out-of-order arrivals are ordered by timestamp, duplicates are ignored', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  buffer.record('a', at(10), 1100);
  buffer.record('a', at(0), 1000);
  buffer.record('a', at(99), 1000);

  const pose = buffer.poseAt('a', 1150);
  assert.equal(pose.position.x, 5);
});

test('the buffer evicts the oldest samples beyond its size', () => {
  const buffer = createPoseBuffer({ delayMs: 0, size: 2 });
  buffer.record('a', at(0), 1000);
  buffer.record('a', at(1), 1100);
  buffer.record('a', at(2), 1200);

  assert.equal(buffer.poseAt('a', 1000).position.x, 1);
});

test('unreadable samples and unknown users yield no pose', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  assert.equal(buffer.record('a', { position: 'nonsense', rotation: null }, 1000), false);
  assert.equal(buffer.poseAt('a', 1200), null);
  assert.equal(buffer.poseAt('ghost', 1200), null);
  assert.deepEqual(buffer.userIds(), []);
});

test('staleness measures time since the newest sample, and forget clears a user', () => {
  const buffer = createPoseBuffer({ delayMs: 100 });
  buffer.record('a', at(0), 1000);

  assert.equal(buffer.stalenessMs('a', 1400), 400);
  buffer.forget('a');
  assert.equal(buffer.stalenessMs('a', 1400), null);
  assert.deepEqual(buffer.userIds(), []);
});
