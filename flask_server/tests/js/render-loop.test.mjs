// flask_server/tests/js/render-loop.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderLoop } from '../../app/metamuseum/static/js/room/rendering/render-loop.js';

function fakeScene() {
  const AFRAME = {
    components: {},
    registerComponent(name, definition) { this.components[name] = definition; },
  };
  const mounted = new Map();
  const scene = {
    setAttribute(name) { mounted.set(name, { ...AFRAME.components[name], el: scene }); },
    removeAttribute(name) { mounted.delete(name); },
    step() { mounted.forEach((component) => component.tick()); },
  };
  return { AFRAME, scene };
}

test('scene frames apply poses while window animation frames are suspended', () => {
  const { AFRAME, scene } = fakeScene();
  const applied = [];
  const loop = createRenderLoop({
    AFRAME, scene,
    poseBuffer: { userIds: () => ['peer'], poseAt: () => ({ position: { x: 3, y: 1.6, z: 0 } }) },
    applyPoses: (poses) => applied.push(poses),
    now: () => 500,
  });
  loop.start();
  scene.step();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].get('peer').position.x, 3);
  loop.destroy();
  scene.step();
  assert.equal(applied.length, 1);
});

test('each frame applies an interpolated pose for every known user', () => {
  const { AFRAME, scene } = fakeScene();
  const applied = [];
  const poseBuffer = {
    userIds: () => ['a', 'b'],
    poseAt: (userId, renderTime) => ({ userId, renderTime }),
  };

  const loop = createRenderLoop({
    AFRAME, scene,
    poseBuffer,
    applyPoses: (poses) => applied.push(poses),
    now: () => 500,
  });
  loop.start();
  scene.step();

  assert.equal(applied.length, 1);
  assert.deepEqual([...applied[0].keys()], ['a', 'b']);
  assert.deepEqual(applied[0].get('a'), { userId: 'a', renderTime: 500 });
});

test('users without a usable pose are omitted rather than passed as null', () => {
  const { AFRAME, scene } = fakeScene();
  const applied = [];

  const loop = createRenderLoop({
    AFRAME, scene,
    poseBuffer: { userIds: () => ['a'], poseAt: () => null },
    applyPoses: (poses) => applied.push(poses),
    now: () => 0,
  });
  loop.start();
  scene.step();

  assert.equal(applied[0].size, 0);
});

test('start is idempotent and destroy stops scene updates', () => {
  const { AFRAME, scene } = fakeScene();
  let calls = 0;
  const loop = createRenderLoop({
    AFRAME, scene,
    poseBuffer: { userIds: () => [], poseAt: () => null },
    applyPoses: () => { calls += 1; },
    now: () => 0,
  });

  loop.start();
  loop.start();
  scene.step();
  scene.step();
  assert.equal(calls, 2);

  loop.destroy();
  scene.step();
  assert.equal(calls, 2);
});

test('a throwing applyPoses is reported without interrupting the scene frame', () => {
  const { AFRAME, scene } = fakeScene();
  let calls = 0;
  const errors = [];
  const loop = createRenderLoop({
    AFRAME, scene,
    console: { error: (...args) => errors.push(args) },
    poseBuffer: { userIds: () => [], poseAt: () => null },
    applyPoses: () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
    },
    now: () => 0,
  });

  loop.start();
  assert.doesNotThrow(() => scene.step());
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0][1].message, /boom/);

  assert.doesNotThrow(() => scene.step());
  assert.equal(calls, 2);
});
