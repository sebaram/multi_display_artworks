import assert from 'node:assert/strict';
import test from 'node:test';

import { createPosePublisher } from '../../app/metamuseum/static/js/room/core/pose-publisher.js';
import {
  HEARTBEAT_MS, MIN_SEND_INTERVAL_MS,
} from '../../app/metamuseum/static/js/room/core/sync-constants.js';

const still = { position: { x: 0, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };

test('the first sample is always sent', () => {
  const publisher = createPosePublisher();
  assert.equal(publisher.shouldSend(still, 0), true);
});

test('an unchanged pose is suppressed until the heartbeat falls due', () => {
  const publisher = createPosePublisher();
  publisher.shouldSend(still, 0);

  assert.equal(publisher.shouldSend(still, HEARTBEAT_MS - 1), false);
  assert.equal(publisher.shouldSend(still, HEARTBEAT_MS), true);
});

test('movement past the position threshold is sent, movement below it is not', () => {
  const publisher = createPosePublisher();
  publisher.shouldSend(still, 0);

  const nudged = { ...still, position: { x: 0.005, y: 1.6, z: 0 } };
  assert.equal(publisher.shouldSend(nudged, MIN_SEND_INTERVAL_MS), false);

  const moved = { ...still, position: { x: 0.5, y: 1.6, z: 0 } };
  assert.equal(publisher.shouldSend(moved, MIN_SEND_INTERVAL_MS * 2), true);
});

test('rotation past the threshold is sent even when position is identical', () => {
  const publisher = createPosePublisher();
  publisher.shouldSend(still, 0);

  const turned = { ...still, rotation: { x: 0, y: 30, z: 0 } };
  assert.equal(publisher.shouldSend(turned, MIN_SEND_INTERVAL_MS), true);
});

test('continuous motion is capped at the maximum send rate', () => {
  const publisher = createPosePublisher();
  let sent = 0;

  for (let ms = 0; ms < 1000; ms += 10) {
    const moving = { ...still, position: { x: ms / 10, y: 1.6, z: 0 } };
    if (publisher.shouldSend(moving, ms)) sent += 1;
  }

  assert.equal(sent, 1000 / MIN_SEND_INTERVAL_MS);
});

test('the string pose shape from room state is understood', () => {
  const publisher = createPosePublisher();
  assert.equal(publisher.shouldSend({ position: '0 1.6 0', rotation: '0 0 0' }, 0), true);
  // Same pose in the object shape: suppressed by the change test, not the rate cap.
  assert.equal(publisher.shouldSend({ position: { x: 0, y: 1.6, z: 0 }, rotation: '0 0 0' }, 100), false);
});

test('an unreadable pose is never sent', () => {
  const publisher = createPosePublisher();
  assert.equal(publisher.shouldSend({ position: null, rotation: null }, 0), false);
});
