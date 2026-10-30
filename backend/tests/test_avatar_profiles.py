from copy import deepcopy
from fastapi.testclient import TestClient


def appearance(client):
    return deepcopy(client.get('/api/v1/avatars/catalog').json()['presets'][0]['defaultAppearance'])


def put(client, csrf, saved, look):
    return client.put('/api/v1/me/avatar', headers=csrf, json={
        'appearance': look, 'expectedRevision': saved['revision'],
        'ownerScopeToken': saved['ownerScopeToken']})


def test_anonymous_preference_is_lazy_private_signed_and_revision_checked(client, csrf, database, app):
    first = client.get('/api/v1/me/avatar')
    assert first.status_code == 200
    saved = first.json()
    assert saved['revision'] == 0 and saved['appearance'] is None
    cookie = first.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie
    assert database.avatar_profiles.count_documents({}) == 0
    look = appearance(client)
    response = put(client, csrf, saved, look)
    assert response.status_code == 200
    assert response.json()['appearance'] == look
    assert response.json()['revision'] == 1
    assert put(client, csrf, saved, look).status_code == 409
    assert client.get('/api/v1/me/avatar').json() == response.json()
    record = database.avatar_profiles.find_one()
    assert record['expiresAt'] is not None
    indexes = list(database.avatar_profiles.list_indexes())
    assert any(i.get('unique') and list(i['key']) == ['ownerKey'] for i in indexes)
    assert any(i.get('expireAfterSeconds') == 0 and list(i['key']) == ['expiresAt'] for i in indexes)
    assert 'ownerKey' not in response.text
    with TestClient(app) as other:
        isolated = other.get('/api/v1/me/avatar').json()
        assert isolated['appearance'] is None
        assert isolated['ownerScopeToken'] != saved['ownerScopeToken']
        other.cookies.set('metamuseum_avatar_owner', 'forged')
        assert other.get('/api/v1/me/avatar').json()['appearance'] is None


def test_profile_validation_csrf_and_compatibility(client, csrf):
    saved = client.get('/api/v1/me/avatar').json()
    look = appearance(client)
    assert put(client, {}, saved, look).status_code == 403
    for patch in [{'presetId': 'unknown'}, {'assetUrl': 'https://evil.invalid/a.glb'},
                  {'colors': {**look['colors'], 'top': 'red'}}, {'hairId': 'https://evil.invalid/hair.glb'}]:
        assert put(client, csrf, saved, {**look, **patch}).status_code == 422
    look.update(hatId='cap', hairId='short', faceId='unsupported')
    result = put(client, csrf, saved, look)
    assert result.status_code == 200
    assert result.json()['appearance']['hairId'] == 'none'
    assert result.json()['appearance']['faceId'] == 'friendly'


def test_account_switch_scope_and_logout_restore_anonymous_without_automatic_write(client, csrf, database):
    anonymous = client.get('/api/v1/me/avatar').json()
    look = appearance(client)
    look['colors']['top'] = '#123456'
    anonymous = put(client, csrf, anonymous, look).json()
    assert client.post('/api/v1/auth/signin', headers=csrf, json={
        'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'}).status_code == 200
    csrf['X-CSRF-Token'] = client.get('/api/v1/auth/csrf').json()['csrf_token']
    account = client.get('/api/v1/me/avatar').json()
    assert account['appearance'] == look and account['revision'] == 0
    assert put(client, csrf, anonymous, look).status_code == 409
    assert database.avatar_profiles.count_documents({}) == 1
    look['colors']['top'] = '#654321'
    account = put(client, csrf, account, look).json()
    assert database.avatar_profiles.count_documents({}) == 2
    assert client.post('/api/v1/auth/signout', headers=csrf).status_code == 200
    assert client.get('/api/v1/me/avatar').json()['appearance']['colors']['top'] == '#123456'
    csrf['X-CSRF-Token'] = client.get('/api/v1/auth/csrf').json()['csrf_token']
    assert put(client, csrf, account, look).status_code == 409
    assert client.post('/api/v1/auth/signin', headers=csrf, json={
        'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'}).status_code == 200
    assert client.get('/api/v1/me/avatar').json()['appearance']['colors']['top'] == '#654321'
    assert database.avatar_profiles.find_one({'ownerKey': {'$regex': '^account:'}}).get('expiresAt') is None


def test_profile_legacy_migration_and_presence_snapshots():
    from metamuseum.realtime.profile import normalize_profile
    from metamuseum.realtime.presence import PresenceService
    from metamuseum.avatar_catalog import avatar_catalog
    assert normalize_profile({'displayName': 'Guest', 'avatarId': 'robot', 'color': '#123456'}) == {
        'displayName': 'Guest', 'avatarId': 'robot', 'color': '#123456'}
    look = avatar_catalog()['presets'][0]['defaultAppearance']
    profile = {'displayName': 'Guest', 'avatarId': 'casual', 'color': '#000000', 'appearance': look}
    normalized = normalize_profile(profile)
    assert normalized['appearance'] == look
    assert normalized['color'] == look['colors']['top']
    presence = PresenceService()
    presence.join('room', 'one', 'visitor-one', profile, {}, {})
    _, existing, _ = presence.join('room', 'two', 'visitor-two', {}, {}, {})
    assert existing[0]['appearance'] == look
    look = deepcopy(look)
    look['colors']['top'] = '#123456'
    presence.update_profile('room', 'one', {**profile, 'appearance': look})
    assert presence.public_room_state('room')[0]['appearance'] == look
    assert 'ownerKey' not in str(presence.public_room_state('room'))
    event = presence.update_profile('room', 'one', {'displayName': 'Guest', 'avatarId': 'robot', 'color': '#ABCDEF'})
    assert 'appearance' in event and event['appearance'] is None
    assert 'appearance' not in presence.public_room_state('room')[0]


def test_malformed_socket_appearance_never_raises():
    from metamuseum.realtime.profile import normalize_profile
    for look in [{'presetId': []}, {'presetId': 'casual', 'colors': []},
                 {'presetId': 'casual', 'colors': {'top': []}, 'hatId': {}}, {'presetId': {}}]:
        result = normalize_profile({'displayName': 'Guest', 'appearance': look})
        assert result['appearance']['presetId'] in {'shiba', 'casual'}
