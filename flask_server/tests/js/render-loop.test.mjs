// flask_server/tests/js/render-loop.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderLoop } from '../../app/metamuseum/static/js/room/rendering/render-loop.js';

function fakeScheduler() {
  const frames = [];
  return {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame(handle) {
      frames[handle - 1] = null;
    },
    step() {
      const pending = frames.pop();
      frames.length = 0;
      pending?.();
    },
    get pending() {
      return frames.filter(Boolean).length;
    },
  };
}

test('each frame applies an interpolated pose for every known user', () => {
  const scheduler = fakeScheduler();
  const applied = [];
  const poseBuffer = {
    userIds: () => ['a', 'b'],
    poseAt: (userId, renderTime) => ({ userId, renderTime }),
  };

  const loop = createRenderLoop({
    poseBuffer,
    applyPoses: (poses) => applied.push(poses),
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    now: () => 500,
  });
  loop.start();
  scheduler.step();

  assert.equal(applied.length, 1);
  assert.deepEqual([...applied[0].keys()], ['a', 'b']);
  assert.deepEqual(applied[0].get('a'), { userId: 'a', renderTime: 500 });
});

test('users without a usable pose are omitted rather than passed as null', () => {
  const scheduler = fakeScheduler();
  const applied = [];

  const loop = createRenderLoop({
    poseBuffer: { userIds: () => ['a'], poseAt: () => null },
    applyPoses: (poses) => applied.push(poses),
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    now: () => 0,
  });
  loop.start();
  scheduler.step();

  assert.equal(applied[0].size, 0);
});

test('the loop reschedules itself while running and stops on destroy', () => {
  const scheduler = fakeScheduler();
  const loop = createRenderLoop({
    poseBuffer: { userIds: () => [], poseAt: () => null },
    applyPoses: () => {},
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    now: () => 0,
  });

  loop.start();
  scheduler.step();
  assert.equal(scheduler.pending, 1);

  loop.destroy();
  scheduler.step();
  assert.equal(scheduler.pending, 0);
});

test('a throwing applyPoses does not stop the loop from rescheduling', () => {
  const scheduler = fakeScheduler();
  let calls = 0;
  const loop = createRenderLoop({
    poseBuffer: { userIds: () => [], poseAt: () => null },
    applyPoses: () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
    },
    requestAnimationFrame: scheduler.requestAnimationFrame,
    cancelAnimationFrame: scheduler.cancelAnimationFrame,
    now: () => 0,
  });

  loop.start();
  assert.throws(() => scheduler.step(), /boom/);
  assert.equal(calls, 1);
  assert.equal(scheduler.pending, 1); // still rescheduled itself despite the throw

  assert.doesNotThrow(() => scheduler.step());
  assert.equal(calls, 2);
});
