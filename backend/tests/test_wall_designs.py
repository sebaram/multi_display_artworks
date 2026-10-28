import json
from pathlib import Path
import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[2]

def test_source_look_rejects_blob_and_invalid_screen():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    assert validate_config(config) == config
    config['state']['videoLayers'] = [{'id': 'video-1', 'assetId': 'blob:bad'}]
    with pytest.raises(HTTPException):
        validate_config(config)
    config['state']['videoLayers'] = []
    config['logical_screen'] = 'missing'
    with pytest.raises(HTTPException):
        validate_config(config)

def admin_headers(client, csrf):
    response = client.post('/api/v1/auth/signin', headers=csrf, json={'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'})
    assert response.status_code == 200
    return {'Origin': 'http://testserver', 'X-CSRF-Token': client.get('/api/v1/auth/csrf').json()['csrf_token']}

def test_import_44_presets_is_idempotent(client):
    from metamuseum.services.wall_designs import import_defaults
    assert import_defaults() == 44
    first = client.get('/api/v1/wall-presets').json()
    assert len(first) == 44
    assert import_defaults() == 44
    assert client.get('/api/v1/wall-presets').json() == first

def test_save_apply_snapshot_cas_and_wall_preservation(client, csrf):
    headers = admin_headers(client, csrf)
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    before = client.get('/api/v1/rooms').json()[0]
    wall_id = before['walls'][0]['id']
    wall_before = client.get('/api/v1/walls/' + wall_id).json()
    created = client.post('/api/v1/wall-presets', headers=headers, json={'name':'Test', 'config': config}).json()
    applied = client.put(f'/api/v1/walls/{wall_id}/design', headers=headers, json={'preset_id':created['id'], 'expected_revision':0})
    assert applied.status_code == 200
    assert applied.json()['seed'] == config['seed']
    config['seed'] = 33
    updated = client.patch('/api/v1/wall-presets/' + created['id'], headers=headers, json={'config':config, 'expected_revision':1})
    assert updated.status_code == 200
    assert client.get(f'/api/v1/walls/{wall_id}/design').json()['seed'] != 33
    assert client.patch('/api/v1/wall-presets/' + created['id'], headers=headers, json={'name':'stale', 'expected_revision':1}).status_code == 409
    assert client.put(f'/api/v1/walls/{wall_id}/design', headers=headers, json={'config':config, 'expected_revision':0}).status_code == 409
    after = client.get('/api/v1/walls/' + wall_id).json()
    assert after['elements'] == wall_before['elements']
    assert after['image_url'] == wall_before['image_url']
    assert after['design'] == applied.json()
    assert client.delete('/api/v1/wall-presets/' + created['id'] + '?expected_revision=2', headers=headers).status_code == 204
    assert client.get(f'/api/v1/walls/{wall_id}/design').json() == applied.json()
    assert client.delete(f'/api/v1/walls/{wall_id}/design?expected_revision=1', headers=headers).status_code == 204
    assert client.get(f'/api/v1/walls/{wall_id}/design').json() is None

def test_look_rejects_unbounded_playback_values():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['speed'] = 300
    with pytest.raises(HTTPException):
        validate_config(config)

def test_look_rejects_invalid_authored_transforms_and_ids():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['authored'] = {'0': {'objects': [{'id':'object-1', 'type':'text', 'x': 151}], 'edits': {}}}
    with pytest.raises(HTTPException): validate_config(config)
    config['state']['authored']['0']['objects'][0]['x'] = 10
    config['state']['authored']['0']['edits'] = {'../bad': {'x':0}}
    with pytest.raises(HTTPException): validate_config(config)

def test_raw_empty_import_uses_source_defaults():
    from metamuseum.services.wall_designs import validate_config
    expected = json.loads((ROOT / 'backend/metamuseum/wall_default.json').read_text(encoding='utf8'))
    assert validate_config({}, raw=True) == expected

def test_raw_source_look_import_preserves_normalized_states():
    from metamuseum.services.wall_designs import validate_config
    manifest = json.loads((ROOT / 'frontend/public/wall-presets/manifest.json').read_text(encoding='utf8'))
    for item in manifest['presets']:
        source = json.loads((ROOT / 'frontend/public/wall-presets' / item['file']).read_text(encoding='utf8'))['config']
        normalized = validate_config(source['state'], raw=True)
        assert normalized['state'] == validate_config(source)['state']

def test_raw_import_normalizes_screen_defaults_and_legacy_dimensions():
    from metamuseum.services.wall_designs import validate_config
    result = validate_config({'frontW': 1280, 'frontH': 720, 'leftW': 1000, 'leftH': 500, 'screens':[{'id':'custom', 'width':1200, 'height':800}]}, raw=True)
    assert result['logical_screen'] == 'custom'
    assert result['state']['screens'][0] == {'id':'custom','name':'Screen 1','width':1200,'height':800,'mode':'raster','cols':1,'rows':1,'tileW':16,'tileH':9,'aspectW':16,'aspectH':9,'grid':False}
    assert result['state']['frontW'] == 1200

def test_import_rejects_traversal_and_blob_urls():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['videoLayers'] = [{'id':'video-1', 'customClip': {'url':'../../secret', 'name':'x'}}]
    with pytest.raises(HTTPException): validate_config(config)

def test_look_rejects_unrepresentable_integer():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['extra'] = 10 ** 100
    with pytest.raises(HTTPException): validate_config(config)

def test_catalog_prefers_built_frontend(settings, tmp_path):
    from metamuseum.services.wall_designs import catalog_root
    settings.frontend_root = tmp_path
    (tmp_path / 'wall-presets').mkdir()
    (tmp_path / 'wall-presets' / 'manifest.json').write_text('{}', encoding='utf8')
    assert catalog_root(settings) == tmp_path / 'wall-presets'

def test_nested_source_limits_are_enforced():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['authored'] = {'0': {'objects': [{'id':'object-1', 'type':'text', 'textSize': 401}], 'edits': {}}}
    with pytest.raises(HTTPException): validate_config(config)
    config['state']['authored'] = {}
    config['state']['appearance'] = {'0': {'glow': 3}}
    with pytest.raises(HTTPException): validate_config(config)
    config['state']['appearance'] = {}
    config['state']['videoLayers'] = [{'id':'video-1', 'screens': {'front': {'width': 101}}}]
    with pytest.raises(HTTPException): validate_config(config)

def test_look_rejects_invalid_variant_and_duplicate_video_ids():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['variant'] = 12
    with pytest.raises(HTTPException): validate_config(config)
    config['state']['variant'] = 0
    config['state']['videoLayers'] = [{'id':'video-1'}, {'id':'video-1'}]
    with pytest.raises(HTTPException): validate_config(config)

def test_look_rejects_extra_envelope_fields():
    from metamuseum.services.wall_designs import validate_config
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['extra'] = 'unexpected'
    with pytest.raises(HTTPException): validate_config(config)

def test_apply_and_remove_broadcast_with_keyword_room(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from metamuseum.api import wall_designs as api
    from metamuseum.schemas_wall_design import ApplyDesign
    events = []
    class Realtime:
        async def broadcast(self, event, data, *, room_id): events.append((event, room_id))
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(realtime=Realtime())))
    monkeypatch.setattr(api.service, 'apply', lambda *args: {'room_id':'room', 'revision':1})
    monkeypatch.setattr(api.service, 'unbind', lambda *args: 'room')
    async def exercise():
        await api.apply('wall', ApplyDesign(config={}, expected_revision=0), request)
        await api.unbind('wall', request, 1)
    asyncio.run(exercise())
    assert events == [('wall.design_applied','room'), ('wall.design_removed','room')]

def test_http_apply_and_remove_send_room_events(client, csrf, app):
    import json
    events = []
    class Realtime:
        async def broadcast(self, event, payload, *, room_id): events.append((event, payload, room_id))
    app.state.realtime = Realtime()
    headers = admin_headers(client, csrf)
    room = client.get('/api/v1/rooms').json()[0]
    wall_id = room['walls'][0]['id']
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    response = client.put(f'/api/v1/walls/{wall_id}/design', headers=headers, json={'config':config, 'expected_revision':0})
    assert response.status_code == 200
    assert events[0][0] == 'wall.design_applied' and events[0][2] == room['id']
    assert client.delete(f'/api/v1/walls/{wall_id}/design?expected_revision=1', headers=headers).status_code == 204
    assert events[1][0] == 'wall.design_removed' and events[1][2] == room['id']
    del app.state.realtime

def test_invalid_raw_screen_type_is_422():
    from metamuseum.services.wall_designs import validate_config
    with pytest.raises(HTTPException) as error:
        validate_config({'screens': None}, raw=True)
    assert error.value.status_code == 422
