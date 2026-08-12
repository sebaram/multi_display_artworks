# Tab-local visitor identities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every browser tab an independent anonymous visitor that persists through reloads, starts with a random profile, and can be edited or replaced only on demand.

**Architecture:** A small backend capability service issues signed, expiring opaque visitor IDs and validates them at the Socket.IO handshake. A client visitor-session module owns per-tab `sessionStorage`, URL-driven renewal, and randomized valid defaults; the profile and realtime bootstraps consume its resolved record rather than a Flask-session identity. Presence remains in memory and public profiles remain the only data broadcast to a room.

**Tech Stack:** Flask, Flask-SocketIO, itsdangerous, MongoEngine (real MongoDB test fixture only), browser ES modules, Node's built-in test runner, pytest.

## Global Constraints

- Do not store anonymous visitor accounts or profiles in MongoDB.
- Keep admin Flask-Login authentication unchanged and separate from anonymous visitor capabilities.
- Send a visitor capability only in Socket.IO handshake `auth`; never trust a client-provided `userId`.
- Use `sessionStorage`, not `localStorage`, for tab-local visitor data.
- `?user=new` must mint one replacement identity then be removed with `history.replaceState`.
- Same capability reconnects de-duplicate; separate valid capabilities may coexist in the same room.
- No `mongomock` or `MONGODB_MOCK` in source, tests, dependencies, documentation, or CI.
- Run Python tests against `mongodb://localhost:27017/metamuseum_test` with explicit `SECRET_KEY` and `SECURITY_PASSWORD_SALT`.

---

### Task 1: Server-issued visitor capabilities and handshake ownership

**Files:**
- Create: `flask_server/app/metamuseum/core/visitor_capability.py`
- Modify: `flask_server/app/metamuseum/views/main_views.py`
- Modify: `flask_server/app/metamuseum/core/position_sync.py`
- Modify: `flask_server/app/metamuseum/templates/room_aframe.html`
- Modify: `flask_server/tests/test_visitor_profile.py`
- Modify: `flask_server/tests/test_presence_contract.py`

**Interfaces:**
- Produces `issue_visitor_capability() -> dict[str, str]` returning `{"visitorId", "capability"}`.
- Produces `validate_visitor_capability(capability: object, *, max_age: int = 86400) -> str | None`.
- Produces `POST /visitor-capability` returning 201 JSON with exactly `visitorId` and `capability`.
- Consumes Socket.IO connection `auth={"visitorCapability": capability}` and binds `request.sid` to its validated visitor ID.
- Later tasks consume bootstrap `visitorCapabilityUrl` and no server-rendered anonymous `visitorId`.

- [ ] **Step 1: Write the failing capability and socket tests**

```python
def test_capability_endpoint_issues_distinct_signed_visitors(client):
    first = client.post('/visitor-capability')
    second = client.post('/visitor-capability')
    assert first.status_code == second.status_code == 201
    assert set(first.json) == {'visitorId', 'capability'}
    assert first.json['visitorId'] != second.json['visitorId']

def test_two_capabilities_can_join_one_room(app, client, room_id):
    first = socket_with_capability(app, client.post('/visitor-capability').json['capability'])
    second = socket_with_capability(app, client.post('/visitor-capability').json['capability'])
    first.emit('join_position_room', {'room_id': room_id, 'profile': {}})
    second.emit('join_position_room', {'room_id': room_id, 'profile': {}})
    assert len(room_users[room_id]) == 2

def test_invalid_capability_cannot_join(app, client, room_id):
    socket = socket_with_capability(app, 'forged')
    assert not socket.is_connected()
    assert room_id not in room_users

def test_guest_capability_and_presence_do_not_write_mongodb(app, client, room_id, real_database):
    before = database_snapshot(real_database)
    socket = socket_with_capability(app, client.post('/visitor-capability').json['capability'])
    socket.emit('join_position_room', {'room_id': room_id, 'profile': {}})
    socket.disconnect()
    assert database_snapshot(real_database) == before
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server; python -m pytest tests/test_visitor_profile.py -q`

Expected: FAIL because the endpoint and authenticated Socket.IO handshake do not exist.

- [ ] **Step 3: Implement the smallest capability service and endpoint**

```python
# core/visitor_capability.py
CAPABILITY_SALT = 'metamuseum.visitor-capability.v1'

def issue_visitor_capability():
    visitor_id = secrets.token_urlsafe(18)
    token = URLSafeTimedSerializer(current_app.secret_key, salt=CAPABILITY_SALT).dumps({'visitorId': visitor_id})
    return {'visitorId': visitor_id, 'capability': token}

def validate_visitor_capability(capability, *, max_age=86400):
    try:
        payload = URLSafeTimedSerializer(current_app.secret_key, salt=CAPABILITY_SALT).loads(capability, max_age=max_age)
    except (BadData, TypeError):
        return None
    visitor_id = payload.get('visitorId') if isinstance(payload, dict) else None
    return visitor_id if isinstance(visitor_id, str) and visitor_id else None

# views/main_views.py
@bp.post('/visitor-capability')
def create_visitor_capability():
    return jsonify(issue_visitor_capability()), 201
```

Add a `socket_visitors: dict[str, str]` mapping in `position_sync`; its `connect(auth)` handler validates `auth.get('visitorCapability')`, returns `False` on failure, and stores the ID only on success. `on_join` reads that mapping, never Flask `session` or payload `userId`; disconnect removes the mapping. Preserve Flask-Login checks for admin-only socket events. Remove `get_or_create_visitor_id` from the room view and replace template `visitorId` with `visitorCapabilityUrl`.

- [ ] **Step 4: Run focused server tests to verify they pass**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; $env:SECRET_KEY='test-secret'; $env:SECURITY_PASSWORD_SALT='test-salt'; python -m pytest tests/test_visitor_profile.py tests/test_presence_contract.py -q`

Expected: PASS, including forged-token rejection, spoofed `userId` rejection, two-tab coexistence, and same-capability displacement.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/core/visitor_capability.py flask_server/app/metamuseum/core/position_sync.py flask_server/app/metamuseum/views/main_views.py flask_server/app/metamuseum/templates/room_aframe.html flask_server/tests/test_visitor_profile.py flask_server/tests/test_presence_contract.py
git commit -m "feat: issue tab-local visitor capabilities"
```

### Task 2: Tab-local visitor record and randomized profiles

**Files:**
- Create: `flask_server/app/metamuseum/static/js/room/visitor-session.js`
- Modify: `flask_server/app/metamuseum/static/js/room/profile-store.js`
- Modify: `flask_server/tests/js/profile-store.test.mjs`
- Create: `flask_server/tests/js/visitor-session.test.mjs`

**Interfaces:**
- Produces `createRandomProfile({ avatarIds, random }) -> Profile`.
- Produces `resolveVisitorSession({ storage, fetch, location, history, avatarIds, random }) -> Promise<{ visitorId, capability, profile }>`.
- Produces `replaceVisitorSession(dependencies) -> Promise<VisitorSession>`.
- `profile-store.js` retains `normalizeProfile(draft)` and normalizes current tab profiles.
- Task 3 consumes a resolved `{ visitorId, capability, profile }` record.

- [ ] **Step 1: Write failing browser-unit tests**

```javascript
test('first tab session mints and persists a random valid visitor record', async () => {
  const record = await resolveVisitorSession({ storage, fetch: issue, location, history, avatarIds, random: () => 0 });
  assert.equal(record.visitorId, 'visitor-a');
  assert.notEqual(record.profile.displayName, 'Visitor');
  assert.notEqual(record.profile.avatarId, 'none');
  assert.match(record.profile.color, /^#[0-9A-F]{6}$/);
});

test('same tab reload reuses its stored capability without issuing again', async () => {
  await resolveVisitorSession({ storage, fetch: issue, location, history, avatarIds });
  await resolveVisitorSession({ storage, fetch: () => { throw new Error('must not issue'); }, location, history, avatarIds });
});

test('user=new replaces the tab record once and removes the query parameter', async () => {
  const record = await resolveVisitorSession({ storage, fetch: issue, location: { search: '?user=new', pathname: '/room' }, history, avatarIds });
  assert.equal(record.visitorId, 'visitor-b');
  assert.deepEqual(history.calls, [['/room']]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd flask_server; node --test tests/js/visitor-session.test.mjs`

Expected: FAIL because `visitor-session.js` is absent.

- [ ] **Step 3: Implement tab storage and default generation**

```javascript
const STORAGE_KEY = 'metamuseum.tab-visitor.v1';

export async function resolveVisitorSession({ storage, fetch, location, history, avatarIds, random = Math.random }) {
  const forceNew = new URLSearchParams(location.search).get('user') === 'new';
  const existing = forceNew ? null : readVisitorSession(storage);
  const record = existing ?? await issueVisitorSession({ fetch, avatarIds, random });
  writeVisitorSession(storage, record);
  if (forceNew) history.replaceState(null, '', removeUserNew(location));
  return record;
}
```

`issueVisitorSession` POSTs to the injected capability URL, rejects malformed responses, and adds `createRandomProfile` output. Generate names from a safe vocabulary plus numeric suffix, select only allowed non-`none` avatars, and use a fixed valid color palette. A malformed stored record is discarded and reissued. `replaceVisitorSession` always issues and stores a fresh record.

- [ ] **Step 4: Run affected browser tests to verify they pass**

Run: `cd flask_server; node --test tests/js/profile-store.test.mjs tests/js/visitor-session.test.mjs`

Expected: PASS with no default `Visitor` profile for a new tab and no browser-wide `localStorage` key.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room/visitor-session.js flask_server/app/metamuseum/static/js/room/profile-store.js flask_server/tests/js/profile-store.test.mjs flask_server/tests/js/visitor-session.test.mjs
git commit -m "feat: create visitors per browser tab"
```

### Task 3: Opt-in visitor panel and authenticated realtime bootstrap

**Files:**
- Modify: `flask_server/app/metamuseum/static/js/room/profile-panel.js`
- Modify: `flask_server/app/metamuseum/static/js/room/bootstrap.js`
- Modify: `flask_server/tests/js/profile-panel.test.mjs`
- Modify: `flask_server/tests/js/bootstrap.test.mjs`

**Interfaces:**
- `mountProfilePanel({ profile, catalog, onSave, onNewVisitor, document })` returns `{ open, destroy, updateProfile }`.
- `bootstrapRoomProfile({ bootstrapData, visitorSession, document })` returns `joinPayload()` with only `{ room_id, profile }`.
- `bootstrapRoomRealtime` connects with `{ auth: { visitorCapability: visitorSession.capability }, transports, reconnection }`.
- Task 4 can verify `Visitor`, `Edit`, and `New visitor` from the live page.

- [ ] **Step 1: Write failing UI and bootstrap tests**

```javascript
test('visitor controls are closed by default and reveal editing only after Edit', () => {
  mountProfilePanel({ profile, catalog, onSave, onNewVisitor, document });
  assert.equal(findByText(document.body, 'Visitor').tagName, 'button');
  assert.equal(find(document.body, (node) => node.attributes.id === 'profile-display-name'), undefined);
  click(findByText(document.body, 'Visitor'));
  click(findByText(document.body, 'Edit'));
  assert.equal(find(document.body, (node) => node.attributes.id === 'profile-display-name').tagName, 'input');
});

test('realtime connects with the signed tab capability', () => {
  const realtime = bootstrapRoomRealtime({ bootstrapData, visitorSession: { visitorId: 'tab-a', capability: 'signed' }, ioFactory, profileController });
  assert.deepEqual(ioFactory.calls[0].options.auth, { visitorCapability: 'signed' });
  realtime.destroy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd flask_server; node --test tests/js/profile-panel.test.mjs tests/js/bootstrap.test.mjs`

Expected: FAIL because the current panel renders `Edit` immediately and realtime lacks handshake auth.

- [ ] **Step 3: Implement collapsed UI and visitor-aware bootstrap**

The toolbar renders only a `Visitor` button by default. Clicking it opens a profile summary with `Edit` and `New visitor`; form inputs are created only after `Edit`. `New visitor` calls its callback, then reloads only after the new tab record is durable, so the old socket disconnects before the new one joins. `Save` updates the current record profile, sends `profile_update`, and updates the summary.

Make startup async: resolve the tab session before creating room state, scene renderer, expressions, and voice identity. Replace every `bootstrapData.visitorId` consumer with `visitorSession.visitorId`; pass the capability only as `auth.visitorCapability` to the socket connection. Use browser globals only in the entrypoint; keep exports injected and unit-testable.

- [ ] **Step 4: Run all client tests to verify they pass**

Run: `cd flask_server; npm run test:js`

Expected: PASS, including existing room module tests and the new opt-in visitor UI and handshake assertions.

- [ ] **Step 5: Commit**

```powershell
git add flask_server/app/metamuseum/static/js/room/profile-panel.js flask_server/app/metamuseum/static/js/room/bootstrap.js flask_server/tests/js/profile-panel.test.mjs flask_server/tests/js/bootstrap.test.mjs
git commit -m "feat: make visitor profiles opt-in"
```

### Task 4: Real-Mongo verification, documentation, push, and live browser check

**Files:**
- Modify: `README.md`
- Modify: `flask_server/tests/test_visitor_profile.py`

**Interfaces:**
- Documents per-tab `sessionStorage`, `?user=new`, `Visitor` → `Edit`, and no MongoDB guest profiles.
- Adds a live-server checklist covering reload, new tab, profile panel, and `?user=new`.

- [ ] **Step 1: Run real-Mongo non-persistence coverage**

Run: `cd flask_server; $env:MONGODB_URI='mongodb://localhost:27017'; $env:MONGODB_DB='metamuseum_test'; $env:SECRET_KEY='test-secret'; $env:SECURITY_PASSWORD_SALT='test-salt'; python -m pytest tests/test_visitor_profile.py::test_guest_capability_and_presence_do_not_write_mongodb -q`

Expected: PASS, confirming that capability issuance and in-memory presence leave the complete database snapshot unchanged.

- [ ] **Step 2: Update README and execute complete automated verification**

Document the tab behavior, `?user=new`, `Visitor` → `Edit`, and browser-only storage. Do not mention browser-wide identity or `localStorage`.

Run:

```powershell
cd flask_server
$env:MONGODB_URI='mongodb://localhost:27017'
$env:MONGODB_DB='metamuseum_test'
$env:SECRET_KEY='test-secret'
$env:SECURITY_PASSWORD_SALT='test-salt'
python -m pytest -q
npm run test:js
cd ..
git diff --check
rg -n -i 'mongomock|MONGODB_MOCK' . -g '!docs/superpowers/**'
```

Expected: Python and JavaScript suites exit zero, diff check is clean, and the forbidden-identifier scan has no matches.

- [ ] **Step 3: Run and verify in the browser**

Start the documented application command against real test MongoDB. In the in-app browser: open a seeded room and confirm no profile dialog opens; use `Visitor` → `Edit` to save a profile; reload and confirm it persists; open a separate new tab to confirm an independent profile and two visible presences; then visit `?user=new` and confirm a fresh profile with the query flag removed. Capture screenshots or browser assertions. Stop the local server afterward.

- [ ] **Step 4: Commit, push, and verify remote state**

```powershell
git add README.md flask_server/tests/test_visitor_profile.py
git commit -m "docs: explain tab-local visitors"
git push origin master
git status --short
git log --oneline origin/master..HEAD
```

Expected: clean working tree and no commits ahead of `origin/master`.

