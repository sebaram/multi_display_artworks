from metamuseum.services.wall_media import detect_type

def test_signature_rejects_svg_and_mime_mismatch():
    assert detect_type(b'\x89PNG\r\n\x1a\nrest', 'image/png') == 'image/png'
    assert detect_type(b'<svg></svg>', 'image/svg+xml') is None
    assert detect_type(b'\x89PNG\r\n\x1a\nrest', 'video/mp4') is None

def test_upload_auth_quota_range_and_references(client, csrf, settings, tmp_path):
    from test_wall_designs import admin_headers
    settings.wall_media_root = tmp_path
    media = b'\x00\x00\x00\x18ftypisom' + b'0123456789'
    assert client.post('/api/v1/wall-assets', files={'file': ('test.mp4', media, 'video/mp4')}).status_code == 403
    headers = admin_headers(client, csrf)
    result = client.post('/api/v1/wall-assets', headers=headers, files={'file': ('../../x.mp4', media, 'video/mp4')})
    assert result.status_code == 201
    item = result.json()
    response = client.get(item['url'], headers={'Range':'bytes=4-8'})
    assert response.status_code == 206 and response.content == media[4:9]
    assert response.headers['content-range'] == f'bytes 4-8/{len(media)}'
    settings.wall_media_quota_bytes = len(media)
    assert client.post('/api/v1/wall-assets', headers=headers, files={'file': ('test.mp4', media, 'video/mp4')}).status_code == 413
    assert len(list(tmp_path.iterdir())) == 1
    assert client.delete('/api/v1/wall-assets/' + item['id'], headers=headers).status_code == 204
    assert not list(tmp_path.iterdir())

def test_cleanup_removes_only_uncommitted_generated_files(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from metamuseum.services import wall_media
    from bson import ObjectId
    kept, orphan = str(ObjectId()), str(ObjectId())
    for name in [kept, orphan, orphan + '.partial', 'other.txt']:
        (tmp_path / name).write_bytes(b'data')
    class Assets:
        def find(self, *args): return [{'_id': ObjectId(kept)}]
    monkeypatch.setattr(wall_media, 'collection', lambda name: Assets())
    wall_media.cleanup(SimpleNamespace(wall_media_root=tmp_path))
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([kept, 'other.txt'])

def test_referenced_asset_cannot_be_deleted(client, csrf, settings, tmp_path):
    import json
    from test_wall_designs import ROOT, admin_headers
    settings.wall_media_root = tmp_path
    headers = admin_headers(client, csrf)
    media = b'\x00\x00\x00\x18ftypisom' + b'0123456789'
    item = client.post('/api/v1/wall-assets', headers=headers, files={'file': ('test.mp4', media, 'video/mp4')}).json()
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['videoLayers'] = [{'id':'video-1', 'assetId':item['id']}]
    preset = client.post('/api/v1/wall-presets', headers=headers, json={'name':'Referenced', 'config':config}).json()
    assert client.delete('/api/v1/wall-assets/' + item['id'], headers=headers).status_code == 409
    wall_id = client.get('/api/v1/rooms').json()[0]['walls'][0]['id']
    assert client.put(f'/api/v1/walls/{wall_id}/design', headers=headers, json={'preset_id':preset['id'], 'expected_revision':0}).status_code == 200
    assert client.delete(f"/api/v1/wall-presets/{preset['id']}?expected_revision=1", headers=headers).status_code == 204
    assert client.delete('/api/v1/wall-assets/' + item['id'], headers=headers).status_code == 409
    assert client.delete(f'/api/v1/walls/{wall_id}/design?expected_revision=1', headers=headers).status_code == 204
    assert client.delete('/api/v1/wall-assets/' + item['id'], headers=headers).status_code == 204

def test_restart_restores_presets_bindings_and_assets(settings, database, tmp_path):
    import json
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app
    from test_wall_designs import ROOT, admin_headers
    settings.wall_media_root = tmp_path
    with TestClient(create_app(settings)) as client:
        csrf = {'Origin':'http://testserver', 'X-CSRF-Token':client.get('/api/v1/auth/csrf').json()['csrf_token']}
        headers = admin_headers(client, csrf)
        media = b'\x00\x00\x00\x18ftypisom' + b'restart'
        asset = client.post('/api/v1/wall-assets', headers=headers, files={'file': ('a.mp4', media, 'video/mp4')}).json()
        config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
        config['state']['videoLayers'] = [{'id':'video-1', 'assetId':asset['id']}]
        preset = client.post('/api/v1/wall-presets', headers=headers, json={'name':'Persistent', 'config':config}).json()
        wall_id = client.get('/api/v1/rooms').json()[0]['walls'][0]['id']
        applied = client.put(f'/api/v1/walls/{wall_id}/design', headers=headers, json={'preset_id':preset['id'], 'expected_revision':0}).json()
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/wall-presets/' + preset['id']).json() == preset
        assert client.get(f'/api/v1/walls/{wall_id}/design').json() == applied
        assert client.get(asset['url']).content == media

def test_concurrent_uploads_do_not_exceed_quota(client, csrf, settings, tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from test_wall_designs import admin_headers
    settings.wall_media_root = tmp_path
    media = b'\x00\x00\x00\x18ftypisom' + b'x' * 32
    settings.wall_media_quota_bytes = len(media)
    headers = admin_headers(client, csrf)
    def send():
        return client.post('/api/v1/wall-assets', headers=headers, files={'file':('a.mp4', media, 'video/mp4')}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: send(), range(2)))
    assert sorted(statuses) == [201, 413]
    assert len(list(tmp_path.iterdir())) == 1

def test_auth_runs_before_parsing_malformed_multipart(client):
    response = client.post('/api/v1/wall-assets', content=b'invalid multipart body', headers={'Content-Type':'multipart/form-data; boundary=x'})
    assert response.status_code == 403

def test_partial_upload_cleans_files(client, csrf, settings, tmp_path):
    from test_wall_designs import admin_headers
    settings.wall_media_root = tmp_path
    headers = admin_headers(client, csrf)
    headers['Content-Type'] = 'multipart/form-data; boundary=abc'
    body = b'--abc\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\n\x00\x00\x00\x18ftypisom'
    response = client.post('/api/v1/wall-assets', headers=headers, content=body)
    assert response.status_code == 422
    assert list(tmp_path.iterdir()) == []

def test_concurrent_reference_and_delete_are_serialized(client, csrf, settings, tmp_path):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from test_wall_designs import ROOT, admin_headers
    settings.wall_media_root = tmp_path
    headers = admin_headers(client, csrf)
    media = b'\x00\x00\x00\x18ftypisom' + b'content'
    asset = client.post('/api/v1/wall-assets', headers=headers, files={'file':('a.mp4', media, 'video/mp4')}).json()
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['videoLayers'] = [{'id':'video-1', 'assetId':asset['id']}]
    barrier = Barrier(2)
    def save():
        barrier.wait()
        return client.post('/api/v1/wall-presets', headers=headers, json={'name':'Concurrent', 'config':config}).status_code
    def delete():
        barrier.wait()
        return client.delete('/api/v1/wall-assets/' + asset['id'], headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        save_future = pool.submit(save); delete_future = pool.submit(delete)
        outcome = (save_future.result(), delete_future.result())
    assert outcome in [(201, 409), (422, 204)]

def test_upload_does_not_block_event_loop_during_database_wait(monkeypatch, tmp_path):
    import asyncio
    import threading
    from types import SimpleNamespace
    from metamuseum.services import wall_media
    entered = threading.Event(); release = threading.Event()
    class Assets:
        def find(self, *args): entered.set(); release.wait(3); return []
    monkeypatch.setattr(wall_media, 'collection', lambda name: Assets())
    settings = SimpleNamespace(wall_media_root=tmp_path, wall_media_max_file_bytes=1024, wall_media_quota_bytes=1024)
    class Request:
        headers = {'content-type':'multipart/form-data; boundary=x'}
        app = SimpleNamespace(state=SimpleNamespace(settings=settings))
        async def stream(self):
            yield b''
    async def exercise():
        task = asyncio.create_task(wall_media.upload(Request()))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            await asyncio.wait_for(asyncio.sleep(.01), timeout=.2)
        finally:
            release.set()
            try: await task
            except Exception: pass
    asyncio.run(exercise())

def test_invalid_multipart_returns_422_and_cleans_partial(monkeypatch, tmp_path):
    import asyncio
    from types import SimpleNamespace
    import pytest
    from fastapi import HTTPException
    from metamuseum.services import wall_media
    class Assets:
        def find(self, *args): return []
    monkeypatch.setattr(wall_media, 'collection', lambda name: Assets())
    settings = SimpleNamespace(wall_media_root=tmp_path, wall_media_max_file_bytes=1024, wall_media_quota_bytes=1024)
    class Request:
        headers = {'content-type':'multipart/form-data; boundary=x'}
        app = SimpleNamespace(state=SimpleNamespace(settings=settings))
        async def stream(self): yield b'not a multipart body'
    with pytest.raises(HTTPException) as error:
        asyncio.run(wall_media.upload(Request()))
    assert error.value.status_code == 422
    assert not list(tmp_path.iterdir())

def test_cancelled_upload_preserves_committed_content(monkeypatch, tmp_path):
    import asyncio
    import threading
    from types import SimpleNamespace
    from metamuseum.services import wall_media
    entered = threading.Event(); release = threading.Event(); docs = []
    class Assets:
        def find(self, *args): return []
        def insert_one(self, doc): entered.set(); release.wait(3); docs.append(doc)
    monkeypatch.setattr(wall_media, 'collection', lambda name: Assets())
    settings = SimpleNamespace(wall_media_root=tmp_path, wall_media_max_file_bytes=1024, wall_media_quota_bytes=1024)
    class Request:
        headers = {'content-type':'multipart/form-data; boundary=x'}
        app = SimpleNamespace(state=SimpleNamespace(settings=settings))
        async def stream(self):
            yield b'--x\r\nContent-Disposition: form-data; name="file"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\n\x00\x00\x00\x18ftypisomvideo\r\n--x--\r\n'
    async def exercise():
        task = asyncio.create_task(wall_media.upload(Request()))
        assert await asyncio.to_thread(entered.wait, 2)
        task.cancel(); release.set()
        try: await task
        except asyncio.CancelledError: pass
    asyncio.run(exercise())
    assert len(docs) == 1
    assert (tmp_path / str(docs[0]['_id'])).read_bytes().endswith(b'video')

def test_mixed_case_references_cannot_be_deleted(client, csrf, settings, tmp_path, database):
    import json
    from test_wall_designs import ROOT, admin_headers
    settings.wall_media_root = tmp_path
    headers = admin_headers(client, csrf)
    content = b'\x89PNG\r\n\x1a\nimage'
    item = client.post('/api/v1/wall-assets', headers=headers, files={'file':('x.png', content, 'image/png')}).json()
    config = json.loads((ROOT / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state']['videoLayers'] = [{'id':'video-1', 'assetId':item['id'].upper()}]
    preset = client.post('/api/v1/wall-presets', headers=headers, json={'name':'mixed', 'config':config, 'thumbnail_asset_id':item['id'].upper()}).json()
    assert preset['asset_ids'] == [item['id']]
    assert preset['thumbnail_asset_id'] == item['id']
    for key in (item['id'], item['id'].upper()):
        assert client.delete('/api/v1/wall-assets/' + key, headers=headers).status_code == 409
        assert client.get(item['url']).content == content
    # Existing records written before canonicalization remain protected.
    database.wall_design_presets.update_one({'name':'mixed'}, {'$set':{'asset_ids':[item['id'].upper()], 'thumbnail_asset_id':item['id'].upper()}})
    assert client.delete('/api/v1/wall-assets/' + item['id'], headers=headers).status_code == 409
    assert client.get(item['url']).content == content
