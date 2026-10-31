import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale } from '../../../src/app/locale-state.js';

import * as handTracking from '../../../src/scene/legacy/interaction/hand-tracking.js';
import { createPosePublisher } from '../../../src/scene/legacy/core/pose-publisher.js';

const { mountHandTracking } = handTracking;

test('VR entry label changes in place without requesting a session and unsubscribes on destroy', async () => {
  setLocale('en');
  const button = { style: {}, addEventListener() {}, remove() {} };
  let requested = 0;
  const controller = mountHandTracking({
    document: { body: { appendChild() {} }, createElement: () => button },
    navigator: { xr: { isSessionSupported: async () => true, requestSession: () => { requested++; } } },
    setInterval: () => 1, clearInterval() {},
  });
  await Promise.resolve();
  assert.equal(button.textContent, '🤚 Enter VR / Hands');
  setLocale('ko');
  assert.equal(button.textContent, '🤚 VR / 손 추적 시작');
  assert.equal(requested, 0);
  controller.destroy();
  setLocale('en');
  assert.equal(button.textContent, '🤚 VR / 손 추적 시작');
});

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

test("borrows renderer current frame/reference space, clears end state and never owns session/RAF", () => {
  const referenceSpace = {},
    wrist = {},
    handlers = new Map(),
    emitted = [],
    raised = [];
  let requested = 0,
    ended = 0,
    raf = 0,
    clock = 1000;
  const session = {
    inputSources: [{ handedness: "left", hand: new Map([["wrist", wrist]]) }],
    addEventListener: (e, f) => handlers.set(e, f),
    removeEventListener: (e) => handlers.delete(e),
    end() {
      ended++;
    },
    requestAnimationFrame() {
      raf++;
    },
  };
  let currentSession = session;
  let frame = {
    getJointPose: () => ({
      transform: {
        position: { x: 4, y: 5, z: 6 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    }),
    getViewerPose: () => ({ transform: { position: { y: 4.7 } } }),
  };
  const scene = {
    renderer: {
      xr: {
        getSession: () => currentSession,
        getFrame: () => frame,
        getReferenceSpace: () => referenceSpace,
      },
    },
  };
  const camera = {
    getAttribute: (name) => (name === "position" ? "1 2 3" : "0 90 0"),
  };
  const controller = mountHandTracking({
    scene,
    document: {
      getElementById: () => camera,
      body: { appendChild() {} },
      createElement: () => ({ style: {}, addEventListener() {}, remove() {} }),
    },
    navigator: {
      xr: {
        isSessionSupported: async () => true,
        requestSession() {
          requested++;
        },
      },
    },
    socketClient: { emit: (...args) => emitted.push(args) },
    roomId: "room-a",
    setInterval() {
      return 17;
    },
    clearInterval() {},
    console,
    now: () => clock,
    posePublisher: createPosePublisher(),
    onHandRaiseDetected: (s) => raised.push(s),
    cameraPose: () => ({
      position: { x: 10, y: 5, z: 20 },
      rotation: { x: 0, y: 90, z: 0 },
    }),
  });
  controller.tick(clock);
  assert.deepEqual(emitted[0][1].leftHand.wrist.position, [4, 5, 6]);
  assert.deepEqual(emitted[0][1].position, { x: 10, y: 5, z: 20 });
  assert.deepEqual(raised, ["left"]);
  clock += 100;
  frame = { getJointPose: () => null };
  controller.tick(clock);
  assert.equal(emitted.at(-1)[1].leftHand, null);
  assert.equal(emitted.at(-1)[1].handTracking, false);
  currentSession = null;
  handlers.get("end")();
  controller.destroy();
  assert.equal(requested, 0);
  assert.equal(ended, 0);
  assert.equal(raf, 0);
  assert.equal(handlers.size, 0);
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
    posePublisher: createPosePublisher(),
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

test('a stationary camera emits at the heartbeat rate, not every tick', () => {
  const emitted = [];
  let clock = 0;
  const timers = [];
  const camera = { getAttribute: (name) => (name === 'position' ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0, z: 0 }) };

  mountHandTracking({
    document: { getElementById: () => camera, createElement: () => ({ style: {}, addEventListener() {} }), body: { appendChild() {} } },
    navigator: {},
    socketClient: { emit: (event, payload) => emitted.push([event, payload]) },
    roomId: 'room',
    setInterval: (callback) => { timers.push(callback); return timers.length; },
    clearInterval: () => {},
    console,
    now: () => clock,
    posePublisher: createPosePublisher(),
  });

  for (let tick = 0; tick < 20; tick += 1) {
    clock += 50;
    timers.forEach((callback) => callback());
  }

  assert.equal(emitted.length, 1); // first sample at 50 ms; heartbeat not due until 1050 ms
});

test('a failed emit resets the publisher so the pose is retried once reconnected', () => {
  const emitted = [];
  let clock = 0;
  const timers = [];
  const camera = { getAttribute: (name) => (name === 'position' ? { x: 0, y: 1.6, z: 0 } : { x: 0, y: 0, z: 0 }) };
  let connected = false;

  mountHandTracking({
    document: { getElementById: () => camera, createElement: () => ({ style: {}, addEventListener() {} }), body: { appendChild() {} } },
    navigator: {},
    socketClient: { emit: (event, payload) => { emitted.push([event, payload]); return connected; } },
    roomId: 'room',
    setInterval: (callback) => { timers.push(callback); return timers.length; },
    clearInterval: () => {},
    console,
    now: () => clock,
    posePublisher: createPosePublisher(),
  });

  timers.forEach((callback) => callback()); // socket disconnected: emit() returns false
  assert.equal(emitted.length, 1);

  clock += 50; // well inside the heartbeat window
  connected = true;
  timers.forEach((callback) => callback());
  // Without the reset-on-failed-emit fix, the publisher would still believe it sent
  // the first pose and suppress this one until the 1000 ms heartbeat.
  assert.equal(emitted.length, 2);
});
