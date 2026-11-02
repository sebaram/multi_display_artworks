from fastapi.testclient import TestClient
from metamuseum.asgi import create_app
from metamuseum.config import Settings


def test_lam_preview_is_opt_in_and_every_file_checks_the_shared_pin(tmp_path):
    settings = Settings(secret_key='lam-test-session', security_password_salt='lam-test-salt',
        allowed_origins=['http://testserver'], gaussian_avatar_hosts=['testserver'],
        gaussian_avatar_access_pin='1234', gaussian_avatar_remote_enabled=True,
        wall_media_root=tmp_path/'media', stream_root=tmp_path/'streams')
    client = TestClient(create_app(settings))  # No lifespan/DB needed for these routes.
    base = '/api/v1/dev/lam-avatar/'
    assert client.get(base+'status').json()['scope'] == 'unavailable'
    settings.lam_avatar_root = tmp_path
    (tmp_path/'avatar.zip').write_bytes(b'private-zip-fixture')
    (tmp_path/'manifest.json').write_text('{}')
    assert client.get(base+'status').json()['scope'] == 'password_required'
    for name in ['avatar.zip', 'manifest.json']:
        assert client.get(base+name).status_code == 401
        assert client.head(base+name).status_code == 401
    token = client.get('/api/v1/auth/csrf').json()['csrf_token']
    headers = {'Origin': 'http://testserver', 'X-CSRF-Token': token}
    assert client.post(base+'unlock', json={'pin':'1234'}, headers=headers).status_code == 200
    assert client.get(base+'status').json()['ready'] is True
    response = client.get(base+'avatar.zip')
    assert response.content == b'private-zip-fixture' and response.headers['cache-control'] == 'no-store'
    assert client.get(base+'input.png').status_code == 404
    assert client.delete(base+'unlock', headers=headers).status_code == 200
    assert client.get(base+'avatar.zip').status_code == 401


def test_lam_frame_entry_is_revalidated_after_rebuild(tmp_path):
    (tmp_path/'lam-preview.html').write_text('<html>frame entry</html>')
    settings = Settings(secret_key='lam-test-session', security_password_salt='lam-test-salt', frontend_root=tmp_path)
    client = TestClient(create_app(settings))
    response = client.get('/lam-preview.html')
    assert response.status_code == 200
    assert response.headers.get('cache-control') == 'no-cache'
