# Security and Real MongoDB Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the exposed retired credential, enforce admin-only mutation and streaming controls, and test the Flask app against real MongoDB.

**Architecture:** Flask-Login remains the sole identity system. A small JSON-oriented admin decorator protects state-changing routes, while streaming code validates IDs before it touches the filesystem or starts FFmpeg. The app factory and seed command always use real MongoDB; CI supplies an ephemeral MongoDB container.

**Tech Stack:** Python 3.12, Flask, Flask-Login, MongoEngine, MongoDB 7, pytest, Docker, GitHub Actions.

## Global Constraints

- Use existing `User.is_admin()` authorization; do not add passcodes or roles.
- Do not include an in-memory-database fallback in runtime, tests, dependencies, or CI.
- Integration tests require `MONGODB_URI` and must use database `metamuseum_test`.
- Test each behavior before production-code changes.

---

### Task 1: Add security regression coverage

**Files:**
- Create: `flask_server/tests/conftest.py`
- Create: `flask_server/tests/test_authorization.py`
- Create: `flask_server/tests/test_seed.py`
- Create: `flask_server/requirements-dev.txt`

**Interfaces:**
- Consumes: `MONGODB_URI` and `MONGODB_DB=metamuseum_test`.
- Produces: pytest fixtures `app`, `client`, `admin_client`, and `sample_image`.

- [ ] **Step 1: Write failing authorization tests**

```python
def test_anonymous_client_cannot_update_element(client, sample_image):
    response = client.patch(f'/element/{sample_image.id}/image', json={'position_x': 1})
    assert response.status_code == 403

def test_admin_can_update_element(admin_client, sample_image):
    response = admin_client.patch(f'/element/{sample_image.id}/image', json={'position_x': 1})
    assert response.status_code == 200

def test_anonymous_client_cannot_control_stream(client):
    assert client.post('/stream/stop/camera').status_code == 403
```

- [ ] **Step 2: Run tests to verify the authorization gap**

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test pytest tests/test_authorization.py -v`

Expected: anonymous element update and stream control tests fail because routes currently return success.

- [ ] **Step 3: Write failing seed and stream-ID tests**

```python
def test_seed_creates_data_in_real_database():
    seed()
    assert Room.objects.count() == 3

def test_invalid_stream_id_is_rejected(admin_client):
    response = admin_client.post('/stream/start-rtsp', json={'stream_id': '../bad', 'rtsp_url': 'rtsp://example.test/cam'})
    assert response.status_code == 400
```

- [ ] **Step 4: Run tests to verify failures**

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test pytest tests/test_seed.py tests/test_authorization.py -v`

Expected: seed import fails because `from app import app` is invalid; unsafe stream IDs are not rejected.

### Task 2: Enforce admin-only mutations and safe streaming

**Files:**
- Modify: `flask_server/app/metamuseum/auth.py`
- Modify: `flask_server/app/metamuseum/views/main_views.py`
- Modify: `flask_server/app/metamuseum/views/stream_views.py`
- Modify: `flask_server/app/metamuseum/core/streaming.py`

**Interfaces:**
- Produces: `admin_required(view)` decorator returning `{'error': 'Admin required'}, 403`.
- Produces: `validate_stream_id(stream_id) -> str`, raising `ValueError` for unsafe IDs.

- [ ] **Step 1: Implement the smallest shared admin decorator**

```python
def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin():
            return jsonify({'error': 'Admin required'}), 403
        return view(*args, **kwargs)
    return wrapped
```

- [ ] **Step 2: Apply it to PATCH element and POST streaming mutation routes**

```python
@bp.route('/stop/<stream_id>', methods=['POST'])
@admin_required
def stop_stream_endpoint(stream_id):
```

- [ ] **Step 3: Validate every stream ID at the streaming boundary**

```python
STREAM_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
def validate_stream_id(stream_id):
    if not isinstance(stream_id, str) or not STREAM_ID_RE.fullmatch(stream_id):
        raise ValueError('invalid stream_id')
    return stream_id
```

- [ ] **Step 4: Run authorization and stream-ID tests**

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test pytest tests/test_authorization.py -v`

Expected: all tests pass.

### Task 3: Remove mock-only startup and repair seeding

**Files:**
- Modify: `flask_server/app/config.py`
- Modify: `flask_server/app/metamuseum/__init__.py`
- Modify: `flask_server/seed_and_serve.py`
- Modify: `flask_server/seed_data.py`
- Modify: `flask_server/requirements.txt`

**Interfaces:**
- `create_app()` connects only to real MongoDB.
- `seed()` is importable from `seed_and_serve.py` and seeds the connected real database once.

- [ ] **Step 1: Remove in-memory database imports and connection branches**

```python
if uri:
    mongoengine.connect(db_name, host=uri)
else:
    mongoengine.connect(db_name, host=host, port=port)
```

- [ ] **Step 2: Create the app through the real factory before importing seed models**

```python
from metamuseum import create_app
app = create_app()
```

- [ ] **Step 3: Run seed tests against real MongoDB**

Run: `MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=metamuseum_test pytest tests/test_seed.py -v`

Expected: seed data is created once in MongoDB.

### Task 4: Update documentation and CI

**Files:**
- Modify: `README.md`
- Modify: `test_round.sh`
- Modify: `.github/workflows/deploy.yml`
- Modify: `flask_server/requirements-dev.txt`

**Interfaces:**
- CI starts MongoDB with Docker networking and runs app smoke tests and pytest with `MONGODB_URI`.
- README lists the actual routes and real MongoDB setup.

- [ ] **Step 1: Remove the GitLab token and GitLab-only test assumptions**

```bash
APP_URL="${APP_URL:-http://localhost:5000}"
```

- [ ] **Step 2: Replace CI mock database setup with MongoDB 7**

```yaml
docker network create ci
docker run -d --name ci_mongo --network ci --network-alias mongo mongo:7
docker run -d --name ci_smoke --network ci -e MONGODB_URI=mongodb://mongo:27017/metamuseum metamuseum:ci
```

- [ ] **Step 3: Document required real-MongoDB settings and actual endpoints**

```markdown
MONGODB_URI=mongodb://localhost:27017/metamuseum python seed_and_serve.py
GET /room?room_id=<id>
GET /kwanri
```

- [ ] **Step 4: Run the full test suite and Docker smoke test**

Run: `docker compose up -d --build && docker compose exec app pytest tests -v && docker compose down -v`

Expected: all tests pass against MongoDB and `/health` returns HTTP 200.
