import json
from pathlib import Path

import pytest

from fixtures.realtime import live_realtime, peer, wait_event


def test_combined_runtime_factory_exists(settings):
    import metamuseum.asgi as runtime
    assert callable(getattr(runtime, 'create_realtime_app', None)), 'ASGI Socket.IO factory is missing'


def test_all_legacy_events_and_public_state_routes_are_registered(settings):
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app, create_realtime_app
    http = create_app(settings)
    combined = create_realtime_app(http)
    contract = json.loads((Path(__file__).parents[2] / 'contracts/socket-events.json').read_text())
    assert set(http.state.sio.handlers['/']) == {item['event'] for item in contract['registered_handlers']}
    # These device-only routes must work without database access.
    client = TestClient(combined)
    assert client.get('/gesture-mark/api/state').json() == {'touchpoints': [], 'gesture_result': ''}
    assert client.get('/ar-companion/status?room_id=example').json() == {
        'room_id': 'example', 'phones_count': 0, 'vision_pros_count': 0, 'has_pose': False}
    for body in [None, [], 'invalid', {}]:
        assert client.post('/gesture-mark/api/touchpoint', json=body).status_code == 400
        assert client.post('/gesture-mark/api/gesture', json=body).status_code == 400


@pytest.mark.asyncio
async def test_two_visitors_reconnect_and_displacement(live_realtime):
    server = live_realtime
    first, a = await peer(server)
    second, b = await peer(server)
    room = server.rooms[0]
    await first.call('join_position_room', {'room_id': room, 'profile': {'displayName': 'First', 'avatarId': 'robot'}})
    await second.call('join_position_room', {'room_id': room})
    state = await wait_event(b, 'room_state')
    assert state['users'][0]['userId'] == a.visitor['visitorId']
    assert state['users'][0]['displayName'] == 'First'
    await first.call('position_update', {'room_id': room, 'position': '1 2 3', 'leftHand': {'position': '0 1 0'}, 'handTracking': True, 'userId': 'forged'})
    update = await wait_event(b, 'position_update')
    assert update['userId'] == a.visitor['visitorId'] and update['leftHand']['position'] == '0 1 0'
    replacement, c = await peer(server, visitor=a.visitor)
    await replacement.call('join_position_room', {'room_id': room})
    assert await wait_event(a, 'voice.displaced') == {'room_id': room}
    await first.call('position_update', {'room_id': room, 'position': '99 99 99'})
    await replacement.call('profile_update', {'room_id': room, 'profile': {'displayName': '<script>', 'avatarId': [], 'color': 'red', 'sid': 'secret'}})
    profile = await wait_event(b, 'profile_updated')
    assert profile == {'room_id': room, 'userId': a.visitor['visitorId'], 'displayName': 'Visitor', 'avatarId': 'shiba', 'color': '#4CAF50'}
    assert len(server.app.state.realtime.presence.public_room_state(room)) == 2
    await first.disconnect()
    await replacement.disconnect()
    assert (await wait_event(b, 'user_left'))['userId'] == a.visitor['visitorId']
    old_sid = second.get_sid()
    await second.disconnect()
    reconnected, re = await peer(server, visitor=b.visitor)
    await reconnected.call('join_position_room', {'room_id': room})
    assert (await wait_event(re, 'room_state'))['users'] == []
    assert server.app.state.realtime.get_room_visitor(old_sid, room) is None
    assert server.app.state.realtime.get_room_visitor(reconnected.get_sid(), room).visitor_id == b.visitor['visitorId']
    serialized = json.dumps(list(b.history))
    assert '"sid"' not in serialized


@pytest.mark.asyncio
async def test_no_guest_mongo_writes(live_realtime, database):
    before = {name: database[name].count_documents({}) for name in database.list_collection_names()}
    client, events = await peer(live_realtime)
    for room in live_realtime.rooms:
        await client.call('join_position_room', {'room_id': room})
        await client.call('leave_position_room', {'room_id': room})
    await client.disconnect()
    assert before == {name: database[name].count_documents({}) for name in database.list_collection_names()}


@pytest.mark.asyncio
async def test_presence_denies_missing_rooms_and_unjoined_reads(live_realtime):
    client, events = await peer(live_realtime)
    for room in ['not-an-objectid', 'f' * 24, [], None]:
        await client.call('join_position_room', {'room_id': room})
    await client.call('request_room_state', {'room_id': live_realtime.rooms[0]})
    assert not live_realtime.app.state.realtime.presence.public_rooms()
    assert not events.history
    for event in ['join_position_room', 'leave_position_room', 'position_update', 'profile_update', 'expression', 'request_room_state']:
        await client.call(event, ['invalid'])


@pytest.mark.asyncio
async def test_tampered_visitor_capability_rejected(live_realtime):
    import socketio
    with pytest.raises(socketio.exceptions.ConnectionError):
        await peer(live_realtime, auth={'visitorCapability': 'forged'})
