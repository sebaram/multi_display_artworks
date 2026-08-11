import assert from 'node:assert/strict';
import test from 'node:test';

import { mountHandTracking } from '../../app/metamuseum/static/js/room/interaction/hand-tracking.js';

test('hand tracking publisher sends camera pose through the injected socket client', () => {
  const camera = {
    getAttribute(name) {
      return name === 'position' ? '1 2 3' : '0 90 0';
    },
  };
  const emitted = [];
  let intervalCallback;
  let clearedTimer;

  const controller = mountHandTracking({
    document: {
      body: { appendChild() {} },
      createElement() { return { style: {}, addEventListener() {}, remove() {} }; },
      getElementById(id) { return id === 'camera' ? camera : null; },
    },
    navigator: {},
    socketClient: { emit: (...args) => emitted.push(args) },
    roomId: 'room-a',
    setInterval(callback) {
      intervalCallback = callback;
      return 17;
    },
    clearInterval(timer) {
      clearedTimer = timer;
    },
    requestAnimationFrame() {},
    now: () => 1000,
    console: { error() {} },
  });

  intervalCallback();
  assert.deepEqual(emitted, [[
    'position_update',
    {
      room_id: 'room-a',
      position: '1 2 3',
      rotation: '0 90 0',
      leftHand: null,
      rightHand: null,
      handTracking: false,
    },
  ]]);

  controller.destroy();
  assert.equal(clearedTimer, 17);
});
