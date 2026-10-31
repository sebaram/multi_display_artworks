"""Compatibility checks without starting or resetting the shared Mongo fixture."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
import pytest


def camera_payload(**changes):
    return {'userId': 'legacy-camera', 'position': {'x': 0, 'y': 1.6, 'z': 2},
            'rotation': {'x': 0, 'y': 90, 'z': 0}, **changes}


@pytest.fixture
def compatibility_http(monkeypatch):
    from metamuseum.asgi import create_app
    from metamuseum.config import Settings
    from metamuseum.models import OnlineUser
    from metamuseum.services import providers
    # Freeze only the limiter's module clock, leaving asyncio's own clock intact.
    monkeypatch.setattr(providers, 'time', SimpleNamespace(monotonic=lambda: 100.))
    records = []

    class Query:
        def __init__(self, filters=None):
            self.filters = filters or {}

        def __call__(self, **filters):
            return Query(filters)

        def __iter__(self):
            return iter([row for row in records if all(
                (row.update_time >= value if name == 'update_time__gte' else
                 row.update_time < value if name == 'update_time__lt' else
                 getattr(row, name) == value) for name, value in self.filters.items())])

        def first(self):
            return next(iter(self), None)

        def count(self):
            return len(list(self))

        def limit(self, maximum):
            return list(self)[:maximum]

        def delete(self):
            for row in list(self):
                records.remove(row)

    def save(document):
        document.validate()
        if document not in records:
            records.append(document)
        return document

    original_manager = vars(OnlineUser)['objects']
    OnlineUser.objects = Query()
    monkeypatch.setattr(OnlineUser, 'save', save)
    app = create_app(Settings(secret_key='camera-unit-test', security_password_salt='camera-unit-test'))
    # The HTTP fallback must never create signed presence or room membership.
    app.state.realtime = SimpleNamespace(presence=SimpleNamespace(rooms={}))
    app.state.camera_test_records = records
    try:
        yield TestClient(app), app
    finally:
        OnlineUser.objects = original_manager


def test_camera_fallback_retains_legacy_success_contract(compatibility_http):
    browser, app = compatibility_http
    response = browser.post('/camera-data', json=camera_payload())
    assert response.status_code == 200
    assert response.json() == {'status': 'success'}
    assert browser.get('/get-cameras').json() == [{
        'userId': 'legacy-camera', 'position': {'x': 0, 'y': 1.6, 'z': 2},
        'rotation': {'x': 0, 'y': 90, 'z': 0}, 'leftHand': {}, 'rightHand': {},
        'handTrackingEnabled': {},
    }]
    assert app.state.realtime.presence.rooms == {}


@pytest.mark.parametrize('payload', [
    {}, camera_payload(userId=''), camera_payload(userId='a' * 201),
    camera_payload(userId=4), camera_payload(position={'x': True, 'y': 1, 'z': 2}),
    camera_payload(rotation={'x': 0, 'y': 0}),
    camera_payload(leftHand={'wrist': {'x': 0, 'y': 'bad', 'z': 0}}),
    camera_payload(leftHand={'wrist': {'x': True}}),
    camera_payload(position={'x': 1_000_001, 'y': 0, 'z': 0}),
    camera_payload(handTrackingEnabled={'enabled': 'yes'}),
])
def test_invalid_camera_snapshot_is_rejected(compatibility_http, payload):
    browser, _ = compatibility_http
    response = browser.post('/camera-data', json=payload)
    assert response.status_code == 400
    assert set(response.json()) == {'error'}
    assert browser.get('/get-cameras').json() == []


def test_nonfinite_and_oversized_camera_bodies_are_rejected(compatibility_http):
    browser, _ = compatibility_http
    response = browser.post('/camera-data', content='{"userId":"x","position":{"x":NaN,"y":0,"z":0},"rotation":{"x":0,"y":0,"z":0}}',
                            headers={'Content-Type': 'application/json'})
    assert response.status_code == 400
    response = browser.post('/camera-data', json=camera_payload(ignored='x' * 17000))
    assert response.status_code == 413
    response = browser.post('/camera-data', content=iter([b' ' * 9000, b' ' * 9000]),
                            headers={'Content-Type': 'application/json'})
    assert response.status_code == 413
    assert browser.post('/camera-data', content='{').status_code == 400


def test_camera_user_and_reader_rates_remain_bounded(compatibility_http):
    browser, _ = compatibility_http
    for _ in range(20):
        assert browser.post('/camera-data', json=camera_payload()).status_code == 200
    assert browser.post('/camera-data', json=camera_payload()).status_code == 429
    for _ in range(5):
        assert browser.get('/get-cameras').status_code == 200
    assert browser.get('/get-cameras').status_code == 429


def test_camera_hands_are_preserved_and_stale_snapshots_expire(compatibility_http):
    browser, app = compatibility_http
    hands = {'wrist': {'position': [1, 2, 3], 'rotation': [0, 0, 0, 1]},
             'thumbTip': {'x': 1, 'y': 2, 'z': 3}}
    tracking = {'enabled': True, 'device': 'fixture'}
    assert browser.post('/camera-data', json=camera_payload(leftHand=hands, handTrackingEnabled=tracking)).status_code == 200
    assert browser.post('/camera-data', json=camera_payload(position={'x': 2, 'y': 3, 'z': 4})).status_code == 200
    response = browser.get('/get-cameras').json()[0]
    assert response['leftHand'] == hands
    assert response['handTrackingEnabled'] == tracking
    assert len(app.state.camera_test_records) == 1
    app.state.camera_test_records[0].update_time = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=6)
    assert browser.get('/get-cameras').json() == []
    assert browser.post('/camera-data', json=camera_payload(userId='next-camera')).status_code == 200
    assert [row.session_id for row in app.state.camera_test_records] == ['next-camera']


def test_camera_ip_rate_cannot_be_bypassed_with_new_user_ids(compatibility_http):
    browser, _ = compatibility_http
    for index in range(100):
        assert browser.post('/camera-data', json=camera_payload(userId=f'user-{index}')).status_code == 200
    assert browser.post('/camera-data', json=camera_payload(userId='overflow')).status_code == 429


def test_camera_storage_is_bounded(compatibility_http):
    from metamuseum.models import OnlineUser
    browser, app = compatibility_http
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    app.state.camera_test_records.extend(OnlineUser(session_id=f'existing-{index}', update_time=now) for index in range(1000))
    assert browser.post('/camera-data', json=camera_payload()).status_code == 429
    assert len(app.state.camera_test_records) == 1000


def test_camera_database_failure_keeps_legacy_error_wrappers(compatibility_http, monkeypatch):
    from metamuseum.services import legacy_cameras
    browser, _ = compatibility_http
    def unavailable(*args):
        raise RuntimeError('synthetic database unavailable')
    monkeypatch.setattr(legacy_cameras, 'save', unavailable)
    response = browser.post('/camera-data', json=camera_payload())
    assert response.status_code == 500
    assert response.json() == {'error': 'server error'}
    monkeypatch.setattr(legacy_cameras, 'recent', unavailable)
    assert browser.get('/get-cameras').json() == []


def test_invalid_old_camera_snapshot_is_omitted(compatibility_http):
    from metamuseum.models import OnlineUser
    browser, app = compatibility_http
    app.state.camera_test_records.append(OnlineUser(
        session_id='invalid-old-camera', camera_position={'x': float('nan'), 'y': 0, 'z': 0},
        camera_rotation={'x': 0, 'y': 0, 'z': 0}, update_time=datetime.now(timezone.utc).replace(tzinfo=None)))
    assert browser.get('/get-cameras').json() == []


def test_wall_head_preserves_etag_and_empty_conditional_response(compatibility_http, monkeypatch):
    from metamuseum.api import legacy
    browser, app = compatibility_http
    wall = SimpleNamespace(updated_time=datetime(2026, 10, 31, 1, 2, 3))
    monkeypatch.setattr(legacy.service, 'get', lambda kind, identifier: wall)
    monkeypatch.setattr(legacy.service, 'wall_dto', lambda document: {'id': 'wall', 'name': 'first'})
    get = browser.get('/wall?wall_id=wall')
    head = browser.head('/wall?wall_id=wall')
    assert head.status_code == get.status_code == 200
    assert head.content == b''
    assert head.headers['etag'] == get.headers['etag']
    assert head.headers['last-modified'] == get.headers['last-modified']
    assert head.headers['content-type'] == get.headers['content-type']
    assert head.headers['content-length'] == get.headers['content-length']
    # TestClient itself suppresses HEAD bytes, so also inspect our response body directly.
    assert legacy.wall(Request({'type': 'http', 'method': 'HEAD', 'headers': [], 'app': app}), wall_id='wall').body == b''
    conditional = browser.head('/wall?wall_id=wall', headers={'If-None-Match': get.headers['etag']})
    assert conditional.status_code == 304
    assert conditional.headers['etag'] == get.headers['etag']
    assert conditional.content == b''


def test_wall_head_preserves_validation_and_missing_document_status(compatibility_http, monkeypatch):
    from metamuseum.api import legacy
    browser, _ = compatibility_http
    assert browser.head('/wall').status_code == browser.get('/wall').status_code == 400
    def missing(kind, identifier):
        raise HTTPException(404, 'document_not_found')
    monkeypatch.setattr(legacy.service, 'get', missing)
    assert browser.head('/wall?wall_id=missing').status_code == browser.get('/wall?wall_id=missing').status_code == 404
    assert browser.head('/wall?wall_id=missing').content == b''
