import pytest
import socketio

from fixtures.realtime import live_realtime, peer, wait_event


@pytest.mark.asyncio
async def test_forged_identity_and_cross_room_voice_rejected(live_realtime):
    server = live_realtime
    a, ae = await peer(server)
    b, be = await peer(server)
    c, ce = await peer(server)
    room, other = server.rooms
    for client, target in [(a, room), (b, room), (c, other)]:
        await client.call('join_position_room', {'room_id': target})
    for event in ['voice.offer', 'voice.answer', 'voice.ice']:
        payload = {'room_id': room, 'target': be.visitor['visitorId'], 'from': 'forged', 'sdp': 'description', 'type': event.split('.')[1], 'candidate': {'candidate': 'test'}}
        await a.call(event, payload)
        received = await wait_event(be, event)
        assert received['from'] == ae.visitor['visitorId']
        await c.call(event, payload)
        await a.call(event, {**payload, 'target': ce.visitor['visitorId']})
    for event in ['voice.join', 'voice.leave', 'voice.mute', 'voice.transcript']:
        await a.call(event, {'room_id': room, 'userId': 'forged', 'muted': True, 'text': 'hello'})
        assert (await wait_event(be, event))['userId'] == ae.visitor['visitorId']
    await a.call('voice.admin_toggle', {'room_id': room, 'enabled': True})
    await a.call('voice.get_state', {'room_id': room})
    assert await wait_event(ae, 'voice_admin_toggle') == {'room_id': room, 'enabled': False}
    assert not any(event.startswith('voice.') for event, _ in ce.history)


@pytest.mark.asyncio
async def test_admin_socket_origin_csrf_and_live_revocation(live_realtime, database):
    server = live_realtime
    csrf = (await server.http.get('/api/v1/auth/csrf')).json()['csrf_token']
    signin = await server.http.post('/api/v1/auth/signin', json={'email': 'admin@migration.invalid', 'password': 'Migration-local-123!'}, headers={'Origin': 'http://testserver', 'X-CSRF-Token': csrf})
    assert signin.status_code == 200, signin.text
    csrf = (await server.http.get('/api/v1/auth/csrf')).json()['csrf_token']
    visitor = (await server.http.post('/api/v1/visitor-capability')).json()
    headers = {'Cookie': '; '.join(f'{k}={v}' for k, v in server.http.cookies.items()), 'Origin': 'http://testserver'}
    from metamuseum.auth import decode_session_cookie
    session = decode_session_cookie(server.http.cookies['metamuseum_session'], settings=server.app.state.settings)
    assert session.get('csrf_token') == csrf
    assert session.get('user_id') == 'admin@migration.invalid'
    for bad in [{**headers, 'Origin': 'http://evil.invalid'}, {k: v for k, v in headers.items() if k != 'Origin'}]:
        with pytest.raises(socketio.exceptions.ConnectionError):
            await peer(server, visitor=visitor, auth={'visitorCapability': visitor['capability'], 'csrfToken': csrf}, headers=bad)
    with pytest.raises(socketio.exceptions.ConnectionError):
        await peer(server, auth={'visitorCapability': visitor['capability'], 'csrfToken': 'wrong'}, headers=headers)
    admin, events = await peer(server, auth={'visitorCapability': visitor['capability'], 'csrfToken': csrf}, headers=headers)
    room = server.rooms[0]
    await admin.call('join_position_room', {'room_id': room})
    await admin.call('voice.admin_toggle', {'room_id': room, 'enabled': True})
    assert await wait_event(events, 'voice_admin_toggle') == {'enabled': True, 'room_id': room}
    database.users.update_one({'email': 'admin@migration.invalid'}, {'$set': {'user_type': []}})
    await admin.call('voice.admin_toggle', {'room_id': room, 'enabled': False})
    await admin.call('voice.get_state', {'room_id': room})
    assert (await wait_event(events, 'voice_admin_toggle'))['enabled'] is True
