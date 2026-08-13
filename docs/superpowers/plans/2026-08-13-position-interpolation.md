# Position Sync Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remote avatars move smoothly and promptly by sending pose updates only when they change and rendering interpolated poses every frame, instead of emitting on a fixed 100 ms timer and hard-setting transforms on arrival.

**Architecture:** Two new pure modules decide *when to send* (`pose-publisher`) and *what to draw* (`pose-buffer`). `rendering/scene.js` splits its single `renderUsers` entry point into `syncRoster` (roster events only) and `applyPoses` (once per frame). A `requestAnimationFrame` loop reads interpolated poses from the buffer and hands them to `applyPoses`. The Socket.IO wire format and all server handlers are unchanged except one boolean flag for the debug overlay.

**Tech Stack:** Vanilla ES modules (no bundler, no framework), A-Frame 1.6 entities, `node --test` for unit tests (`npm run test:js`), Flask + Jinja for the one server flag.

**Spec:** `docs/superpowers/specs/2026-08-13-position-interpolation-design.md`

## Global Constraints

- All room client code lives under `flask_server/app/metamuseum/static/js/room/` and is loaded as native ES modules. No build step, no bundler, no new npm dependencies.
- **Room modules may not use `URLSearchParams` or `searchParams`** — `tests/js/module-boundaries.test.mjs` asserts this for every `.js` file under `static/js/room/`.
- **Room modules may not read first-party `window.*` globals.** Only the allowlist in `module-boundaries.test.mjs` is permitted (`document`, `requestAnimationFrame`, `cancelAnimationFrame`, `setInterval`, `clearInterval`, `console`, `navigator`, `io`, …). Pass everything else in as a parameter.
- Modules take their browser dependencies as injected parameters (see `mountHandTracking`, `createSceneRenderer`) so tests can pass fakes. Follow that pattern exactly.
- Tests run from `flask_server/` with `npm run test:js`. Test files are `tests/js/<name>.test.mjs`, using `node:test` and `node:assert/strict`.
- Poses arrive in two shapes and both must be handled: `presence_service` seeds joins with the string `'0 1.6 0'`, while live `position_update` packets carry `{x, y, z}` objects.
- Rotation values are **degrees** everywhere on the wire and in A-Frame attributes. `object3D.rotation` is in **radians** — convert when writing to it.
- Python tests run with `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test SECRET_KEY=test-secret SECURITY_PASSWORD_SALT=test-salt python -m pytest tests -q`.

---

### Task 1: Pose value helpers

Pure vector helpers shared by the publisher and the buffer. No DOM, no imports.

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/core/pose.js`
- Test: `flask_server/tests/js/pose.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `toVec3(value) -> {x, y, z} | null`, `maxAxisDelta(a, b) -> number` (`Infinity` when either side is null), `lerpVec3(a, b, t) -> {x, y, z}`, `lerpAngles(a, b, t) -> {x, y, z}` (per-axis shortest arc, degrees).

- [ ] **Step 1: Write the failing test**

```javascript
// flask_server/tests/js/pose.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server && npm run test:js -- --test-name-pattern=toVec3`
Expected: FAIL — `Cannot find module .../core/pose.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// flask_server/app/metamuseum/static/js/room/core/pose.js
const AXES = ['x', 'y', 'z'];

function finite(value) {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

export function toVec3(value) {
  if (value == null) return null;

  const parts = typeof value === 'string'
    ? value.trim().split(/\s+/u)
    : Array.isArray(value)
      ? value
      : AXES.map((axis) => value[axis]);

  if (parts.length !== 3) return null;

  const [x, y, z] = parts.map(finite);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

export function maxAxisDelta(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(...AXES.map((axis) => Math.abs(a[axis] - b[axis])));
}

function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

export function lerpVec3(a, b, t) {
  const ratio = clamp01(t);
  return Object.fromEntries(
    AXES.map((axis) => [axis, a[axis] + (b[axis] - a[axis]) * ratio]),
  );
}

function shortestArc(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function lerpAngles(a, b, t) {
  const ratio = clamp01(t);
  return Object.fromEntries(
    AXES.map((axis) => [axis, a[axis] + shortestArc(a[axis], b[axis]) * ratio]),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS — the new `pose.test.mjs` cases pass and the existing suite is unchanged.

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/core/pose.js flask_server/tests/js/pose.test.mjs
git commit -m "feat: add pose vector helpers for position sync"
```

---

### Task 2: Send-side publisher and tunable constants

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/core/sync-constants.js`
- Create: `flask_server/app/metamuseum/static/js/room/core/pose-publisher.js`
- Test: `flask_server/tests/js/pose-publisher.test.mjs`

**Interfaces:**
- Consumes: `toVec3`, `maxAxisDelta` from `core/pose.js`.
- Produces: constants `POSITION_EPSILON`, `ROTATION_EPSILON`, `HEARTBEAT_MS`, `MAX_SEND_HZ`, `MIN_SEND_INTERVAL_MS`, `INTERPOLATION_DELAY_MS`, `BUFFER_SIZE`; and `createPosePublisher(options) -> { shouldSend(pose, now) -> boolean }` where `pose` is `{ position, rotation }` in any shape `toVec3` accepts. `shouldSend` records the sample as sent when it returns `true`.

- [ ] **Step 1: Write the failing test**

```javascript
// flask_server/tests/js/pose-publisher.test.mjs
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
  assert.equal(publisher.shouldSend({ position: { x: 0, y: 1.6, z: 0 }, rotation: '0 0 0' }, 10), false);
});

test('an unreadable pose is never sent', () => {
  const publisher = createPosePublisher();
  assert.equal(publisher.shouldSend({ position: null, rotation: null }, 0), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `Cannot find module .../core/pose-publisher.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// flask_server/app/metamuseum/static/js/room/core/sync-constants.js
export const POSITION_EPSILON = 0.01;   // metres, per axis
export const ROTATION_EPSILON = 0.5;    // degrees, per axis
export const HEARTBEAT_MS = 1000;       // keeps server presence and late joiners correct
export const MAX_SEND_HZ = 20;
export const MIN_SEND_INTERVAL_MS = 1000 / MAX_SEND_HZ;
export const INTERPOLATION_DELAY_MS = 100;  // render this far behind wall clock
export const BUFFER_SIZE = 8;               // samples retained per user
```

```javascript
// flask_server/app/metamuseum/static/js/room/core/pose-publisher.js
import { maxAxisDelta, toVec3 } from './pose.js';
import {
  HEARTBEAT_MS, MIN_SEND_INTERVAL_MS, POSITION_EPSILON, ROTATION_EPSILON,
} from './sync-constants.js';

export function createPosePublisher({
  positionEpsilon = POSITION_EPSILON,
  rotationEpsilon = ROTATION_EPSILON,
  heartbeatMs = HEARTBEAT_MS,
  minIntervalMs = MIN_SEND_INTERVAL_MS,
} = {}) {
  let sentAt = null;
  let sentPosition = null;
  let sentRotation = null;

  return {
    shouldSend(pose, now) {
      const position = toVec3(pose?.position);
      const rotation = toVec3(pose?.rotation);
      if (!position || !rotation) return false;

      const elapsed = sentAt === null ? Infinity : now - sentAt;
      if (elapsed < minIntervalMs) return false;

      const changed = maxAxisDelta(sentPosition, position) > positionEpsilon
        || maxAxisDelta(sentRotation, rotation) > rotationEpsilon;

      if (!changed && elapsed < heartbeatMs) return false;

      sentAt = now;
      sentPosition = position;
      sentRotation = rotation;
      return true;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/core/sync-constants.js flask_server/app/metamuseum/static/js/room/core/pose-publisher.js flask_server/tests/js/pose-publisher.test.mjs
git commit -m "feat: send pose updates only when they change"
```

---

### Task 3: Receive-side interpolation buffer

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/core/pose-buffer.js`
- Test: `flask_server/tests/js/pose-buffer.test.mjs`

**Interfaces:**
- Consumes: `toVec3`, `lerpVec3`, `lerpAngles` from `core/pose.js`; `INTERPOLATION_DELAY_MS`, `BUFFER_SIZE` from `core/sync-constants.js`.
- Produces: `createPoseBuffer(options) -> { record(userId, pose, receivedAt) -> boolean, poseAt(userId, renderTime) -> {position, rotation} | null, stalenessMs(userId, now) -> number | null, forget(userId), userIds() -> string[] }`. `record` returns `true` when this is the first sample for that user, which is how the caller knows the roster changed.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `Cannot find module .../core/pose-buffer.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// flask_server/app/metamuseum/static/js/room/core/pose-buffer.js
import { lerpAngles, lerpVec3, toVec3 } from './pose.js';
import { BUFFER_SIZE, INTERPOLATION_DELAY_MS } from './sync-constants.js';

export function createPoseBuffer({
  delayMs = INTERPOLATION_DELAY_MS,
  size = BUFFER_SIZE,
} = {}) {
  const samplesByUser = new Map();

  function insert(samples, sample) {
    const existing = samples.findIndex((entry) => entry.at === sample.at);
    if (existing !== -1) return;

    const before = samples.filter((entry) => entry.at < sample.at).length;
    samples.splice(before, 0, sample);
    if (samples.length > size) samples.shift();
  }

  return {
    record(userId, pose, receivedAt) {
      const position = toVec3(pose?.position);
      const rotation = toVec3(pose?.rotation);
      if (!userId || !position || !rotation) return false;

      const isNew = !samplesByUser.has(userId);
      if (isNew) samplesByUser.set(userId, []);
      insert(samplesByUser.get(userId), { at: receivedAt, position, rotation });
      return isNew;
    },

    poseAt(userId, renderTime) {
      const samples = samplesByUser.get(userId);
      if (!samples?.length) return null;

      const target = renderTime - delayMs;
      const newest = samples[samples.length - 1];
      if (target >= newest.at) return { position: newest.position, rotation: newest.rotation };

      const oldest = samples[0];
      if (target <= oldest.at) return { position: oldest.position, rotation: oldest.rotation };

      const nextIndex = samples.findIndex((entry) => entry.at > target);
      const from = samples[nextIndex - 1];
      const to = samples[nextIndex];
      const span = to.at - from.at;
      const ratio = span === 0 ? 1 : (target - from.at) / span;

      return {
        position: lerpVec3(from.position, to.position, ratio),
        rotation: lerpAngles(from.rotation, to.rotation, ratio),
      };
    },

    stalenessMs(userId, now) {
      const samples = samplesByUser.get(userId);
      if (!samples?.length) return null;
      return now - samples[samples.length - 1].at;
    },

    forget(userId) {
      samplesByUser.delete(userId);
    },

    userIds() {
      return [...samplesByUser.keys()];
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/core/pose-buffer.js flask_server/tests/js/pose-buffer.test.mjs
git commit -m "feat: interpolate remote poses from a timestamped buffer"
```

---

### Task 4: Split the scene renderer into roster and pose passes

`renderUsers` currently does roster reconciliation *and* transform writing on every packet, and `updateHands` (`scene.js:60`) destroys and rebuilds both hand entities on every call. Under a per-frame loop that rebuild would be ruinous, so it becomes change-gated here.

**Files:**
- Modify: `flask_server/app/metamuseum/static/js/room/rendering/scene.js:60-121`
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js:126,226` (rename call sites only)
- Modify: `flask_server/tests/js/scene.test.mjs:75,99,114`, `flask_server/tests/js/socket-consumers.test.mjs:33,50`, `flask_server/tests/js/room-realtime.test.mjs:64,125,163`
- Test: `flask_server/tests/js/scene.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createSceneRenderer(...)` now returns `{ syncRoster(users), applyPoses(posesByUserId), destroy() }`. `renderUsers` no longer exists. `applyPoses` takes a `Map<userId, {position: {x,y,z}, rotation: {x,y,z}}>`. `consumers.renderUsers` becomes `consumers.syncRoster`.

- [ ] **Step 1: Write the failing test**

Append to `flask_server/tests/js/scene.test.mjs`. The `FakeElement`/`createDocument` helpers already at the top of that file are reused as-is.

```javascript
test('applyPoses writes transforms without touching the roster', () => {
  const scene = new FakeElement('a-scene');
  const renderer = createSceneRenderer({
    document: createDocument(scene),
    scene,
    selfId: 'self',
    createAvatarEntity: () => new FakeElement('a-entity'),
  });

  renderer.syncRoster([{ userId: 'other', displayName: 'Other' }]);
  const created = scene.children.length;

  renderer.applyPoses(new Map([['other', {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 90, z: 0 },
  }]]));

  const camera = scene.children.find((child) => child.getAttribute('id') === 'camera-other');
  assert.equal(scene.children.length, created);
  assert.deepEqual(camera.getAttribute('position'), { x: 1, y: 2, z: 3 });
  assert.deepEqual(camera.getAttribute('rotation'), { x: 0, y: 90, z: 0 });
});

test('applyPoses prefers object3D and converts rotation to radians', () => {
  const scene = new FakeElement('a-scene');
  const renderer = createSceneRenderer({
    document: createDocument(scene),
    scene,
    selfId: 'self',
    createAvatarEntity: () => new FakeElement('a-entity'),
  });

  renderer.syncRoster([{ userId: 'other' }]);
  const camera = scene.children.find((child) => child.getAttribute('id') === 'camera-other');
  const written = { position: null, rotation: null };
  camera.object3D = {
    position: { set: (x, y, z) => { written.position = { x, y, z }; } },
    rotation: { set: (x, y, z) => { written.rotation = { x, y, z }; } },
  };

  renderer.applyPoses(new Map([['other', {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 180, z: 0 },
  }]]));

  assert.deepEqual(written.position, { x: 1, y: 2, z: 3 });
  assert.equal(Math.round(written.rotation.y * 1000), Math.round(Math.PI * 1000));
  assert.equal(camera.getAttribute('position'), null);
});

test('unchanged hand payloads do not rebuild hand entities', () => {
  const scene = new FakeElement('a-scene');
  const document = createDocument(scene);
  const renderer = createSceneRenderer({
    document, scene, selfId: 'self', createAvatarEntity: () => new FakeElement('a-entity'),
  });

  const user = {
    userId: 'other',
    handTracking: true,
    leftHand: { wrist: { position: [0, 1, 0] } },
  };
  renderer.syncRoster([user]);
  const firstHand = document.getElementById('hand-left-other');

  renderer.syncRoster([{ ...user }]);
  assert.equal(document.getElementById('hand-left-other'), firstHand);

  renderer.syncRoster([{ ...user, leftHand: { wrist: { position: [0, 2, 0] } } }]);
  assert.notEqual(document.getElementById('hand-left-other'), firstHand);
});
```

Also update the three existing `renderer.renderUsers(...)` calls at `scene.test.mjs:75,99,114` to `renderer.syncRoster(...)`, and the `renderUsers` keys in `socket-consumers.test.mjs:33,50` and `room-realtime.test.mjs:64,125,163` to `syncRoster`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `renderer.syncRoster is not a function`

- [ ] **Step 3: Write the implementation**

In `scene.js`, replace `updateHands` (line 60) with a change-gated version:

```javascript
function handKey(user) {
  const enabled = user.handTracking === true || user.handTracking?.enabled === true;
  if (!enabled) return 'off';
  return JSON.stringify([user.leftHand ?? null, user.rightHand ?? null]);
}

function updateHands(document, camera, user) {
  const key = handKey(user);
  if (camera.getAttribute('data-hand-key') === key) return;
  camera.setAttribute('data-hand-key', key);

  ['left', 'right'].forEach((side) => {
    const id = `hand-${side}-${user.userId}`;
    removeElement(document.getElementById(id));
    const handData = key === 'off' ? null : user[side === 'left' ? 'leftHand' : 'rightHand'];
    const hand = createHandEntity(document, handData, side);
    if (!hand) return;
    hand.setAttribute('id', id);
    camera.appendChild(hand);
  });
}
```

Then replace the `createSceneRenderer` body (lines 89-121):

```javascript
const DEG_TO_RAD = Math.PI / 180;

function writeTransform(camera, pose) {
  if (camera.object3D?.position?.set && camera.object3D?.rotation?.set) {
    camera.object3D.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.object3D.rotation.set(
      pose.rotation.x * DEG_TO_RAD,
      pose.rotation.y * DEG_TO_RAD,
      pose.rotation.z * DEG_TO_RAD,
    );
    return;
  }
  camera.setAttribute('position', pose.position);
  camera.setAttribute('rotation', pose.rotation);
}

export function createSceneRenderer({ document, scene, selfId, createAvatarEntity }) {
  const renderedIds = new Set();

  function syncRoster(users = []) {
    const activeIds = new Set();

    users.forEach((user) => {
      if (!user?.userId || user.userId === selfId) return;
      const cameraId = `camera-${user.userId}`;
      activeIds.add(cameraId);

      const camera = document.getElementById(cameraId) ?? createRemoteCamera(document, scene, user);
      renderedIds.add(cameraId);
      updateProfile(camera, user, createAvatarEntity);
      updateHands(document, camera, user);
    });

    for (const cameraId of renderedIds) {
      if (activeIds.has(cameraId)) continue;
      removeElement(document.getElementById(cameraId));
      renderedIds.delete(cameraId);
    }
  }

  function applyPoses(poses) {
    poses.forEach((pose, userId) => {
      if (userId === selfId || !pose) return;
      const camera = document.getElementById(`camera-${userId}`);
      if (camera) writeTransform(camera, pose);
    });
  }

  return {
    syncRoster,
    applyPoses,
    destroy() {
      syncRoster([]);
    },
  };
}
```

In `bootstrap.js`, rename the closure at line 126 and the consumer key at line 226:

```javascript
  const syncRoster = () => consumers.syncRoster?.(
    state.users().filter((user) => user.position != null && user.rotation != null),
  );
```

```javascript
    syncRoster: sceneRenderer.syncRoster,
```

Update the four call sites at `bootstrap.js:142,150,155,159` from `renderUsers()` to `syncRoster()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS — all suites, including the renamed existing cases.

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/rendering/scene.js flask_server/app/metamuseum/static/js/room/bootstrap.js flask_server/tests/js
git commit -m "refactor: split scene roster reconciliation from pose writing"
```

---

### Task 5: Per-frame render loop

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/rendering/render-loop.js`
- Test: `flask_server/tests/js/render-loop.test.mjs`

**Interfaces:**
- Consumes: `poseBuffer.userIds()` and `poseBuffer.poseAt()` from Task 3; `applyPoses` from Task 4.
- Produces: `createRenderLoop({ poseBuffer, applyPoses, requestAnimationFrame, cancelAnimationFrame, now }) -> { start(), destroy() }`.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `Cannot find module .../rendering/render-loop.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// flask_server/app/metamuseum/static/js/room/rendering/render-loop.js
export function createRenderLoop({
  poseBuffer,
  applyPoses,
  requestAnimationFrame,
  cancelAnimationFrame,
  now,
}) {
  let handle = null;
  let running = false;

  function frame() {
    if (!running) return;
    const renderTime = now();
    const poses = new Map();

    poseBuffer.userIds().forEach((userId) => {
      const pose = poseBuffer.poseAt(userId, renderTime);
      if (pose) poses.set(userId, pose);
    });

    applyPoses(poses);
    handle = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      handle = requestAnimationFrame(frame);
    },
    destroy() {
      running = false;
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/rendering/render-loop.js flask_server/tests/js/render-loop.test.mjs
git commit -m "feat: drive remote avatar transforms from a per-frame loop"
```

---

### Task 6: Wire the buffer, publisher, and loop into the room

This is where behavior actually changes for a visitor. Position packets stop triggering renders; the 100 ms unconditional emit becomes change-driven.

**Files:**
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js:115-180` (realtime handlers) and `:293-360` (feature mounting)
- Modify: `flask_server/app/metamuseum/static/js/room/interaction/hand-tracking.js:63-74,147-149`
- Test: `flask_server/tests/js/room-realtime.test.mjs`, `flask_server/tests/js/hand-tracking.test.mjs`

**Interfaces:**
- Consumes: `createPoseBuffer` (Task 3), `createPosePublisher` (Task 2), `createRenderLoop` (Task 5), `syncRoster`/`applyPoses` (Task 4).
- Produces: `bootstrapRoomRealtime` returns `{ socketClient, state, poseBuffer, destroy }`. `mountHandTracking` gains two required parameters, `posePublisher` and `now`.

- [ ] **Step 1: Write the failing test**

Append to `flask_server/tests/js/room-realtime.test.mjs`, following the existing fake-socket setup in that file:

```javascript
test('position packets feed the pose buffer and do not sync the roster', () => {
  const rendered = [];
  const { socket, realtime } = startRealtime({ syncRoster: (users) => rendered.push(users) });

  socket.emitToClient('room_state', { users: [{ userId: 'other', displayName: 'Other' }] });
  const rostersAfterState = rendered.length;

  socket.emitToClient('position_update', {
    userId: 'other', position: { x: 1, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
  });
  socket.emitToClient('position_update', {
    userId: 'other', position: { x: 2, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
  });

  assert.equal(rendered.length, rostersAfterState + 1);  // only the first, unknown user
  assert.deepEqual(realtime.poseBuffer.userIds(), ['other']);
});

test('a departing user is dropped from the pose buffer', () => {
  const { socket, realtime } = startRealtime({ syncRoster() {} });

  socket.emitToClient('position_update', {
    userId: 'other', position: { x: 1, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
  });
  socket.emitToClient('user_left', { userId: 'other' });

  assert.deepEqual(realtime.poseBuffer.userIds(), []);
});
```

Add a `startRealtime(consumers)` helper to that file if one does not already exist, built from the fake `ioFactory` the existing tests use, returning `{ socket, realtime }`.

Append to `flask_server/tests/js/hand-tracking.test.mjs`:

```javascript
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

  assert.equal(emitted.length, 1);  // first sample at 50 ms; heartbeat not due until 1050 ms
});
```

Import `createPosePublisher` at the top of that test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `realtime.poseBuffer is undefined`, and the hand-tracking case sees 20 emits instead of 1.

- [ ] **Step 3: Write the implementation**

In `bootstrap.js`, import the new modules and change `bootstrapRoomRealtime`:

```javascript
import { createPoseBuffer } from './core/pose-buffer.js';
import { createPosePublisher } from './core/pose-publisher.js';
import { createRenderLoop } from './rendering/render-loop.js';
```

```javascript
  const poseBuffer = createPoseBuffer();
```

```javascript
    position_update(data) {
      state.applyUpdate(data);
      if (poseBuffer.record(data?.userId, data, Date.now())) syncRoster();
    },
```

```javascript
    user_left(data) {
      state.applyLeave(data);
      if (data?.userId) poseBuffer.forget(data.userId);
      syncRoster();
      consumers.handleSocketEvent?.('user_left', data);
    },
```

`room_state`, `user_joined`, and `profile_updated` keep their current bodies; `room_state` and `profile_updated` call `syncRoster()` as they already do.

Return the buffer so the loop and the overlay can read it:

```javascript
  return {
    socketClient,
    state,
    poseBuffer,
    destroy: socketClient.destroy,
  };
```

In `initializeBrowserRoom`, start the loop after `bootstrapRoomRealtime` and add it to `roomFeatures` so it is torn down with everything else:

```javascript
  const renderLoop = createRenderLoop({
    poseBuffer: realtime.poseBuffer,
    applyPoses: sceneRenderer.applyPoses,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    now: Date.now,
  });
  renderLoop.start();
```

Add `renderLoop` to the `roomFeatures` array, and pass the publisher and clock into `mountHandTracking`:

```javascript
      now: Date.now,
      posePublisher: createPosePublisher(),
```

In `hand-tracking.js`, accept the new parameters and gate the publish:

```javascript
export function mountHandTracking({
  document, navigator, socketClient, roomId, setInterval, clearInterval,
  console, onHandRaiseDetected, posePublisher, now,
}) {
```

```javascript
  function publish(leftHand = null, rightHand = null, handTracking = enabled) {
    const camera = document.getElementById('camera');
    if (!camera) return;
    const position = camera.getAttribute('position');
    const rotation = camera.getAttribute('rotation');
    const hasHands = leftHand !== null || rightHand !== null;
    if (!hasHands && !posePublisher.shouldSend({ position, rotation }, now())) return;

    socketClient.emit('position_update', {
      room_id: roomId, position, rotation, leftHand, rightHand, handTracking,
    });
  }
```

Change the idle timer interval (line 147) from `100` to `MIN_SEND_INTERVAL_MS`, imported from `../core/sync-constants.js`. The publisher, not the timer, now decides what actually goes out. Hand-carrying samples bypass the publisher and keep the existing 10 ms XR cadence guard at line 89.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/bootstrap.js flask_server/app/metamuseum/static/js/room/interaction/hand-tracking.js flask_server/tests/js
git commit -m "feat: interpolate remote avatars and send poses on change"
```

---

### Task 7: Sync debug overlay

The room modules may not read query parameters, so the flag is resolved in Flask and delivered through the existing `room-bootstrap` JSON block.

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/ui/sync-debug.js`
- Modify: `flask_server/app/metamuseum/views/main_views.py:113-119` (add `sync_debug` to the `render_template` call)
- Modify: `flask_server/app/metamuseum/templates/room_aframe.html:45-48` (add `syncDebugEnabled`)
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js` (mount when enabled)
- Test: `flask_server/tests/js/sync-debug.test.mjs`, `flask_server/tests/test_room_debug_flag.py`

**Interfaces:**
- Consumes: `poseBuffer.userIds()`, `poseBuffer.stalenessMs()` (Task 3); `bootstrapData.syncDebugEnabled`.
- Produces: `mountSyncDebug({ document, poseBuffer, socketClient, now, setInterval, clearInterval }) -> { destroy() }`, wrapping `socketClient.emit` to count sends.

- [ ] **Step 1: Write the failing tests**

```javascript
// flask_server/tests/js/sync-debug.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { mountSyncDebug } from '../../app/metamuseum/static/js/room/ui/sync-debug.js';

function fakeDocument() {
  const created = [];
  return {
    created,
    createElement(tagName) {
      const element = { tagName, style: {}, textContent: '', appendChild() {}, remove() {} };
      created.push(element);
      return element;
    },
    body: { appendChild() {} },
  };
}

test('the overlay reports send rate, receive rate, and worst staleness', () => {
  const document = fakeDocument();
  const timers = [];
  let clock = 0;
  const emitted = [];
  const socketClient = { emit: (event) => { emitted.push(event); return true; } };

  const overlay = mountSyncDebug({
    document,
    poseBuffer: { userIds: () => ['a', 'b'], stalenessMs: (id) => (id === 'a' ? 40 : 900) },
    socketClient,
    now: () => clock,
    setInterval: (callback) => { timers.push(callback); return timers.length; },
    clearInterval: () => {},
  });

  socketClient.emit('position_update', {});
  socketClient.emit('position_update', {});
  overlay.recordReceive();
  clock = 1000;
  timers.forEach((callback) => callback());

  const panel = document.created[0];
  assert.match(panel.textContent, /send 2\/s/u);
  assert.match(panel.textContent, /recv 1\/s/u);
  assert.match(panel.textContent, /stale 900ms/u);
  assert.deepEqual(emitted, ['position_update', 'position_update']);  // still forwarded
});
```

```python
# flask_server/tests/test_room_debug_flag.py
"""The sync debug overlay flag reaches the client through bootstrap data."""


def _room_html(app, query):
    from metamuseum.elements.basic import Room

    room = Room(name="debug-room", description="debug").save()
    with app.test_client() as client:
        response = client.get(f"/room?room_id={room._id}{query}")
        assert response.status_code == 200
        return response.get_data(as_text=True)


def test_debug_flag_defaults_off(app):
    assert '"syncDebugEnabled": false' in _room_html(app, "")


def test_debug_sync_enables_the_overlay(app):
    assert '"syncDebugEnabled": true' in _room_html(app, "&debug=sync")


def test_other_debug_values_do_not_enable_the_overlay(app):
    assert '"syncDebugEnabled": false' in _room_html(app, "&debug=other")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd flask_server && npm run test:js`
Expected: FAIL — `Cannot find module .../ui/sync-debug.js`

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test SECRET_KEY=test-secret SECURITY_PASSWORD_SALT=test-salt python -m pytest tests/test_room_debug_flag.py -q`
Expected: FAIL — `syncDebugEnabled` is absent from the rendered page.

- [ ] **Step 3: Write the implementation**

```javascript
// flask_server/app/metamuseum/static/js/room/ui/sync-debug.js
import { INTERPOLATION_DELAY_MS } from '../core/sync-constants.js';

export function mountSyncDebug({
  document, poseBuffer, socketClient, now, setInterval, clearInterval,
}) {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:8px;left:8px;padding:6px 10px;background:rgba(0,0,0,0.7);'
    + 'color:#0f0;font:12px monospace;white-space:pre;z-index:10000;pointer-events:none;';
  document.body.appendChild(panel);

  let sends = 0;
  let receives = 0;
  let windowStart = now();

  const originalEmit = socketClient.emit;
  socketClient.emit = (event, payload) => {
    if (event === 'position_update') sends += 1;
    return originalEmit.call(socketClient, event, payload);
  };

  function refresh() {
    const elapsed = Math.max(1, now() - windowStart) / 1000;
    const staleness = poseBuffer.userIds()
      .map((userId) => poseBuffer.stalenessMs(userId, now()) ?? 0);
    const worst = staleness.length ? Math.max(...staleness) : 0;

    panel.textContent = [
      `send ${Math.round(sends / elapsed)}/s`,
      `recv ${Math.round(receives / elapsed)}/s`,
      `peers ${staleness.length}`,
      `stale ${Math.round(worst)}ms`,
      `delay ${INTERPOLATION_DELAY_MS}ms`,
    ].join('  ');

    sends = 0;
    receives = 0;
    windowStart = now();
  }

  const timer = setInterval(refresh, 1000);

  return {
    recordReceive() {
      receives += 1;
    },
    destroy() {
      clearInterval(timer);
      socketClient.emit = originalEmit;
      panel.remove();
    },
  };
}
```

In `main_views.py`, inside the `room()` view, resolve the flag next to the existing `is_ar_marker` handling and pass it through:

```python
        sync_debug = request.args.get('debug') == 'sync'
```

```python
                             room_id=room_id, wall_list=wall_list,
                             sync_debug=sync_debug)
```

In `room_aframe.html`, add the field to the `room-bootstrap` JSON block after `isAdmin`:

```html
        "syncDebugEnabled": {{ 'true' if sync_debug else 'false' }},
```

In `bootstrap.js`, mount it after the realtime connection and feed it from the `position_update` handler. Pass a `onPacketReceived` callback into `bootstrapRoomRealtime` (defaulting to a no-op) that the handler calls, then wire the overlay's `recordReceive` to it, and push the overlay into `roomFeatures`:

```javascript
  const syncDebug = bootstrapData.syncDebugEnabled
    ? mountSyncDebug({
      document,
      poseBuffer: realtime.poseBuffer,
      socketClient: realtime.socketClient,
      now: Date.now,
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
    })
    : null;
  if (syncDebug) roomFeatures.push(syncDebug);
```

Because the overlay is created after the realtime handlers, expose the receive counter through a mutable hook rather than a constructor argument: `bootstrapRoomRealtime` accepts `consumers.onPacketReceived` and the mount assigns `consumers.onPacketReceived = syncDebug.recordReceive`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd flask_server && npm run test:js`
Expected: PASS

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test SECRET_KEY=test-secret SECURITY_PASSWORD_SALT=test-salt python -m pytest tests -q`
Expected: PASS — 49 tests.

- [ ] **Step 5: Commit**

```bash
git add flask_server/app/metamuseum/static/js/room/ui/sync-debug.js flask_server/app/metamuseum/static/js/room/bootstrap.js flask_server/app/metamuseum/views/main_views.py flask_server/app/metamuseum/templates/room_aframe.html flask_server/tests
git commit -m "feat: add sync debug overlay behind a server-resolved flag"
```

---

### Task 8: Manual verification in a real room

Automated tests cover the maths and the wiring; only a browser shows whether it *looks* right.

**Files:** none — verification only.

- [ ] **Step 1: Start the stack**

Run: `docker compose up -d` from the repository root, then open `http://localhost:51736/`.

- [ ] **Step 2: Open the same room in two browser windows**

Follow the Art Gallery link on the index page, then open the same URL in a second window so two visitors share the room.

- [ ] **Step 3: Check smoothness**

Walk one avatar across the room while watching the other window. Expected: continuous motion with no visible 100 ms stepping, and no overshoot or snap-back when movement stops.

- [ ] **Step 4: Check the idle and staleness behavior**

Leave one avatar stationary and open the second window with `&debug=sync`. Expected: `send` drops to roughly 1/s while still and rises toward 20/s while moving; `stale` stays near the interpolation delay during motion.

- [ ] **Step 5: Check that hands still work**

If a headset is available, enter with hand tracking. Expected: hand entities appear and track as before, and they do not flicker — the change-gating from Task 4 should stop the per-packet rebuild.

- [ ] **Step 6: Record the result**

Note the observed send rates and any anomalies in the pull request description. These numbers are the baseline for judging a future transport change.

---

## Self-Review Notes

- **Spec coverage.** Send side → Task 2. Receive side → Task 3 (with Task 1 supplying the maths). Render split and hand change-gating → Task 4. Per-frame loop → Task 5. Wiring and constants → Tasks 2 and 6. Debug overlay and its server flag → Task 7. Manual check → Task 8. The load trade-off is a consequence of `MAX_SEND_HZ`, defined in Task 2 and observed in Task 8.
- **Naming consistency.** `syncRoster` / `applyPoses` are introduced in Task 4 and used unchanged in Tasks 5-7. `poseBuffer.record` returns the is-new boolean defined in Task 3 and relied on in Task 6. `createPosePublisher().shouldSend` is defined in Task 2 and called in Task 6.
- **Known coupling.** Task 4 renames a method used by three existing test files; those renames are part of that task so the suite stays green at every commit.
