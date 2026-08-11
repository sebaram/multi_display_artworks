# Browser Profile and Room Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give public room visitors a browser-local editable profile, a securely
bound real-time presence identity, selectable licensed avatars and colors, an
expandable mini-map, and mobile-only movement guidance.

**Architecture:** Flask owns a signed browser-session visitor ID but persists
no visitor document in MongoDB. A small pure Python profile module normalizes
socket payloads; a browser ESM profile store preserves editable attributes in
`localStorage`. The room page bootstraps focused browser modules which render
the profile panel, avatars, and map while the existing Flask/Socker.IO URLs
continue to work.

**Tech Stack:** Python 3.12, Flask, Flask-Login, Flask-SocketIO, MongoEngine,
vanilla ES modules, A-Frame 1.6, Node's built-in test runner, pytest, MongoDB 7.

## Global Constraints

- Guest data must never create or update a MongoDB collection or `User` record.
- Flask-Login remains the only authentication and authorization system; only
  admins can mutate gallery elements or streams.
- The server must derive `userId` from the signed Flask session and must ignore
  client-supplied IDs after a socket connects.
- Avatar choices are application catalog IDs, never supplied URLs.
- Each vendored model requires a source URL, creator, licence, and attribution
  record committed beside its asset.
- Integration tests require `MONGODB_URI` and `MONGODB_DB=metamuseum_test`.
- Do not add an external JavaScript framework or browser test dependency.

## File structure

| File | Responsibility |
| --- | --- |
| `flask_server/app/metamuseum/core/visitor_profile.py` | Server constants and pure profile normalization. |
| `flask_server/app/metamuseum/views/main_views.py` | Issue signed browser visitor ID and expose room bootstrap data. |
| `flask_server/app/metamuseum/core/position_sync.py` | Bind presence to Flask session and process profile updates. |
| `flask_server/app/metamuseum/static/js/room/profile-store.js` | Browser-local profile load/save/validation. |
| `flask_server/app/metamuseum/static/js/room/avatar-catalog.js` | Safe avatar catalog and metadata. |
| `flask_server/app/metamuseum/static/js/room/avatar-renderer.js` | A-Frame avatar construction and color application. |
| `flask_server/app/metamuseum/static/js/room/profile-panel.js` | Accessible profile prompt and edit panel. |
| `flask_server/app/metamuseum/static/js/room/minimap.js` | Compact map plus expanded-map dialog. |
| `flask_server/app/metamuseum/static/js/room/mobile-guidance.js` | Coarse-pointer-only movement hint. |
| `flask_server/app/metamuseum/static/js/room/bootstrap.js` | Room-module composition and compatibility bridge. |
| `flask_server/app/metamuseum/templates/room_aframe.html` | Declarative bootstrap data and module script entry. |
| `flask_server/tests/test_visitor_profile.py` | Server/session/socket profile integration tests. |
| `flask_server/tests/js/*.test.mjs` | Node tests for pure browser modules. |

### Task 1: Server visitor identity and profile normalization

**Files:**
- Create: `flask_server/app/metamuseum/core/visitor_profile.py`
- Modify: `flask_server/app/metamuseum/views/main_views.py:1-115`
- Test: `flask_server/tests/test_visitor_profile.py`

**Interfaces:**
- Produces `get_or_create_visitor_id(session) -> str`,
  `normalize_profile(data: Mapping) -> dict`, and `AVATAR_IDS`.
- The room route renders `visitor_id` and `avatar_catalog` in bootstrap data.

- [ ] **Step 1: Write the failing route/session tests**

```python
def test_room_assigns_one_visitor_id_per_browser_session(client, sample_image):
    room_id = str(sample_image.wall.room._id)
    first = client.get(f"/room?room_id={room_id}")
    second = client.get(f"/room?room_id={room_id}")
    with client.session_transaction() as session:
        visitor_id = session["visitor_id"]
    assert first.status_code == second.status_code == 200
    assert visitor_id in first.get_data(as_text=True)
    assert visitor_id in second.get_data(as_text=True)


def test_normalize_profile_rejects_unknown_avatar_and_bad_color():
    from metamuseum.core.visitor_profile import normalize_profile
    assert normalize_profile({"displayName": "x", "avatarId": "remote-url",
                              "color": "blue"}) == {
        "displayName": "Visitor", "avatarId": "shiba", "color": "#4CAF50"
    }
```

- [ ] **Step 2: Run the test to verify RED**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_visitor_profile.py -q`

Expected: FAIL because `visitor_profile` and the `visitor_id` route context do not exist.

- [ ] **Step 3: Add the minimal normalization module and signed-session issuer**

```python
# core/visitor_profile.py
import re
import secrets

AVATAR_IDS = frozenset({"shiba", "robot", "rigged-simple", "none"})
DEFAULT_PROFILE = {"displayName": "Visitor", "avatarId": "shiba", "color": "#4CAF50"}
_NAME = re.compile(r"^[a-zA-Z0-9가-힣\s\-_'.]{3,20}$")
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")

def get_or_create_visitor_id(session):
    if not session.get("visitor_id"):
        session["visitor_id"] = secrets.token_urlsafe(18)
        session.permanent = True
    return session["visitor_id"]

def normalize_profile(data):
    data = data or {}
    name = str(data.get("displayName", "")).strip()
    avatar_id = data.get("avatarId")
    color = str(data.get("color", "")).upper()
    return {
        "displayName": name if _NAME.fullmatch(name) else DEFAULT_PROFILE["displayName"],
        "avatarId": avatar_id if avatar_id in AVATAR_IDS else DEFAULT_PROFILE["avatarId"],
        "color": color if _COLOR.fullmatch(color) else DEFAULT_PROFILE["color"],
    }
```

Call `get_or_create_visitor_id(session)` in `room()`. Remove query-parameter
avatar selection and pass `visitor_id`, `avatar_catalog`, and existing room
data to the template.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_visitor_profile.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/core/visitor_profile.py flask_server/app/metamuseum/views/main_views.py flask_server/tests/test_visitor_profile.py
git commit -m "feat: issue browser visitor identities"
```

### Task 2: Socket presence cannot be impersonated

**Files:**
- Modify: `flask_server/app/metamuseum/core/position_sync.py:55-175`
- Modify: `flask_server/tests/test_visitor_profile.py`

**Interfaces:**
- Consumes `normalize_profile` and `session["visitor_id"]`.
- `join_position_room` accepts `{room_id, profile}`; `position_update` accepts
  only position, rotation, hands, and no identity/profile fields.
- Produces every presence event with `{userId, displayName, avatarId, color}`
  and never exposes the transport-only Socket.IO `sid`.

- [ ] **Step 1: Add failing Socket.IO identity tests**

```python
def test_socket_uses_signed_session_identity_and_ignores_spoofed_user_id(app, client):
    from metamuseum.core.position_sync import socketio_instance
    with client.session_transaction() as session:
        session["visitor_id"] = "server-owned-id"
    socket = socketio_instance.test_client(app, flask_test_client=client)
    socket.emit("join_position_room", {
        "room_id": "room-a", "userId": "attacker-id",
        "profile": {"displayName": "Valid Name", "avatarId": "robot", "color": "#112233"},
    })
    from metamuseum.core.position_sync import room_users
    presence = next(iter(room_users["room-a"].values()))
    assert presence["userId"] == "server-owned-id"
    assert presence["avatarId"] == "robot"
```

- [ ] **Step 2: Run it to verify RED**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_visitor_profile.py::test_socket_uses_signed_session_identity_and_ignores_spoofed_user_id -q`

Expected: FAIL because the handler currently accepts `data["userId"]`.

- [ ] **Step 3: Make the presence gateway session-authoritative**

```python
visitor_id = session.get("visitor_id")
if not room_id or not visitor_id:
    return
profile = normalize_profile(data.get("profile"))
room_users[room_id][request.sid] = {
    "userId": visitor_id,
    **profile,
    "position": data.get("position", "0 1.6 0"),
    "rotation": data.get("rotation", "0 0 0"),
    "leftHand": None, "rightHand": None, "handTracking": False,
}
```

Add a `profile_update` handler that overwrites only normalized `displayName`,
`avatarId`, and `color` for `request.sid`, then broadcasts `profile_updated`.
Do not accept `userId` in either handler. Build `room_state` user lists from
the public presence fields only, excluding the transport-only Socket.IO `sid`.
Update all old `avatar` keys to `avatarId` atomically in this module and the
browser consumer.

- [ ] **Step 4: Run focused integration tests to verify GREEN**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_visitor_profile.py tests/test_authorization.py -q`

Expected: PASS with no authorization regression.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/core/position_sync.py flask_server/tests/test_visitor_profile.py
git commit -m "fix: bind room presence to browser session"
```

### Task 3: Curated avatar catalog and browser-local profile store

**Files:**
- Create: `flask_server/package.json`
- Create: `flask_server/app/metamuseum/static/js/room/avatar-catalog.js`
- Create: `flask_server/app/metamuseum/static/js/room/profile-store.js`
- Create: `flask_server/tests/js/profile-store.test.mjs`
- Create: `flask_server/app/metamuseum/static/gltf/rigged-simple/LICENSE.md`
- Add: `flask_server/app/metamuseum/static/gltf/rigged-simple/RiggedSimple.glb`

**Interfaces:**
- `AVATAR_CATALOG` maps `id` to `{label, kind, assetUrl?, attribution?}`.
- `loadProfile(storage, visitorId)` and `saveProfile(storage, visitorId, draft)`
  return normalized profile objects; the key is `metamuseum.profile.<visitorId>`.

- [ ] **Step 1: Write failing Node tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, saveProfile } from '../../app/metamuseum/static/js/room/profile-store.js';

test('profile stays local to its signed visitor id', () => {
  const storage = new Map();
  const api = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  saveProfile(api, 'visitor-a', { displayName: 'Visitor A', avatarId: 'robot', color: '#abcdef' });
  assert.equal(loadProfile(api, 'visitor-a').displayName, 'Visitor A');
  assert.equal(loadProfile(api, 'visitor-b').displayName, 'Visitor');
});
```

- [ ] **Step 2: Run it to verify RED**

Run: `cd flask_server; node --test tests/js/profile-store.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure ESM modules and vendor one licensed human model**

```json
// flask_server/package.json
{ "private": true, "type": "module", "scripts": { "test:js": "node --test tests/js/*.test.mjs" } }
```

`profile-store.js` must import the catalog and export `normalizeProfile`,
`loadProfile`, and `saveProfile` without accessing `window` at module load.
Add `RiggedSimple.glb` only from Khronos' tagged glTF Sample Assets release and
write `LICENSE.md` with the model's CC-BY-4.0 licence, Cesium as creator, the
exact release URL, and the attribution text from the model index. Use
`new URL('../../gltf/rigged-simple/RiggedSimple.glb', import.meta.url).href`
in the catalog; no remote model URL may appear in executable code.

- [ ] **Step 4: Run JS tests to verify GREEN**

Run: `cd flask_server; npm run test:js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/package.json flask_server/app/metamuseum/static/js/room flask_server/tests/js flask_server/app/metamuseum/static/gltf/rigged-simple
git commit -m "feat: add local visitor profile catalog"
```

### Task 4: Avatar renderer and editable profile panel

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/avatar-renderer.js`
- Create: `flask_server/app/metamuseum/static/js/room/profile-panel.js`
- Create: `flask_server/tests/js/avatar-renderer.test.mjs`
- Modify: `flask_server/app/metamuseum/templates/room_aframe.html:1-565`

**Interfaces:**
- `createAvatarEntity(profile, document)` returns an A-Frame entity or `null`.
- `mountProfilePanel({profile, catalog, onSave})` returns `{open, destroy}`.
- `onSave(profile)` persists locally and emits `profile_update` after socket
  connection; it never changes authorization state.

- [ ] **Step 1: Write failing renderer tests**

```javascript
test('robot renderer applies the selected normalized color', () => {
  const entity = createAvatarEntity({ avatarId: 'robot', color: '#123456' }, fakeDocument);
  assert.equal(entity.children[0].attributes.color, '#123456');
});

test('unknown catalog id falls back to the shiba model', () => {
  const entity = createAvatarEntity({ avatarId: 'bad', color: '#123456' }, fakeDocument);
  assert.equal(entity.attributes['gltf-model'], AVATAR_CATALOG.shiba.assetUrl);
});
```

- [ ] **Step 2: Run the renderer test to verify RED**

Run: `cd flask_server; node --test tests/js/avatar-renderer.test.mjs`

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Implement rendering and accessible profile editing**

Move `createAvatarEntity` from the inline room template into
`avatar-renderer.js`. Make primitive robot materials use `profile.color`; for
glTF models use the catalog-provided asset and attach a small color accent so
unapproved source materials are not mutated. Build the panel as a semantic
dialog with label, select, `<input type="color">`, Save, Cancel, focus return,
and Escape handling. Keep the current first-entry name prompt behaviour by
opening this dialog when no stored profile exists.

Replace the inline `const myUserId = Math.random()` and query avatar constant
with a `<script id="room-bootstrap" type="application/json">` object supplied
by Flask, followed by one `type="module"` entry script. The existing initial
socket join must include `{room_id, profile}` only.

- [ ] **Step 4: Run JS and Flask tests to verify GREEN**

Run: `cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest tests/test_visitor_profile.py -q`

Expected: both commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room flask_server/app/metamuseum/templates/room_aframe.html flask_server/tests/js
git commit -m "feat: let visitors edit room appearance"
```

### Task 5: Expandable map and mobile-only guidance

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/minimap.js`
- Create: `flask_server/app/metamuseum/static/js/room/mobile-guidance.js`
- Create: `flask_server/tests/js/minimap.test.mjs`
- Modify: `flask_server/app/metamuseum/static/js/location-features.js:86-287`
- Modify: `flask_server/app/metamuseum/templates/room_aframe.html`

**Interfaces:**
- `mountMinimap({presets, boundary, wallList, getCamera})` returns `{destroy}`.
- `isMobilePointer(mediaQueryList)` is true only when `(pointer: coarse)` and
  `(max-width: 767px)` both match.

- [ ] **Step 1: Write failing UI-unit tests**

```javascript
test('compact minimap click opens the map dialog without calling teleport', () => {
  const { canvas, dialog } = mountMinimap({ presets: [], boundary, wallList: [], getCamera, document: fakeDocument });
  canvas.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  assert.equal(teleports.length, 0);
});

test('movement guidance requires both a coarse pointer and a mobile width', () => {
  assert.equal(isMobilePointer({ matches: true }, { matches: false }), false);
  assert.equal(isMobilePointer({ matches: true }, { matches: true }), true);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `cd flask_server; node --test tests/js/minimap.test.mjs`

Expected: FAIL because the modules do not exist and the old minimap click
teleports.

- [ ] **Step 3: Implement the focused controls**

Extract the existing canvas drawing code from `location-features.js` to
`minimap.js`, render it at 110px and at a dialog canvas sized from the dialog
container, and redraw with `requestAnimationFrame` rather than a 200ms global
interval. Remove the compact click's `teleportTo` call. Add close-button,
backdrop, Escape, ARIA labels, and focus restoration.

Implement `mobile-guidance.js` with `matchMedia('(pointer: coarse)')` and
`matchMedia('(max-width: 767px)')`. Create the hint only if both match, and
listen for media-query changes to add/remove it. It must not change
`drag-element` or expose admin transforms.

- [ ] **Step 4: Run control, auth, and full integration tests to verify GREEN**

Run: `cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest -q`

Expected: all JS tests and all Python tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room flask_server/app/metamuseum/static/js/location-features.js flask_server/app/metamuseum/templates/room_aframe.html flask_server/tests/js
git commit -m "feat: expand minimap and scope mobile guidance"
```

### Task 6: Documentation, browser verification, and final regression gate

**Files:**
- Modify: `README.md:60-115, 250-290`
- Modify: `docs/superpowers/specs/2026-08-11-browser-profile-room-modularity-design.md`

- [ ] **Step 1: Add documentation expectations before manual testing**

Document browser-only profile persistence, clearing site data to reset it,
avatar attribution location, the mobile breakpoint behaviour, and that
administrative access is unchanged. Do not claim cross-device restoration.

- [ ] **Step 2: Run static and automated checks**

Run: `git diff --check; cd flask_server; npm run test:js; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python -m pytest -q`

Expected: all commands exit 0.

- [ ] **Step 3: Manually verify a live room against real MongoDB**

Run: `docker compose up -d mongo; cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; python seed_and_serve.py --serve`

In two browser sessions, verify stable ID per session, profile edit propagation,
different avatar/color rendering, no ability to impersonate with DevTools
`userId`, expandable minimap without camera teleport, and hint absent on a
desktop viewport but present on a 390px coarse-pointer emulation.

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/superpowers/specs/2026-08-11-browser-profile-room-modularity-design.md
git commit -m "docs: describe browser room profiles"
```
