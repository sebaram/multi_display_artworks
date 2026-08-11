import assert from 'node:assert/strict';
import test from 'node:test';

import * as handTracking from '../../app/metamuseum/static/js/room/interaction/hand-tracking.js';

const { mountHandTracking } = handTracking;

test('XRJointSpace data is read through XRFrame.getJointPose', () => {
  assert.equal(typeof handTracking.collectHandPoses, 'function');
  const referenceSpace = {};
  const wrist = {};
  const thumbTip = {};
  const source = {
    handedness: 'left',
    hand: new Map([
      ['wrist', wrist],
      ['thumb-tip', thumbTip],
    ]),
  };
  const calls = [];
  const frame = {
    getJointPose(jointSpace, space) {
      calls.push([jointSpace, space]);
      if (jointSpace !== wrist) return null;
      return {
        transform: {
          position: { x: 1, y: 2, z: 3 },
          orientation: { x: 0, y: 0.5, z: 0, w: 0.5 },
        },
      };
    },
  };

  assert.deepEqual(handTracking.collectHandPoses(frame, referenceSpace, [source]), {
    leftHand: {
      wrist: { position: [1, 2, 3], rotation: [0, 0.5, 0, 0.5] },
      thumbTip: null,
      indexTip: null,
      middleTip: null,
    },
    rightHand: null,
  });
  assert.deepEqual(calls, [[wrist, referenceSpace], [thumbTip, referenceSpace]]);
});

test('hand tracking publishes only real joint poses from the WebXR animation frame', async () => {
  const camera = {
    getAttribute(name) {
      return name === 'position' ? '1 2 3' : '0 90 0';
    },
  };
  let click;
  let xrFrameCallback;
  const wrist = {};
  const referenceSpace = {};
  const session = {
    inputSources: [{ handedness: 'left', hand: new Map([['wrist', wrist]]) }],
    addEventListener() {},
    requestReferenceSpace: async () => referenceSpace,
    requestAnimationFrame(callback) {
      xrFrameCallback = callback;
    },
  };
  const emitted = [];
  const raised = [];
  mountHandTracking({
    document: {
      body: { appendChild() {} },
      createElement() {
        return {
          style: {},
          addEventListener(type, listener) {
            if (type === 'click') click = listener;
          },
          remove() {},
        };
      },
      getElementById(id) { return id === 'camera' ? camera : null; },
    },
    navigator: {
      xr: {
        isSessionSupported: async () => true,
        requestSession: async () => session,
      },
    },
    socketClient: { emit: (...args) => emitted.push(args) },
    roomId: 'room-a',
    setInterval() { return 17; },
    clearInterval() {},
    requestAnimationFrame() {
      throw new Error('window animation frames cannot provide XRFrame');
    },
    now: () => 1000,
    console: { error() {} },
    onHandRaiseDetected: (side) => raised.push(side),
  });
  await Promise.resolve();
  await Promise.resolve();

  await click();
  assert.equal(typeof xrFrameCallback, 'function');
  assert.deepEqual(emitted, []);

  xrFrameCallback(1000, { getJointPose: () => null });
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0][1], {
    room_id: 'room-a',
    position: '1 2 3',
    rotation: '0 90 0',
    leftHand: null,
    rightHand: null,
    handTracking: false,
  });

  xrFrameCallback(1100, {
    getViewerPose(space) {
      assert.equal(space, referenceSpace);
      return { transform: { position: { y: 4.7 } } };
    },
    getJointPose(jointSpace, space) {
      assert.equal(jointSpace, wrist);
      assert.equal(space, referenceSpace);
      return {
        transform: {
          position: { x: 4, y: 5, z: 6 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      };
    },
  });
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted[1][1].leftHand.wrist.position, [4, 5, 6]);
  assert.equal(emitted[1][1].handTracking, true);
  assert.deepEqual(raised, ['left']);

  xrFrameCallback(1200, { getJointPose: () => null });
  assert.equal(emitted.length, 3);
  assert.deepEqual(emitted[2][1], {
    room_id: 'room-a',
    position: '1 2 3',
    rotation: '0 90 0',
    leftHand: null,
    rightHand: null,
    handTracking: false,
  });
});

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
