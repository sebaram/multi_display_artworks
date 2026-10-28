import asyncio
import base64
import json
import threading
from pathlib import Path

import pytest

from fixtures.realtime import live_realtime, peer, wait_event


@pytest.fixture
def controlled_realtime(settings):
    from metamuseum.asgi import create_app, create_realtime_app
    app = create_app(settings)
    create_realtime_app(app)
    return app.state.realtime


class PausedLookup:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def __call__(self, *args):
        self.started.set()
        await self.release.wait()
        return True


@pytest.mark.asyncio
async def test_completed_leave_invalidates_suspended_presence_join(controlled_realtime):
    from metamuseum.auth import VisitorIdentity
    from metamuseum.realtime.server import presence_room
    realtime = controlled_realtime
    sid = await realtime.sio.manager.connect('transport', '/')
    realtime.visitors[sid] = VisitorIdentity('visitor')
    lookup = PausedLookup()
    realtime.room_exists = lookup
    join = asyncio.create_task(realtime.sio.handlers['/']['join_position_room'](sid, {'room_id': 'room'}))
    await lookup.started.wait()
    await realtime.sio.handlers['/']['leave_position_room'](sid, {'room_id': 'room'})
    lookup.release.set()
    await join
    assert realtime.get_room_visitor(sid, 'room') is None
    assert presence_room('room') not in realtime.sio.rooms(sid)
    assert not realtime.pending_joins


@pytest.mark.asyncio
async def test_disconnect_during_admin_handshake_cannot_restore_identity(controlled_realtime):
    from itsdangerous import TimestampSigner, URLSafeTimedSerializer
    from metamuseum.auth import CAPABILITY_SALT
    realtime = controlled_realtime
    sid = await realtime.sio.manager.connect('transport', '/')
    session = {'user_id': 'admin@example.invalid', 'csrf_token': 'csrf'}
    cookie = TimestampSigner(realtime.settings.secret_key).sign(base64.b64encode(json.dumps(session).encode())).decode()
    capability = URLSafeTimedSerializer(realtime.settings.secret_key, salt=CAPABILITY_SALT).dumps({'visitorId': 'visitor'})
    lookup = PausedLookup()
    # Only the external DB decision is controlled; real auth/cookie/manager code runs.
    realtime.session_is_admin = lookup
    connect = asyncio.create_task(realtime.sio.handlers['/']['connect'](sid,
        {'HTTP_ORIGIN': 'http://testserver', 'HTTP_COOKIE': f'{realtime.settings.session_cookie}={cookie}'},
        {'visitorCapability': capability, 'csrfToken': 'csrf'}))
    await lookup.started.wait()
    await realtime.sio.handlers['/']['disconnect'](sid)
    await realtime.sio.manager.disconnect(sid, '/')
    lookup.release.set()
    await connect
    assert sid not in realtime.visitors
    assert sid not in realtime.admin_sessions


@pytest.mark.asyncio
async def test_shutdown_cancels_suspended_owned_handler_before_database_close(controlled_realtime):
    from metamuseum.auth import VisitorIdentity
    realtime = controlled_realtime
    sid = await realtime.sio.manager.connect('transport', '/')
    realtime.visitors[sid] = VisitorIdentity('visitor')
    lookup = PausedLookup()
    realtime.room_exists = lookup
    join = asyncio.create_task(realtime.sio.handlers['/']['join_position_room'](sid, {'room_id': 'room'}))
    await lookup.started.wait()
    try:
        assert callable(getattr(realtime, 'shutdown', None)), 'Owned handler shutdown is missing'
        await realtime.shutdown(drain_timeout=.01, cancel_timeout=.1)
        assert join.done() and join.cancelled()
        assert not realtime.handler_tasks
        assert not realtime.visitors and not realtime.admin_sessions
        assert not realtime.presence.public_rooms()
        await realtime.sio.handlers['/']['join_position_room'](sid, {'room_id': 'room'})
        assert not realtime.handler_tasks and not realtime.presence.public_rooms()
    finally:
        if not join.done():
            join.cancel()
        await asyncio.gather(join, return_exceptions=True)


@pytest.mark.asyncio
async def test_shutdown_keeps_database_open_while_cancelled_threadpool_work_runs(controlled_realtime):
    from metamuseum.auth import VisitorIdentity
    realtime = controlled_realtime
    sid = await realtime.sio.manager.connect('transport', '/')
    realtime.visitors[sid] = VisitorIdentity('visitor')
    started, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()

    def database_lookup():
        loop.call_soon_threadsafe(started.set)
        release.wait(3)
        return True

    async def room_exists(room):
        assert callable(getattr(realtime, 'database_call', None)), 'Tracked database offload is missing'
        return await realtime.database_call(database_lookup)

    realtime.room_exists = room_exists
    join = asyncio.create_task(realtime.sio.handlers['/']['join_position_room'](sid, {'room_id': 'room'}))
    try:
        # A missing interface must fail without leaving this test waiting on its gate.
        await asyncio.wait_for(asyncio.shield(join), .05)
    except TimeoutError:
        pass
    try:
        await asyncio.wait_for(started.wait(), .5)
        with pytest.raises(RuntimeError, match='before database shutdown'):
            await realtime.shutdown(drain_timeout=.01, cancel_timeout=.01)
        assert join.done() and join.cancelled()
        assert realtime.database_tasks
    finally:
        release.set()
        await asyncio.gather(join, return_exceptions=True)
        if hasattr(realtime, 'database_tasks'):
            await asyncio.gather(*realtime.database_tasks, return_exceptions=True)


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
