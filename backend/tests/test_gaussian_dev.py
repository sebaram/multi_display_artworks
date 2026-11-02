from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from metamuseum.api.gaussian_dev import research_root, asset, status


def request(*, environment='test', enabled=True, client='127.0.0.1', host='127.0.0.1', allowed_hosts=None):
    settings = SimpleNamespace(environment=environment, gaussian_avatar_root=Path('FLAME/derived/web') if enabled else None,
                               gaussian_avatar_hosts=allowed_hosts or ['127.0.0.1', 'localhost', '::1'])
    app = SimpleNamespace(state=SimpleNamespace(settings=settings))
    return Request(dict(type='http', method='GET', scheme='http', path='/', headers=[(b'host', host.encode())],
                        client=(client, 1234), server=(host, 8000), app=app))


def test_private_model_delivery_requires_explicit_local_development():
    assert research_root(request()).name == 'web'
    for req in [request(environment='production'), request(enabled=False), request(client='192.168.1.5'),
                request(host='evil.invalid'), request(client='testclient')]:
        with pytest.raises(HTTPException) as raised:
            research_root(req)
        assert raised.value.status_code == 404


def test_private_model_delivery_allowlist_excludes_licenses_and_source_models():
    for name in ['references.bin', 'references.json', 'flame2023.pkl', '../flame2023.pkl']:
        with pytest.raises(HTTPException) as raised:
            asset(name, request())
        assert raised.value.status_code == 404


def test_status_reports_unavailable_without_a_failed_asset_request():
    assert status(request(environment='production')) == {
        'ready': False, 'scope': 'unavailable', 'reason': 'disabled'}


@pytest.fixture
def preview_client(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from starlette.middleware.sessions import SessionMiddleware
    from metamuseum.api.gaussian_dev import router
    from metamuseum.auth import router as auth_router
    from metamuseum.config import Settings
    from metamuseum.services.providers import RateLimiter
    app = FastAPI()
    app.state.settings = Settings(secret_key='test-preview-session', security_password_salt='test-salt',
        gaussian_avatar_root=tmp_path, gaussian_avatar_remote_enabled=True, gaussian_avatar_access_pin='1234',
        gaussian_avatar_hosts=['testserver'], allowed_origins=['http://testserver'])
    app.state.gaussian_avatar_limiter = RateLimiter()
    app.add_middleware(SessionMiddleware, secret_key=app.state.settings.secret_key)
    app.include_router(auth_router)
    app.include_router(router)
    for name in ['manifest.json', 'rig.bin', 'point_cloud.ply']:
        (tmp_path / name).write_bytes(b'private-fixture')
    return TestClient(app)


def test_remote_pin_protects_every_asset_and_expires(preview_client, monkeypatch):
    import metamuseum.api.gaussian_dev as preview
    client = preview_client
    base = '/api/v1/dev/gaussian-avatar/'
    assert client.get(base+'status').json()['scope'] == 'password_required'
    for name in ['manifest.json', 'rig.bin', 'point_cloud.ply']:
        assert client.get(base+name).status_code == 401
        assert client.head(base+name).status_code == 401
    token = client.get('/api/v1/auth/csrf').json()['csrf_token']
    headers = {'Origin': 'http://testserver', 'X-CSRF-Token': token}
    assert client.post(base+'unlock', json={'pin': '1234'}).status_code == 403
    assert client.post(base+'unlock', json={'pin': '9999'}, headers=headers).status_code == 401
    unlocked = client.post(base+'unlock', json={'pin': '1234'}, headers=headers)
    assert unlocked.status_code == 200
    assert unlocked.headers['cache-control'] == 'no-store'
    assert client.get(base+'status').json()['ready'] is True
    response = client.get(base+'rig.bin')
    assert response.content == b'private-fixture' and response.headers['cache-control'] == 'no-store'
    assert client.get(base+'references.bin').status_code == 404
    now = preview.time.time()
    monkeypatch.setattr(preview.time, 'time', lambda: now+1801)
    assert client.get(base+'rig.bin').status_code == 401
    assert client.get(base+'status').json()['scope'] == 'password_required'


def test_pin_attempts_are_limited_across_fresh_sessions(preview_client):
    client = preview_client
    for _ in range(5):
        client.cookies.clear()
        token = client.get('/api/v1/auth/csrf').json()['csrf_token']
        response = client.post('/api/v1/dev/gaussian-avatar/unlock', json={'pin': '9999'},
            headers={'Origin': 'http://testserver', 'X-CSRF-Token': token})
        assert response.status_code == 401
    response = client.post('/api/v1/dev/gaussian-avatar/unlock', json={'pin': '1234'},
        headers={'Origin': 'http://testserver', 'X-CSRF-Token': token})
    assert response.status_code == 429 and response.headers['retry-after']


def test_unlock_is_host_scoped_and_rotation_and_lock_revoke_files(preview_client):
    client = preview_client
    base = '/api/v1/dev/gaussian-avatar/'
    token = client.get('/api/v1/auth/csrf').json()['csrf_token']
    headers = {'Origin': 'http://testserver', 'X-CSRF-Token': token}
    assert client.post(base+'unlock', json={'pin': '1234'}, headers={**headers, 'Host': 'evil.invalid'}).status_code == 404
    assert client.post(base+'unlock', json={'pin': '1234'}, headers=headers).status_code == 200
    client.app.state.settings.gaussian_avatar_access_pin = '5678'
    assert client.get(base+'rig.bin').status_code == 401
    assert client.post(base+'unlock', json={'pin': '5678'}, headers=headers).status_code == 200
    assert client.delete(base+'unlock', headers=headers).status_code == 200
    assert client.get(base+'rig.bin').status_code == 401
    client.app.state.settings.gaussian_avatar_remote_enabled = False
    assert client.get(base+'status').json()['scope'] == 'unavailable'
    assert client.get(base+'rig.bin').status_code == 404


def test_private_forwarder_hostname_is_explicit_and_still_requires_loopback():
    hosts = ['localhost', 'jyuvr']
    assert research_root(request(host='jyuvr', allowed_hosts=hosts)).name == 'web'
    for req in [request(host='jyuvr'), request(host='evil.invalid', allowed_hosts=hosts),
                request(host='jyuvr', allowed_hosts=hosts, client='192.168.1.5'),
                request(host='jyuvr', allowed_hosts=hosts, environment='production')]:
        with pytest.raises(HTTPException) as raised:
            research_root(req)
        assert raised.value.status_code == 404


def test_native_preset_requires_local_package_and_is_absent_in_production(monkeypatch, tmp_path):
    from metamuseum.avatar_catalog import avatar_catalog
    from metamuseum.schemas_avatar import AvatarAppearanceV2
    monkeypatch.setenv('GAUSSIAN_AVATAR_ROOT', str(tmp_path))
    monkeypatch.setenv('ENVIRONMENT', 'test')
    assert not any(p['id'] == 'gaussian-306' for p in avatar_catalog()['presets'])
    for name in ['manifest.json', 'rig.bin', 'point_cloud.ply']:
        (tmp_path / name).write_bytes(b'local-test-placeholder')
    preset = next(p for p in avatar_catalog()['presets'] if p['id'] == 'gaussian-306')
    assert not preset['capabilities']['fullBody'] and preset['nativeGaussian'] == 'subject-306'
    assert AvatarAppearanceV2.model_validate(preset['defaultAppearance']).presetId == 'gaussian-306'
    monkeypatch.setenv('ENVIRONMENT', 'production')
    assert not any(p['id'] == 'gaussian-306' for p in avatar_catalog()['presets'])
