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
    assert set(scene['avatarCatalog']) == {'shiba', 'robot', 'rigged-simple', 'none', 'casual', 'sporty', 'explorer', 'humanoid-robot'}
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


def test_stored_membership_wins_over_missing_or_unlisted_reverse_links(client, database):
    from bson import ObjectId
    from metamuseum import models as m
    model = m.GLTFmodel.objects.first()
    wall = model.wall
    room = wall.room
    database.g_l_t_fmodel.update_one({'_id': model.pk}, {'$unset': {'wall': ''}})
    unlisted = database.image.find_one()
    unlisted.update(_id=ObjectId(), name='unlisted-forward-only', wall=wall.pk)
    database.image.insert_one(unlisted)

    detail = client.get(f'/api/v1/walls/{wall.pk}').json()
    assert [element['id'] for element in detail['elements']] == [str(model.pk)]
    scene = client.get(f'/api/v1/rooms/{room.pk}/scene').json()
    scene_wall = next(item for item in scene['walls'] if item['id'] == str(wall.pk))
    assert [element['id'] for element in scene_wall['elements']] == [str(model.pk)]

    room.reload()
    reversed_ids = list(reversed([ref.id for ref in room._data['walls']]))
    database.room.update_one({'_id': room.pk}, {'$set': {'walls': reversed_ids}})
    assert [item['id'] for item in client.get(f'/api/v1/rooms/{room.pk}/scene').json()['walls']] == list(map(str, reversed_ids))
    database.room.update_one({'_id': room.pk}, {'$set': {'walls': []}})
    assert client.get(f'/api/v1/rooms/{room.pk}/scene').json()['walls'] == []
