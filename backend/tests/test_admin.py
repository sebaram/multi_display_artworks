import pytest

RESOURCES = ['rooms', 'walls', 'images', 'splats', 'gltfs', 'webpages', 'locations', 'effects', 'markers', 'llm-configs', 'whisper-configs']


def login(client, csrf):
    assert client.post('/api/v1/auth/signin', headers=csrf, json={'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'}).status_code == 200
    return {**csrf, 'X-CSRF-Token': client.get('/api/v1/auth/csrf').json()['csrf_token']}


def test_all_admin_resources_require_admin(client, csrf):
    assert client.get('/api/v1/admin/schema').status_code == 403
    for slug in RESOURCES:
        base = '/api/v1/admin/' + slug
        assert client.get(base).status_code == 403
        assert client.post(base, json={}).status_code == 403
        assert client.patch(base + '/' + 'f'*24, json={}).status_code == 403
        assert client.delete(base + '/' + 'f'*24).status_code == 403
    headers = login(client, csrf)
    schema = client.get('/api/v1/admin/schema').json()['resources']
    assert {r['name'] for r in schema} == set(RESOURCES)
    for slug in RESOURCES:
        result = client.get('/api/v1/admin/' + slug).json()
        assert result['total'] > 0 and result['items'][0]['id']
    assert client.get('/api/v1/admin/users').status_code == 404
    assert client.get('/api/v1/admin/rooms?limit=201').status_code == 422
    assert client.post('/api/v1/admin/rooms', json={'name':'x','description':'x'}).status_code == 403


def test_relationships_survive_move_and_delete(client, csrf):
    h = login(client, csrf)
    rooms = client.get('/api/v1/rooms').json()
    wall = client.get('/api/v1/admin/walls').json()['items'][0]
    old_room = wall['room']
    new_room = next(r['id'] for r in rooms if r['id'] != old_room)
    assert client.patch('/api/v1/admin/walls/' + wall['id'], headers=h, json={'room':new_room}).status_code == 200
    assert wall['id'] not in client.get('/api/v1/admin/rooms/' + old_room).json()['walls']
    assert wall['id'] in client.get('/api/v1/admin/rooms/' + new_room).json()['walls']
    image = client.get('/api/v1/admin/images').json()['items'][0]
    other = next(w for w in client.get('/api/v1/admin/walls').json()['items'] if w['id'] != image['wall'])
    assert client.patch('/api/v1/admin/images/' + image['id'], headers=h, json={'wall':other['id']}).status_code == 200
    assert image['id'] not in client.get('/api/v1/admin/walls/' + image['wall']).json()['images']
    assert client.get('/api/v1/admin/walls/' + other['id']).json()['images'][-1] == image['id']
    assert client.delete('/api/v1/admin/walls/' + other['id'], headers=h).status_code == 409
    assert client.delete('/api/v1/admin/images/' + image['id'], headers=h).status_code == 204
    assert image['id'] not in client.get('/api/v1/admin/walls/' + other['id']).json()['images']


@pytest.mark.parametrize('reverse_link', ['missing', 'stale'])
def test_explicit_move_uses_containing_lists_and_unrelated_edit_preserves_them(client, csrf, database, reverse_link):
    from metamuseum import models as m
    headers = login(client, csrf)
    model = m.GLTFmodel.objects.first()
    old = model.wall
    target = m.Wall.objects(pk__ne=old.pk).first()
    database.g_l_t_fmodel.update_one({'_id': model.pk}, {'$set': {'wall': None if reverse_link == 'missing' else target.pk}})
    url = '/api/v1/admin/gltfs/' + str(model.pk)
    assert client.patch(url, headers=headers, json={'description': 'Metadata only'}).status_code == 200
    old.reload();target.reload()
    assert model.pk in [item.pk for item in old.gltfs]
    assert model.pk not in [item.pk for item in target.gltfs]
    assert client.patch(url, headers=headers, json={'wall': str(target.pk)}).status_code == 200
    old.reload();target.reload()
    assert model.pk not in [item.pk for item in old.gltfs]
    assert model.pk in [item.pk for item in target.gltfs]


def test_deleting_legacy_child_cleans_parent_list_and_nonempty_wall_is_guarded(client, csrf, database):
    from metamuseum import models as m
    headers = login(client, csrf)
    model = m.GLTFmodel.objects.first()
    wall = model.wall
    database.g_l_t_fmodel.update_one({'_id': model.pk}, {'$unset': {'wall': ''}})
    assert client.delete('/api/v1/admin/walls/' + str(wall.pk), headers=headers).status_code == 409
    assert client.delete('/api/v1/admin/gltfs/' + str(model.pk), headers=headers).status_code == 204
    wall.reload()
    assert wall.gltfs == []


def test_unlisted_forward_child_does_not_appear_after_metadata_edit(client, csrf, database):
    from bson import ObjectId
    headers = login(client, csrf)
    unlisted = database.image.find_one()
    unlisted.update(_id=ObjectId(), name='unlisted-metadata-target')
    database.image.insert_one(unlisted)
    wall_id = str(unlisted['wall'])
    assert client.patch('/api/v1/admin/images/' + str(unlisted['_id']), headers=headers,
                        json={'description': 'Metadata only'}).status_code == 200
    wall = client.get('/api/v1/admin/walls/' + wall_id).json()
    assert str(unlisted['_id']) not in wall['images']


def test_transforms_validate_finite_bounds_and_units(client, csrf):
    h = login(client, csrf)
    wall = client.get('/api/v1/admin/walls').json()['items'][0]
    url = '/api/v1/admin/walls/' + wall['id']
    for body in [{'position':'NaN 0 0'}, {'rotation':'0 0'}, {'width':-1}, {'width':'Infinity'}, {'$set':{'name':'x'}}, {'unknown':'x'}, {'images':[]}]:
        assert client.patch(url, headers=h, json=body).status_code == 422
    room = client.get('/api/v1/admin/rooms').json()['items'][0]
    assert client.patch('/api/v1/admin/rooms/' + room['id'], headers=h, json={'boundary_min_x':100}).status_code == 422
    assert client.patch(url, headers=h, json={'rotation':'0 90 0','position':'1 2 3'}).json()['rotation'] == '0 90 0'


def test_admin_secrets_and_errors_are_safe(client, csrf):
    h = login(client, csrf)
    configs = client.get('/api/v1/admin/llm-configs').json()['items']
    assert configs[0]['has_api_key'] and 'api_key' not in configs[0]
    url = '/api/v1/admin/llm-configs/' + configs[0]['id']
    assert client.patch(url, headers=h, json={'api_key':''}).json()['has_api_key']
    response = client.patch(url, headers=h, json={'api_key':'sentinel-secret', 'provider':'bad-provider'})
    assert response.status_code == 422 and 'sentinel-secret' not in response.text
    assert client.post('/api/v1/admin/rooms', headers=h, json={'name':'unique-test','description':'x'}).status_code == 201
    assert client.post('/api/v1/admin/rooms', headers=h, json={'name':'unique-test','description':'x'}).status_code == 409


@pytest.mark.parametrize('resource', RESOURCES)
def test_every_resource_create_read_patch_delete(client, csrf, resource):
    h = login(client, csrf)
    schema = next(s for s in client.get('/api/v1/admin/schema').json()['resources'] if s['name'] == resource)
    original = client.get('/api/v1/admin/' + resource).json()['items'][0]
    editable = {f['name'] for f in schema['fields'] if not f['readonly']}
    body = {k:v for k,v in original.items() if k in editable}
    if 'name' in body:
        body['name'] = 'Created ' + resource
    if resource.endswith('configs'):
        body['api_key'] = 'local-test-only-secret'
    response = client.post('/api/v1/admin/' + resource, headers=h, json=body)
    assert response.status_code == 201, response.text
    item = response.json()
    url = '/api/v1/admin/' + resource + '/' + item['id']
    assert client.get(url).json()['id'] == item['id']
    change = {'description':'Edited via API'} if 'description' in editable else {'model':'edited-model'}
    assert client.patch(url, headers=h, json=change).status_code == 200
    assert client.delete(url, headers=h).status_code == 204
    assert client.get(url).status_code == 404


def test_invalid_nullable_geometry_and_references(client, csrf):
    h = login(client, csrf)
    for resource in ['rooms', 'walls', 'images', 'locations', 'markers']:
        doc = client.get('/api/v1/admin/' + resource).json()['items'][0]
        url = '/api/v1/admin/' + resource + '/' + doc['id']
        name = 'boundary_min_x' if resource == 'rooms' else 'width' if resource in ['walls','images'] else 'position_x' if resource == 'locations' else 'target_position_x'
        assert client.patch(url, headers=h, json={name:None}).status_code == 422
    image = client.get('/api/v1/admin/images').json()['items'][0]
    assert client.patch('/api/v1/admin/images/' + image['id'], headers=h, json={'wall':'f'*24}).status_code == 404
    assert client.patch('/api/v1/admin/images/' + image['id'], headers=h, json={'wall':{'$ne':None}}).status_code == 422


def test_required_fields_and_linked_preset_room_changes_are_safe(client, csrf):
    h = login(client, csrf)
    location = client.get('/api/v1/admin/locations').json()['items'][0]
    response = client.post('/api/v1/admin/markers', headers=h, json={'target_preset':location['id']})
    assert response.status_code == 422
    other_room = next(r for r in client.get('/api/v1/rooms').json() if r['id'] != location['room'])
    assert client.patch('/api/v1/admin/locations/' + location['id'], headers=h, json={'room':other_room['id']}).status_code == 409


def test_nonadmin_cannot_read_or_mutate_admin_resources(client, csrf):
    assert client.post('/api/v1/auth/signin', headers=csrf, json={'email':'visitor@migration.invalid', 'password':'Migration-local-123!'}).status_code == 200
    h = {**csrf, 'X-CSRF-Token':client.get('/api/v1/auth/csrf').json()['csrf_token']}
    assert client.get('/api/v1/admin/schema').status_code == 403
    for resource in RESOURCES:
        url = '/api/v1/admin/' + resource
        assert client.get(url).status_code == 403
        assert client.get(url + '/' + 'f'*24).status_code == 403
        assert client.post(url, headers=h, json={}).status_code == 403
        assert client.patch(url + '/' + 'f'*24, headers=h, json={}).status_code == 403
        assert client.delete(url + '/' + 'f'*24, headers=h).status_code == 403


@pytest.mark.parametrize('value', [10**400, -(10**400)], ids=['huge-positive', 'huge-negative'])
def test_extreme_integer_is_rejected_without_float_overflow(value):
    from fastapi import HTTPException
    from metamuseum.models import LLMConfig
    from metamuseum.services.gallery import validate_geometry
    document = LLMConfig(max_tokens=value)
    with pytest.raises(HTTPException) as error:
        validate_geometry(document)
    assert error.value.status_code == 422
    assert error.value.detail == 'finite_bounded_number_required'
