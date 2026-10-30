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
    assert set(http.state.sio.handlers['/']) == {item['event'] for item in contract['registered_handlers']} | set(contract['new_wall_runtime']['client_events']) | {'avatar_pose'}
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
    assert profile == {'room_id': room, 'userId': a.visitor['visitorId'], 'displayName': 'Visitor', 'avatarId': 'shiba', 'color': '#4CAF50', 'appearance': None}
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
async def test_legacy_profile_update_explicitly_clears_humanoid_for_current_and_late_peers(live_realtime):
    from metamuseum.avatar_catalog import avatar_catalog
    server = live_realtime
    owner, a = await peer(server)
    observer, b = await peer(server)
    room = server.rooms[0]
    look = avatar_catalog()['presets'][0]['defaultAppearance']
    await owner.call('join_position_room', {'room_id': room, 'profile': {'displayName': 'Owner', 'appearance': look}})
    await observer.call('join_position_room', {'room_id': room})
    assert (await wait_event(b, 'room_state'))['users'][0]['appearance'] == look
    await owner.call('profile_update', {'room_id': room, 'profile': {'displayName': 'Owner', 'avatarId': 'robot', 'color': '#123456'}})
    update = await wait_event(b, 'profile_updated')
    assert update['appearance'] is None and update['avatarId'] == 'robot'
    late, c = await peer(server)
    await late.call('join_position_room', {'room_id': room})
    entry = next(user for user in (await wait_event(c, 'room_state'))['users'] if user['userId'] == a.visitor['visitorId'])
    assert entry.get('appearance') is None and entry['avatarId'] == 'robot'


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


def avatar_packet(sequence=0, x=0):
    import struct
    return dict(version=2, rigVersion='humanoid-v1', sequence=sequence, sampleTime=sequence * 50,
                bodyScale=1, tracking=dict(head=True, left=False, right=False), teleport=False,
                floats=struct.pack('<98f', x, 0, 0, 0, 0, 0, 1, 0, 0, 0, *([0, 0, 0, 1] * 22)))


def test_avatar_pose_validation_and_bounded_latest_state():
    import struct
    from metamuseum.schemas_avatar import validate_avatar_pose
    from metamuseum.realtime.presence import PresenceService
    from metamuseum.avatar_catalog import avatar_catalog
    packet = avatar_packet()
    assert validate_avatar_pose(packet)['floats'] == packet['floats']
    for invalid in [dict(packet, rigVersion='bad'), dict(packet, floats=b'0'), dict(packet, bodyScale=3),
                    dict(packet, tracking={'head': 1}), dict(packet, sequence=True), dict(packet, sampleTime=float('nan')),
                    dict(packet, floats=struct.pack('<98f', *([0]*98))), dict(packet, extra='x'*4096),
                    dict(packet, sampleTime=10**1000), dict(packet, bodyScale=10**1000)]:
        assert validate_avatar_pose(invalid) is None
    presence = PresenceService()
    look = avatar_catalog()['presets'][0]['defaultAppearance']
    presence.join('r', 's', 'u', {'appearance': look}, '0 1.6 0', '0 0 0')
    generation = presence.generation('r', 's')
    assert presence.update_avatar_pose('r', 's', generation, packet, now=10)
    assert not presence.update_avatar_pose('r', 's', generation, packet, now=10)
    accepted = [presence.update_avatar_pose('r', 's', generation, avatar_packet(n+1), now=10) for n in range(20)]
    assert sum(bool(x) for x in accepted) == 4  # burst capacity five including first
    assert presence.update_avatar_pose('r', 's', generation, avatar_packet(30), now=11)
    assert all(presence.update_avatar_pose('r','s',generation,avatar_packet(31+n),now=11+(n+1)*.051) for n in range(20))
    assert not presence.update_avatar_pose('r', 's', 'stale', avatar_packet(31), now=11)
    assert presence.public_room_state('r')[0]['avatarPose']['pose']['sequence'] == 50
    presence.update_profile('r', 's', {'avatarId': 'robot'})
    assert 'avatarPose' not in presence.public_room_state('r')[0]
    assert not presence.update_avatar_pose('r','s',generation,avatar_packet(31),now=12)
    presence.join('r','replacement','u',{'appearance':look},'0 1.6 0','0 0 0')
    assert presence.generation('r','replacement') != generation
    assert not presence.update_avatar_pose('r','s',generation,avatar_packet(31),now=13)
    presence.leave_all('replacement'); assert not presence.public_rooms()


def test_avatar_rate_budget_is_per_socket_across_rooms_and_repeated_join():
    from metamuseum.realtime.presence import PresenceService
    from metamuseum.avatar_catalog import avatar_catalog
    presence=PresenceService(); look=avatar_catalog()['presets'][0]['defaultAppearance']; accepted=[]
    for n in range(6):
        room=str(n);presence.join(room,'same-socket','visitor',{'appearance':look},'0 1.6 0','0 0 0')
        accepted.append(presence.update_avatar_pose(room,'same-socket',presence.generation(room,'same-socket'),avatar_packet(),now=10))
    assert sum(bool(item) for item in accepted) == 5
    presence.join('0','same-socket','visitor',{'appearance':look},'0 1.6 0','0 0 0')
    assert not presence.update_avatar_pose('0','same-socket',presence.generation('0','same-socket'),avatar_packet(),now=10)
    presence.leave_all('same-socket'); assert not presence.rates


@pytest.mark.asyncio
async def test_binary_avatar_concurrent_producers_snapshot_latejoin_and_reconnect(live_realtime):
    """Delay real binary attachments to expose interleaving of concurrent emits."""
    import struct
    from metamuseum.avatar_catalog import avatar_catalog
    server = live_realtime
    realtime = server.app.state.realtime
    send = realtime.sio.eio.send
    async def delayed_attachment(sid, packet):
        if isinstance(packet, bytes):
            await asyncio.sleep(.01)
        await send(sid, packet)
    realtime.sio.eio.send = delayed_attachment
    room = server.rooms[0]
    look = avatar_catalog()['presets'][0]['defaultAppearance']
    one,a = await peer(server); two,b = await peer(server); observer,c = await peer(server)
    generations=[]
    for client,events in [(one,a),(two,b),(observer,c)]:
        await client.call('join_position_room', {'room_id':room,'profile':{'appearance':look}})
        generations.append((await wait_event(events,'room_state'))['generation'])
    async def publish(client,generation,x,sequence):
        await client.call('avatar_pose',dict(room_id=room,generation=generation,pose=avatar_packet(sequence,x)))
    await asyncio.gather(publish(one,generations[0],1,0),publish(two,generations[1],2,0),observer.call('request_room_state',{'room_id':room}))
    # Each observer receives complete, unmixed typed attachments from both owners.
    updates=[await wait_event(c,'avatar_pose'),await wait_event(c,'avatar_pose')]
    assert {struct.unpack('<98f',event['pose']['floats'])[0] for event in updates} == {1,2}
    assert {event['userId'] for event in updates} == {a.visitor['visitorId'],b.visitor['visitorId']}
    late,d = await peer(server); await late.call('join_position_room',{'room_id':room})
    state=await wait_event(d,'room_state')
    poses=[user['avatarPose'] for user in state['users'] if 'avatarPose' in user]
    assert {struct.unpack('<98f',p['pose']['floats'])[0] for p in poses} == {1,2}
    replacement,re = await peer(server,visitor=a.visitor)
    await replacement.call('join_position_room',{'room_id':room,'profile':{'appearance':look}})
    new=(await wait_event(re,'room_state'))['generation']; assert new != generations[0]
    await publish(one,generations[0],99,1)
    await publish(replacement,new,3,0)
    state=realtime.presence.public_room_state(room)
    own=next(u for u in state if u['userId']==a.visitor['visitorId'])
    assert struct.unpack('<98f',own['avatarPose']['pose']['floats'])[0] == 3


@pytest.mark.asyncio
async def test_binary_broadcast_encodes_once_and_retains_each_recipient_packet_batch(controlled_realtime):
    realtime = controlled_realtime
    from metamuseum.realtime.server import presence_room
    first = await realtime.sio.manager.connect('one', '/')
    second = await realtime.sio.manager.connect('two', '/')
    await realtime.sio.enter_room(first,presence_room('r')); await realtime.sio.enter_room(second,presence_room('r'))
    sent = []
    async def capture(sid, data):
        sent.append((sid,data)); await asyncio.sleep(0)
    realtime.sio.eio.send = capture
    original = realtime.sio.packet_class
    encoded = 0
    class CountPacket(original):
        def encode(self):
            nonlocal encoded
            encoded += 1
            return super().encode()
    realtime.sio.packet_class = CountPacket
    await realtime.broadcast('avatar_pose', {'pose':avatar_packet()},room_id='r')
    assert encoded == 1
    assert len(sent) == 4
    for recipient in ['one','two']:
        frames=[data for sid,data in sent if sid==recipient]
        assert isinstance(frames[0],str) and frames[1] == avatar_packet()['floats']
