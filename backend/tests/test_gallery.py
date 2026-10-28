import json


def test_room_scene_excludes_secrets(client):
    rooms = client.get('/api/v1/rooms').json()
    assert isinstance(rooms, list) and len(rooms) == 2
    scene = client.get(f"/api/v1/rooms/{rooms[0]['id']}/scene?ar=marker&debug=sync").json()
    assert scene['roomId'] == rooms[0]['id']
    assert scene['isArMarker'] and scene['syncDebugEnabled']
    assert not scene['isAdmin'] and not scene['roomControlsEnabled']
    assert scene['spawn_preset']['is_default']
    assert client.get(f"/api/v1/rooms/{rooms[0]['id']}/scene").json()['roomControlsEnabled']
    assert scene['walls'][0]['elements']
    assert set(scene['avatarCatalog']) == {'shiba', 'robot', 'rigged-simple', 'none'}
    serialized = json.dumps(scene)
    for word in ['password', 'api_key', 'aframe_list', '<a-']:
        assert word not in serialized
    wall = scene['walls'][0]
    assert client.get(f"/api/v1/walls/{wall['id']}").json()['room']['id'] == rooms[0]['id']
    element = wall['elements'][0]
    assert client.get(f"/api/v1/elements/{element['wall_element_type']}/{element['id']}").json()['wall'] == wall['id']


def test_gallery_object_ids_and_missing_records(client):
    for path in ['/api/v1/rooms/{}/scene', '/api/v1/walls/{}', '/api/v1/elements/image/{}']:
        assert client.get(path.format('invalid')).status_code == 400
        assert client.get(path.format('f' * 24)).status_code == 404
    assert client.get('/api/v1/not-a-route').status_code == 404
