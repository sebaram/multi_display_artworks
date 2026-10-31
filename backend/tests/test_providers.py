import importlib.util
import json
import threading
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi import HTTPException

from fixtures.provider_server import provider_server, smtp_server, stalled_transport_server


def test_integrations_routes_are_registered(settings):
    from metamuseum.asgi import create_app
    paths = set(create_app(settings).openapi()['paths'])
    assert {'/api/auto-layout', '/api/apply-layout', '/api/auto-effect', '/api/clear-effects',
            '/api/whisper-config', '/api/transcribe', '/stream/push/{stream_id}',
            '/api/v1/rooms/{room_id}/effects'} <= paths


def provider_service():
    assert importlib.util.find_spec('metamuseum.services.providers'), 'provider service missing'
    from metamuseum.services import providers
    return providers


@pytest.mark.parametrize('provider', ['minimax', 'openai', 'openrouter', 'anthropic'])
def test_provider_uses_correct_wire(provider):
    service = provider_service()
    expected = {'arrangements': [], 'explanation': 'fixture'}
    with provider_server(expected) as (url, requests):
        config = SimpleNamespace(provider=provider, api_base=url, api_key='fixture-only-key',
                                 model='fixture-model', temperature=.3, max_tokens=64)
        assert service.call_llm(config, 'system', 'user', timeout=1) == expected
    sent = requests[0]
    body = json.loads(sent['body'])
    if provider == 'anthropic':
        assert sent['path'] == '/v1/messages'
        assert sent['headers']['X-Api-Key'] == 'fixture-only-key'
        assert body['system'] == 'system'
        assert 'Authorization' not in sent['headers']
    else:
        assert sent['path'] == '/v1/chat/completions'
        assert sent['headers']['Authorization'] == 'Bearer fixture-only-key'
        assert body['messages'][0] == {'role': 'system', 'content': 'system'}


@pytest.mark.parametrize('mode,status', [('invalid', 502), ('error', 502), ('timeout', 504), ('trickle', 504), ('disconnect', 502)])
def test_provider_failures_are_bounded_and_redacted(mode, status):
    service = provider_service()
    with provider_server(mode=mode) as (url, _):
        config = SimpleNamespace(provider='openai', api_base=url, api_key='fixture-secret',
                                 model='fixture', temperature=.3, max_tokens=64)
        with pytest.raises(HTTPException) as error:
            service.call_llm(config, 'system', 'user', timeout=.05 if mode in {'timeout','trickle'} else 1)
    assert error.value.status_code == status
    assert 'secret' not in str(error.value.detail)


@pytest.mark.parametrize('mode', ['header_trickle', 'trickle'])
def test_provider_absolute_deadline_closes_transport_and_worker(mode):
    service = provider_service()
    with provider_server({'arrangements': []}, mode=mode) as (url, requests):
        started = time.monotonic()
        with pytest.raises(HTTPException) as error:
            service.request_json(url, b'{}', {'Content-Type':'application/json'}, timeout=.1)
        elapsed = time.monotonic()-started
        assert error.value.status_code == 504
        assert elapsed < .4, f'{mode} held the worker for {elapsed:.3f}s'
        assert requests[0]['peer_closed'].wait(.5), 'upstream transport was left open'
        assert not any(t.name == 'provider-deadline' and t.is_alive() for t in threading.enumerate())


@pytest.mark.parametrize('phase', ['tls', 'upload'])
def test_provider_deadline_aborts_stalled_handshake_and_upload(phase):
    service = provider_service()
    with stalled_transport_server(phase) as (url, peer_closed):
        started = time.monotonic()
        with pytest.raises(HTTPException) as error:
            service.request_json(url, b'x'*(16*1024*1024) if phase == 'upload' else b'{}', {}, timeout=.1)
        elapsed = time.monotonic()-started
        assert error.value.status_code == 504
        assert elapsed < .4
        assert peer_closed.wait(.75), 'deadline did not close the stalled transport'
        assert not any(t.name == 'provider-deadline' and t.is_alive() for t in threading.enumerate())


def test_provider_https_preserves_certificate_verification(monkeypatch):
    service = provider_service()
    expected = {'arrangements': [], 'explanation': 'trusted localhost TLS fixture'}
    with provider_server(expected, tls=True) as (url, requests):
        config = SimpleNamespace(provider='openai', api_base=url, api_key='fixture-only',
                                 model='fixture', temperature=.3, max_tokens=64)
        monkeypatch.delenv('SSL_CERT_FILE', raising=False)
        with pytest.raises(HTTPException) as error:
            service.call_llm(config, 'system', 'user', timeout=1)
        assert error.value.status_code == 502 and not requests
        monkeypatch.setenv('SSL_CERT_FILE', str(Path(__file__).parent/'fixtures/localhost.cert.pem'))
        assert service.call_llm(config, 'system', 'user', timeout=1) == expected
        assert len(requests) == 1


@pytest.mark.parametrize('filename,mime', [('audio.webm','audio/webm'), ('audio.m4a','audio/mp4')])
def test_local_stt_multipart_preserves_binary(filename, mime):
    service = provider_service()
    audio = b'\x1aE\xdf\xa3\x00\xfflocal-audio'
    with provider_server() as (url, requests):
        config = SimpleNamespace(provider='local', api_base=url, api_key='', model='tiny', language='ko')
        assert service.transcribe(config, audio, filename, mime, timeout=1) == 'local transcription'
    assert requests[0]['path'] == '/v1/audio/transcriptions'
    assert audio in requests[0]['body']
    assert b'name="model"' in requests[0]['body']
    assert f'filename="{filename}"'.encode() in requests[0]['body']
    assert 'Authorization' not in requests[0]['headers']


def test_minimax_reasoning_content_precedes_json():
    service = provider_service()
    result = {'arrangements': [], 'explanation': 'fixture'}
    with provider_server(model_text='<think>private reasoning</think>\n'+json.dumps(result)) as (url, _):
        config = SimpleNamespace(provider='minimax', api_base=url, api_key='fixture-only',
                                 model='MiniMax-M2.5', temperature=.3, max_tokens=64)
        assert service.call_llm(config, 'system', 'user', timeout=1) == result


def test_local_stt_config_accepts_no_key_but_remote_requires_key():
    from metamuseum.models import WhisperConfig
    from mongoengine import ValidationError
    WhisperConfig(provider='local', api_base='http://127.0.0.1/v1', api_key='', enabled=True).validate()
    for provider in ['openai', 'minimax']:
        with pytest.raises(ValidationError):
            WhisperConfig(provider=provider, api_base='http://127.0.0.1/v1', api_key='').validate()


def test_mail_uses_only_local_smtp_fixture(settings):
    service = provider_service()
    assert hasattr(service, 'send_mail'), 'SMTP adapter missing'
    with smtp_server() as (port, deliveries):
        settings.mail_server = '127.0.0.1'
        settings.mail_port = port
        settings.mail_default_sender = 'fixture@migration.invalid'
        assert service.send_mail(settings, ['admin@migration.invalid'], 'fixture title', 'fixture body')
    assert len(deliveries) == 1
    assert b'[CT-AR]fixture title' in deliveries[0]
    assert b'fixture body' in deliveries[0]


def test_body_limits_apply_before_auth_and_public_stt(settings):
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app
    settings.integration_max_bytes = 128
    client = TestClient(create_app(settings))
    try:
        assert client.post('/api/transcribe', content=b'x'*129).status_code == 413
        assert client.post('/stream/push/phone-wall', content=b'x'*129).status_code == 413
        assert client.post('/api/auto-layout', content=b'x'*65537).status_code == 413
        assert client.post('/api/auto-layout', json={'room_id': 'f'*24, 'prompt': 'x'}).status_code == 403
    finally:
        client.close()


def admin(client, csrf):
    response = client.post('/api/v1/auth/signin', headers=csrf,
                           json={'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'})
    assert response.status_code == 200, response.text
    return {'X-CSRF-Token': client.get('/api/v1/auth/csrf').json()['csrf_token'], 'Origin': 'http://testserver'}


def test_layout_move_updates_both_relationships(client, csrf):
    from metamuseum import models as m
    from metamuseum.services import gallery
    headers = admin(client, csrf)
    wall = m.Wall.objects.first()
    target = gallery.save('walls', dict(name='layout-target', description='target', room=str(wall.room.pk),
                                      position='0 0 0', rotation='0 0 0', width=10, height=10, depth=.1))
    image = m.Image.objects(wall=wall).first()
    body = {'room_id': str(wall.room.pk), 'arrangements': [dict(element_id=str(image.pk),
            wall_name=target.name, position_x=1.0, position_y=1.0, position_z=0.0)]}
    result = client.post('/api/apply-layout', json=body, headers=headers)
    assert result.status_code == 200, result.text
    image.reload(); wall.reload(); target.reload()
    assert image.wall.pk == target.pk
    assert image.pk not in [item.pk for item in wall.images]
    assert image.pk in [item.pk for item in target.images]
    assert image.position == '1.0 1.0 0.0'


def test_layout_context_uses_visible_membership_with_missing_reverse_link(client, database):
    from bson import ObjectId
    from metamuseum import models as m
    from metamuseum.services import providers
    model = m.GLTFmodel.objects.first()
    wall = model.wall
    room = wall.room
    database.g_l_t_fmodel.update_one({'_id': model.pk}, {'$unset': {'wall': ''}})
    hidden = database.image.find_one()
    hidden.update(_id=ObjectId(), name='not-displayed-by-parent', wall=wall.pk)
    database.image.insert_one(hidden)
    _, _, visible = providers.context(str(room.pk))
    assert model.pk in [item.pk for item in visible]
    assert hidden['_id'] not in [item.pk for item in visible]
    prompt = json.loads(providers.prompt_context(str(room.pk), 'Arrange visible artworks'))
    assert next(item for item in prompt['elements'] if item['id'] == str(model.pk))['wall_name'] == wall.name
    providers.validate_layout({'arrangements': [dict(element_id=str(model.pk), wall_name=wall.name,
                               position_x=0, position_y=0, position_z=0)]}, str(room.pk))


def test_effects_are_arrays_and_expire(client, csrf):
    from metamuseum import models as m
    room = m.Room.objects.first()
    m.RoomEffect.objects.delete()
    live = m.RoomEffect(room=room, effect_type='ambient', params={'intensity': .5}, active=True).save()
    m.RoomEffect(room=room, effect_type='fog', expires_at=datetime.utcnow()-timedelta(seconds=1), active=True).save()
    result = client.get(f'/api/v1/rooms/{room.pk}/effects')
    assert result.status_code == 200
    assert isinstance(result.json(), list)
    assert [item['id'] for item in result.json()] == [str(live.pk)]
    assert 'expires_at' in result.json()[0]


def test_stt_status_is_public_but_secret_config_is_admin(client, csrf):
    from metamuseum import models as m
    m.WhisperConfig.objects.delete()
    m.WhisperConfig(provider='local', api_base='http://127.0.0.1:8766/v1', api_key='fixture-secret', enabled=True).save()
    assert client.get('/api/whisper-config').json() == {'enabled': True}
    assert client.put('/api/whisper-config', json={'enabled': False}, headers=csrf).status_code == 403
    headers = admin(client, csrf)
    result = client.get('/api/whisper-config').json()
    assert result['has_api_key'] and 'fixture-secret' not in json.dumps(result)
    assert client.put('/api/whisper-config', json={'enabled': False}, headers=headers).status_code == 200
    assert m.WhisperConfig.objects.first().api_key == 'fixture-secret'


def test_upstream_failure_retains_draft(client, csrf):
    from metamuseum import models as m
    headers = admin(client, csrf)
    room = m.Room.objects.first()
    before = list(m.Image.objects.as_pymongo())
    with provider_server(mode='invalid') as (url, _):
        m.LLMConfig.objects.delete()
        m.LLMConfig(provider='openai', api_base=url, api_key='fixture-only', model='fixture').save()
        result = client.post('/api/auto-layout', json={'room_id': str(room.pk), 'prompt': 'fixture'}, headers=headers)
    assert result.status_code == 502
    assert list(m.Image.objects.as_pymongo()) == before


def test_preview_validates_all_artwork_types_and_rejects_entire_bad_apply(client, csrf):
    from metamuseum import models as m
    from metamuseum.services import providers
    headers = admin(client, csrf)
    room = m.Room.objects(name='migration-gallery').first() or m.Room.objects.first()
    _, walls, elements = providers.context(str(room.pk))
    assert {e.wall_element_type for e in elements} == {'image', 'gaussian_splat', 'gltf', 'webpage'}
    proposal = {'arrangements':[dict(element_id=str(e.pk), wall_name=walls[0].name,
                    position_x=0, position_y=0, position_z=0) for e in elements], 'explanation':'fixture'}
    with provider_server(proposal) as (url, _):
        m.LLMConfig.objects.delete()
        m.LLMConfig(provider='openai', api_base=url, api_key='fixture-only', model='fixture').save()
        response = client.post('/api/auto-layout', json={'room_id':str(room.pk), 'prompt':'all types'}, headers=headers)
    assert response.status_code == 200, response.text
    assert len(response.json()['arrangements']) == len(elements)
    before = [e.to_mongo().to_dict() for e in elements]
    invalid = proposal['arrangements'] + [dict(element_id='f'*24, wall_name=walls[0].name, position_x=0, position_y=0)]
    response = client.post('/api/apply-layout', json={'room_id':str(room.pk),'arrangements':invalid}, headers=headers)
    assert response.status_code == 422
    assert [e.reload().to_mongo().to_dict() for e in elements] == before
    response = client.post('/api/apply-layout', json={'room_id':str(room.pk),'arrangements':proposal['arrangements']}, headers=headers)
    assert response.status_code == 200, response.text
    for e in elements:
        e.reload()
        assert e.wall.pk == walls[0].pk
        target = walls[0].reload()
        assert e.pk in [child.pk for child in getattr(target, providers.gallery.ELEMENTS[e.wall_element_type])]


def test_effects_provider_success_clear_and_invalid_are_consistent(client, csrf):
    from metamuseum import models as m
    headers = admin(client, csrf)
    room = m.Room.objects.first()
    body = {'room_id': str(room.pk), 'prompt':'warm light'}
    proposal = {'effects':[{'effect_type':'ambient','target_id':'','params':{'intensity':.5, 'duration':2}}], 'explanation':'fixture'}
    with provider_server(proposal) as (url, _):
        m.LLMConfig.objects.delete()
        m.LLMConfig(provider='openai', api_base=url, api_key='fixture-only', model='fixture').save()
        response = client.post('/api/auto-effect', json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert isinstance(response.json()['effects'], list)
    assert any(item['expires_at'] for item in response.json()['effects'])
    assert client.post('/api/clear-effects', json={'room_id':str(room.pk)}, headers=headers).status_code == 200
    assert client.get(f'/api/v1/rooms/{room.pk}/effects').json() == []
    count = m.RoomEffect.objects.count()
    for invalid_effect in [{'effect_type':'fog', 'target_id':[], 'params':{}},
                           {'effect_type':'fade', 'params':{'duration':0}}]:
        with provider_server({'effects':[invalid_effect]}) as (url, _):
            m.LLMConfig.objects.first().update(set__api_base=url)
            response = client.post('/api/auto-effect', json=body, headers=headers)
        assert response.status_code == 502
        assert m.RoomEffect.objects.count() == count


def test_transcribe_uses_keyless_local_config_without_exposing_config(client, csrf):
    from metamuseum import models as m
    headers = admin(client, csrf)
    with provider_server() as (url, requests):
        m.WhisperConfig.objects.delete()
        response = client.put('/api/whisper-config', headers=headers,
                              json={'provider':'local','api_base':url,'model':'tiny','enabled':True})
        assert response.status_code == 200, response.text
        assert not client.get('/api/whisper-config').json()['has_api_key']
        audio = b'\x1aE\xdf\xa3local-fixture-audio'
        response = client.post('/api/transcribe', files={'audio':('capture.webm', audio, 'audio/webm')})
    assert response.status_code == 200, response.text
    assert response.json() == {'text':'local transcription','language':'auto'}
    assert requests[0]['path'] == '/v1/audio/transcriptions' and audio in requests[0]['body']
    assert 'Authorization' not in requests[0]['headers']
