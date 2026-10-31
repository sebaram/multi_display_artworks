import asyncio
import json

import pytest

from fixtures.realtime import live_realtime, peer, wait_event
from test_presence_contract import controlled_realtime, PausedLookup


@pytest.mark.asyncio
@pytest.mark.parametrize('later', ['leave', 'vision_pro'])
async def test_completed_ar_leave_or_role_change_invalidates_older_join(controlled_realtime, later):
    from metamuseum.realtime.ar import ar_room
    realtime = controlled_realtime
    sid = await realtime.sio.manager.connect('transport', '/')
    lookup = PausedLookup()
    realtime.room_exists = lookup
    join = asyncio.create_task(realtime.sio.handlers['/']['join_ar_room'](sid, {'room_id': 'room', 'device': 'phone'}))
    await lookup.started.wait()
    if later == 'leave':
        await realtime.sio.handlers['/']['leave_ar_room'](sid, {'room_id': 'room'})
    else:
        async def exists(room):
            return True
        realtime.room_exists = exists
        await realtime.sio.handlers['/']['join_ar_room'](sid, {'room_id': 'room', 'device': 'vision_pro'})
    lookup.release.set()
    await join
    room = realtime.ar.rooms.get('room', {})
    assert sid not in room.get('phones', set())
    if later == 'leave':
        assert sid not in room.get('vision_pros', set())
        assert ar_room('room') not in realtime.sio.rooms(sid)
    else:
        assert sid in room['vision_pros']


@pytest.mark.asyncio
async def test_ar_gesture_handshake_cannot_publish_presence(live_realtime):
    server = live_realtime
    phone, pe = await peer(server, auth={})
    display, de = await peer(server, auth={}, transport='polling')
    room = server.rooms[0]
    for invalid in ['invalid', 'f' * 24, [], None]:
        await phone.call('join_ar_room', {'room_id': invalid})
    assert not server.app.state.realtime.ar.rooms
    for client in [phone, display]:
        await client.call('join_position_room', {'room_id': room, 'userId': 'forged'})
        await client.call('gesture_mark.join', {})
    assert server.app.state.realtime.get_room_visitor(phone.get_sid(), room) is None
    await phone.call('join_ar_room', {'room_id': room, 'device': 'phone'})
    await display.call('join_ar_room', {'room_id': room, 'device': 'vision_pro'})
    await phone.call('set_marker_config', {'room_id': room, 'markers': [{'id': 'marker', 'name': 'Test marker', 'target_position': '1 2 3'}]})
    await phone.call('marker_update', {'room_id': room, 'update_type': 'found', 'marker_id': 'marker', 'pose': {'matrix': [1]}})
    pose = await wait_event(de, 'pose_update')
    assert pose['found'] and pose['target_position'] == '1 2 3'
    late, le = await peer(server, auth={})
    await late.call('join_ar_room', {'room_id': room, 'device': 'vision_pro'})
    assert await wait_event(le, 'pose_update') == pose
    await display.call('marker_update', {'room_id': room, 'update_type': 'lost', 'marker_id': 'marker'})
    await display.call('request_sync', {'room_id': room})
    assert (await wait_event(de, 'sync_state'))['latest_pose'] == pose
    outsider, oe = await peer(server, auth={})
    await outsider.call('join_ar_room', {'room_id': server.rooms[1]})
    await outsider.call('marker_update', {'room_id': room, 'update_type': 'lost', 'marker_id': 'marker'})
    await outsider.call('request_sync', {'room_id': room})
    assert not any(name in ('pose_update', 'sync_state') for name, _ in oe.history)
    await phone.call('gesture_mark.touchpoint', {'x': .4, 'y': .6, 'type': 'start'})
    point = await wait_event(de, 'gesture_mark.touchpoint')
    assert point['x'] == .4 and point['pressure'] == .5
    await phone.call('gesture_mark.gesture', {'result_str': 'circle'})
    assert (await wait_event(de, 'gesture_mark.gesture'))['result_str'] == 'circle'
    await phone.call('gesture_mark.target_select', {'target_id': 2, 'step': 1})
    assert (await wait_event(de, 'gesture_mark.target_select'))['target_id'] == 2
    state = (await server.http.get('/gesture-mark/api/state')).json()
    assert state['touchpoints'][-1] == point and state['gesture_result'] == 'circle'
    await phone.call('gesture_mark.clear', {})
    assert await wait_event(de, 'gesture_mark.clear') == {}
    assert not server.app.state.realtime.presence.public_rooms()
    await phone.disconnect()
    status = (await server.http.get('/ar-companion/status', params={'room_id': room})).json()
    assert status['phones_count'] == 0 and status['vision_pros_count'] == 2


@pytest.mark.asyncio
async def test_sse_disconnect_releases_subscriber(live_realtime):
    server = live_realtime
    async with server.http.stream('GET', '/gesture-mark/stream') as stream:
        assert stream.status_code == 200
        lines = stream.aiter_lines()
        assert await anext(lines) == ': connected'
        await server.http.post('/gesture-mark/api/touchpoint', json={'x': 3, 'y': 4})
        async with asyncio.timeout(3):
            async for line in lines:
                if line.startswith('data: '):
                    assert json.loads(line[6:])['x'] == 3
                    break
    async with asyncio.timeout(3):
        while server.app.state.realtime.gesture.subscribers:
            await asyncio.sleep(.01)
    response = await server.http.post('/gesture-mark/api/gesture', json={'result_str': 'swipe'})
    assert response.json() == {'status': 'ok', 'gesture': 'swipe'}
    assert (await server.http.get('/gesture-mark/api/state')).json()['gesture_result'] == 'swipe'
