from test_admin import login


def test_all_legacy_routes_have_mapped_behavior(client, csrf):
    rooms = client.get('/api/v1/rooms').json()
    room = rooms[0]['id']
    scene = client.get(f'/api/v1/rooms/{room}/scene').json()
    wall = scene['walls'][0]
    element = wall['elements'][0]
    for path in ['/', f'/room?room_id={room}&ar=marker&debug=sync&user=new', f"/wall?wall_id={wall['id']}&refresh=5", f"/element?wall_element_id={element['id']}&type={element['wall_element_type']}&display_type=aframe&avatar=robot"]:
        assert client.get(path).status_code == 200
    assert client.get('/room').status_code == 400
    assert client.get(f'/room/{room}/presets').json()[0]['id']
    assert client.get(f'/room/{room}/boundary').json()['max_x'] == scene['boundary']['max_x']
    assert client.get('/kwanri', follow_redirects=False).status_code == 302
    h = login(client, csrf)
    assert client.get('/kwanri/room/edit?id=' + room).status_code == 200
    for resource in ['room', 'wall', 'image', 'gaussiansplat', 'gltfmodel', 'webpage', 'locationpreset', 'roomeffect', 'mm_marker_admin', 'llmconfig', 'whisperconfig']:
        for page in ['', 'new/', 'edit/', 'details/']:
            assert client.get(f'/kwanri/{resource}/{page}').status_code == 200
        for retired in ['export/csv/', 'api/file/', 'ajax/lookup/']:
            assert client.get(f'/kwanri/{resource}/{retired}').status_code == 410
    patch = f"/element/{element['id']}/{element['wall_element_type']}"
    assert client.patch(patch, headers=h, json={'rotation_y':45}).json()['status'] == 'success'
    preset = client.post(f'/room/{room}/preset', headers=h, json={'name':'new spawn','is_default':True}).json()['preset']
    assert client.get(f'/api/v1/rooms/{room}/scene').json()['spawn_preset']['id'] == preset['id']
    assert client.delete('/preset/' + preset['id'], headers=h).status_code == 200
    marker = client.get(f'/marker/room/{room}/markers').json()[0]
    assert client.get('/marker/' + marker['id'] + '/config').status_code == 200
    assert client.get('/marker/by-value/hiro/hiro').status_code == 200
    assert client.put('/marker/' + marker['id'], headers=h, json={'name':'updated marker'}).json()['name'] == 'updated marker'
    assert client.delete('/marker/' + marker['id'], headers=h).status_code == 200


def test_wall_refresh_etag_tracks_element_mutations(client, csrf):
    wall = client.get('/api/v1/admin/walls')
    h = login(client, csrf)
    wall = client.get('/api/v1/admin/walls').json()['items'][0]
    url = '/wall?wall_id=' + wall['id'] + '&refresh=5'
    before = client.get(url).headers['etag']
    image = client.get('/api/v1/admin/images').json()['items'][0]
    assert client.patch('/api/v1/admin/images/' + image['id'], headers=h, json={'rotation_z':30}).status_code == 200
    assert client.get(url).headers['etag'] != before


def test_legacy_admin_forms_inline_edit_and_bulk_delete(client, csrf):
    assert client.post('/kwanri/room/new/', data={'name':'denied'}).status_code == 403
    h = login(client, csrf)
    assert client.post('/kwanri/room/new/', data={'name':'denied'}).status_code == 403
    created = []
    for index in range(2):
        result = client.post('/kwanri/room/new/', headers=h,
                             data={'name':f'legacy-created-{index}', 'description':'created from form'}, follow_redirects=False)
        assert result.status_code == 303
        rooms = client.get('/api/v1/admin/rooms').json()['items']
        created.append(next(r['id'] for r in rooms if r['name'] == f'legacy-created-{index}'))
    assert client.post('/kwanri/room/edit/?id=' + created[0], headers=h,
                       data={'description':'edited from form'}, follow_redirects=False).status_code == 303
    assert client.post('/kwanri/room/ajax/update/', headers=h,
                       data={'pk':created[0], 'name':'description', 'value':'inline edit'}).status_code == 200
    assert client.get('/api/v1/admin/rooms/' + created[0]).json()['description'] == 'inline edit'
    assert client.post('/kwanri/room/action/', headers=h, json={'action':'delete', 'rowid':created}, follow_redirects=False).status_code == 303
    assert all(client.get('/api/v1/admin/rooms/' + identifier).status_code == 404 for identifier in created)


def test_built_spa_media_and_api_404_boundaries(settings, database, tmp_path):
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app
    build = tmp_path / 'frontend'
    build.mkdir()
    (build / 'index.html').write_text('<!doctype html><div id="root">Built React</div>')
    (build / 'vendor').mkdir()
    (build / 'vendor' / 'a.js').write_text('window.vendor = true;')
    media = tmp_path / 'media'
    media.mkdir()
    (media / 'example.txt').write_text('legacy-media')
    app = create_app(settings.model_copy(update={'frontend_root':build, 'media_root':media}))
    with TestClient(app) as browser:
        assert 'Built React' in browser.get('/signin').text
        assert 'Built React' in browser.get('/logout').text
        assert browser.get('/static/example.txt').text == 'legacy-media'
        assert browser.get('/vendor/a.js').status_code == 200
        assert browser.get('/health').json() == {'status':'ok'}
        assert browser.get('/api/not-a-route').status_code == 404
        assert browser.get('/static/missing').status_code == 404
