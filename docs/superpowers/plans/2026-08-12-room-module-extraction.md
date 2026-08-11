# Room Module Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the room client into explicit rendering, interaction, UI,
and real-time modules while preserving public Flask and Socket.IO contracts.

**Architecture:** This phase begins after the browser-profile release. Existing
global scripts are moved into `static/js/room` ES modules and are composed only
by `bootstrap.js`; `room_aframe.html` becomes declarative. The Flask backend
retains blueprints but delegates real-time room state to a focused presence
service so route and socket adapters stay small.

**Tech Stack:** Python 3.12, Flask, Flask-SocketIO, vanilla ES modules, A-Frame,
Node built-in test runner, pytest, MongoDB 7.

## Global Constraints

- Preserve `/room`, `/element`, `/stream`, and existing documented Socket.IO
  event names during this extraction.
- Preserve admin-only mutation checks and the real MongoDB test requirement.
- No frontend framework, bundler, or duplicate application state store.
- Every module accepts dependencies explicitly; new room modules must not read
  undeclared globals such as `window.posSocket`.

## File structure

| File | Responsibility |
| --- | --- |
| `flask_server/app/metamuseum/static/js/room/core/socket-client.js` | Socket lifecycle, typed event subscription, emissions. |
| `flask_server/app/metamuseum/static/js/room/core/room-state.js` | In-memory room presence reducer. |
| `flask_server/app/metamuseum/static/js/room/rendering/scene.js` | Camera and remote-presence A-Frame entities. |
| `flask_server/app/metamuseum/static/js/room/interaction/teleport.js` | Preset select and camera navigation. |
| `flask_server/app/metamuseum/static/js/room/interaction/admin-transforms.js` | Existing admin element transforms. |
| `flask_server/app/metamuseum/static/js/room/ui/share.js` | QR/share dialog. |
| `flask_server/app/metamuseum/core/presence_service.py` | Pure room-user state operations. |
| `flask_server/app/metamuseum/core/position_sync.py` | Flask-SocketIO adapter only. |

### Task 1: Characterize current Socket.IO contract before moving code

**Files:**
- Create: `flask_server/tests/test_presence_contract.py`
- Modify: `flask_server/tests/conftest.py`

**Interfaces:**
- Produces regression tests covering `join_position_room`, `room_state`,
  `position_update`, `user_left`, `profile_updated`, and voice events.

- [ ] **Step 1: Write contract tests for a two-client room**

```python
def _socket_for(app, visitor_id):
    from metamuseum.core.position_sync import socketio_instance
    client = app.test_client()
    with client.session_transaction() as session:
        session["visitor_id"] = visitor_id
    return socketio_instance.test_client(app, flask_test_client=client)


def test_join_and_position_events_keep_the_public_payload_shape(app):
    first = _socket_for(app, "visitor-a")
    second = _socket_for(app, "visitor-b")
    first.emit("join_position_room", {"room_id": "contract-room", "profile": {}})
    second.emit("join_position_room", {"room_id": "contract-room", "profile": {}})
    state = next(event for event in second.get_received()
                 if event["name"] == "room_state")["args"][0]
    assert state["users"] == [{"userId": "visitor-a", "displayName": "Visitor",
                                "avatarId": "shiba", "color": "#4CAF50",
                                "position": "0 1.6 0", "rotation": "0 0 0",
                                "leftHand": None, "rightHand": None, "handTracking": False}]
    first.emit("position_update", {"room_id": "contract-room", "position": "1 2 3", "rotation": "0 90 0"})
    update = next(event for event in second.get_received()
                  if event["name"] == "position_update")["args"][0]
    assert update["userId"] == "visitor-a"
    assert update["position"] == "1 2 3"
```

- [ ] **Step 2: Run it to establish a passing characterization baseline**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_presence_contract.py -q`

Expected: PASS before refactoring with explicit event payload assertions.

- [ ] **Step 3: Commit the characterization suite**

```powershell
git add flask_server/tests/test_presence_contract.py flask_server/tests/conftest.py
git commit -m "test: characterize room presence events"
```

### Task 2: Extract pure Python presence state

**Files:**
- Create: `flask_server/app/metamuseum/core/presence_service.py`
- Modify: `flask_server/app/metamuseum/core/position_sync.py`
- Modify: `flask_server/tests/test_presence_contract.py`

**Interfaces:**
- `PresenceService.join(room_id, sid, visitor_id, profile, position, rotation)`
  returns `(presence, existing)`.
- `PresenceService.update_position(room_id, sid, payload)` returns a broadcast
  dict or `None`; `leave_all(sid)` returns leave events.

- [ ] **Step 1: Add a failing pure-service test**

```python
def test_presence_update_uses_the_joined_identity_not_payload_identity():
    service = PresenceService()
    service.join("room", "sid", "visitor", DEFAULT_PROFILE, "0 1.6 0", "0 0 0")
    event = service.update_position("room", "sid", {"userId": "spoof", "position": "1 2 3"})
    assert event["userId"] == "visitor"
    assert event["position"] == "1 2 3"
```

- [ ] **Step 2: Run it to verify RED**

Run: `cd flask_server; python -m pytest tests/test_presence_contract.py::test_presence_update_uses_the_joined_identity_not_payload_identity -q`

Expected: FAIL because `PresenceService` does not exist.

- [ ] **Step 3: Implement the service and reduce the Socket.IO adapter**

```python
class PresenceService:
    def __init__(self):
        self.rooms = defaultdict(dict)

    def update_position(self, room_id, sid, payload):
        user = self.rooms.get(room_id, {}).get(sid)
        if not user:
            return None
        user["position"] = payload.get("position", user["position"])
        user["rotation"] = payload.get("rotation", user["rotation"])
        return dict(user, room_id=room_id)
```

Keep `position_sync.py` responsible only for Flask request/session lookup,
Socket.IO `join_room`/`leave_room`, and emitting service results.

- [ ] **Step 4: Run contract and full Python tests to verify GREEN**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/core/presence_service.py flask_server/app/metamuseum/core/position_sync.py flask_server/tests/test_presence_contract.py
git commit -m "refactor: isolate room presence state"
```

### Task 3: Extract state and socket client browser modules

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/core/socket-client.js`
- Create: `flask_server/app/metamuseum/static/js/room/core/room-state.js`
- Create: `flask_server/tests/js/room-state.test.mjs`
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js`

**Interfaces:**
- `createRoomState(selfId)` returns `{applyRoomState, applyJoin, applyUpdate,
  applyLeave, users}`.
- `createSocketClient(ioFactory, handlers)` returns `{connect, emit, destroy}`.

- [ ] **Step 1: Write failing reducer tests**

```javascript
test('room state excludes the local user and removes departed users', () => {
  const state = createRoomState('self');
  state.applyRoomState([{ userId: 'self' }, { userId: 'other', displayName: 'Other' }]);
  state.applyLeave({ userId: 'other' });
  assert.deepEqual([...state.users()], []);
});
```

- [ ] **Step 2: Run it to verify RED**

Run: `cd flask_server; node --test tests/js/room-state.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure state before adapting Socket.IO**

Implement the state reducer without DOM or Socket.IO imports. Implement the
socket client as the only module that calls the CDN-provided `io`; inject it
from `bootstrap.js` as `window.io`. Replace direct `posSocket` reads in profile,
voice, expression, and effects adapters with their injected socket client.

- [ ] **Step 4: Run JS tests and room contract tests to verify GREEN**

Run: `cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_presence_contract.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room/core flask_server/app/metamuseum/static/js/room/bootstrap.js flask_server/tests/js
git commit -m "refactor: isolate browser room state"
```

### Task 4: Separate rendering, interaction, and UI adapters

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/rendering/scene.js`
- Create: `flask_server/app/metamuseum/static/js/room/interaction/teleport.js`
- Create: `flask_server/app/metamuseum/static/js/room/interaction/admin-transforms.js`
- Create: `flask_server/app/metamuseum/static/js/room/ui/share.js`
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js`
- Modify: `flask_server/app/metamuseum/templates/room_aframe.html`
- Test: `flask_server/tests/js/scene.test.mjs`, `flask_server/tests/js/teleport.test.mjs`

- [ ] **Step 1: Write failing module-boundary tests**

```javascript
test('teleport changes only the camera position and rotation', () => {
  const camera = fakeCamera();
  teleport(camera, { position: '1 2 3', rotation: '0 90 0' }, boundary);
  assert.equal(camera.position, '1 2 3');
  assert.equal(camera.rotation, '0 90 0');
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `cd flask_server; node --test tests/js/scene.test.mjs tests/js/teleport.test.mjs`

Expected: FAIL because rendering and interaction modules do not exist.

- [ ] **Step 3: Move code by ownership without behavior changes**

Move remote user entity creation/update/removal into `scene.js`, preset dropdown
and camera updates into `teleport.js`, the current admin-only transform setup
into `admin-transforms.js`, and QR DOM creation into `ui/share.js`. The template
contains assets, scene markup, bootstrap JSON, and one module entry only; it
contains no inline business logic.

- [ ] **Step 4: Run the complete test suite to verify GREEN**

Run: `cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest -q; git diff --check`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room flask_server/app/metamuseum/templates/room_aframe.html flask_server/tests/js
git commit -m "refactor: modularize room client"
```

### Task 5: Remove compatibility globals and verify deployed behaviour

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-11-browser-profile-room-modularity-design.md`
- Modify: any legacy `flask_server/app/metamuseum/static/js/*.js` made unused by Tasks 3–4.

- [ ] **Step 1: Add a failing static boundary check**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => (
    entry.isDirectory()
      ? listJavaScriptFiles(join(directory, entry.name))
      : entry.name.endsWith('.js') ? [join(directory, entry.name)] : []
  )));
  return nested.flat();
}

test('room modules do not depend on legacy global socket state', async () => {
  const files = await listJavaScriptFiles('app/metamuseum/static/js/room');
  for (const file of files) assert.doesNotMatch(await readFile(file, 'utf8'), /\bposSocket\b|\broomId\s*=\s*new URLSearchParams/);
});
```

- [ ] **Step 2: Run it to verify RED, then remove the remaining compatibility bridge**

Run: `cd flask_server; node --test tests/js/module-boundaries.test.mjs`

Expected: FAIL until all new modules receive dependencies through their public
function parameters. Keep third-party global `AFRAME` only in rendering modules.

- [ ] **Step 3: Run final automated and live checks**

Run: `git diff --check; cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest -q`

Then run the service with real MongoDB and verify two browser sessions can join,
move, update profiles, use voice controls, share QR links, and that an admin can
still edit elements while a normal visitor receives a 403 for mutations.

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/superpowers/specs/2026-08-11-browser-profile-room-modularity-design.md flask_server
git commit -m "docs: describe modular room architecture"
```
