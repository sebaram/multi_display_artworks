"""Real Socket.IO dispatch/Engine.IO queues, with only transport progress controlled."""
import asyncio
import json
import time

import pytest
import pytest_asyncio
from engineio.async_socket import AsyncSocket

from metamuseum.auth import VisitorIdentity
from metamuseum.realtime.server import presence_room
from test_presence_contract import avatar_packet, controlled_realtime


@pytest_asyncio.fixture
async def relay(controlled_realtime):
    yield controlled_realtime
    await controlled_realtime.shutdown(drain_timeout=.2, cancel_timeout=.2)


async def member(realtime, name):
    sio = realtime.sio
    transport = AsyncSocket(sio.eio, name)
    sio.eio.sockets[name] = transport
    sid = await sio.manager.connect(name, '/')
    await sio.enter_room(sid, presence_room('room'))
    realtime.visitors[sid] = VisitorIdentity(name)
    realtime.presence.join('room', sid, name, {'avatarId': 'casual'}, '0 1.6 0', '0 0 0')
    return sid, transport


async def publish(realtime, name, sid, sequence, **changes):
    # Rate limits have their own contract tests; isolate accepted relay work here.
    realtime.presence.rates[sid]['tokens'] = 5
    await realtime.sio._handle_event(name, '/', None, ['avatar_pose', {
        'room_id': 'room', 'generation': realtime.presence.generation('room', sid),
        'pose': {**avatar_packet(sequence), **changes},
    }])
    await asyncio.sleep(0)
    await asyncio.sleep(0)


async def until(predicate):
    async with asyncio.timeout(.5):
        while not predicate():
            await asyncio.sleep(0)


def messages(packets):
    return [json.loads(p.data[p.data.index('['):]) for p in packets
            if isinstance(p.data, str) and '[' in p.data]


@pytest.mark.asyncio
@pytest.mark.parametrize('count', [1, 2])
async def test_expired_binary_send_finishes_actual_disconnect_and_cross_peer_voice_leave(relay, count):
    sockets = []
    for i in range(count):
        _, sock = await member(relay, str(i))
        sock.last_ping = time.time() - relay.sio.eio.ping_timeout - 1
        sockets.append(sock)
    # Ordinary binary traffic exercises both self-lock and two-peer Voice.left cycles.
    task = asyncio.create_task(relay.broadcast('binary_probe', {'data': b'body'}, room_id='room'))
    try:
        await asyncio.wait_for(task, .3)
        assert all(sock.closed for sock in sockets)
        assert not relay.presence.public_rooms()
        assert not list(relay.sio.manager.get_participants('/', presence_room('room')))
        assert not relay.sio.manager.pending_disconnect
        assert not relay.sio._packet_locks
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_blocked_recipient_keeps_constant_writers_latest_pending_and_healthy_delivery(relay):
    owner, _ = await member(relay, 'owner')
    _, slow = await member(relay, 'slow')
    _, healthy = await member(relay, 'healthy')
    gate, entered = asyncio.Event(), asyncio.Event()
    original = relay.sio.eio.send
    async def send(sid, data):
        if sid == 'slow':
            entered.set()
            await gate.wait()
        await original(sid, data)
    relay.sio.eio.send = send
    received = []
    async def consume(sock, output):
        while True:
            output.extend(await sock.poll())
    consumer = asyncio.create_task(consume(healthy, received))
    slow_received = []
    slow_consumer = asyncio.create_task(consume(slow, slow_received))
    try:
        for sequence in range(30):
            await publish(relay, 'owner', owner, sequence)
        await entered.wait()
        assert not relay.handler_tasks
        assert len(relay.sio._pose_targets) == 2
        state = relay.sio._pose_targets['slow']
        assert len(state.pending) == 1
        await until(lambda: any(e == 'avatar_pose' and d['pose']['sequence'] == 29 for e, d in messages(received)))
        gate.set()
        await until(lambda: any(e == 'avatar_pose' and d['pose']['sequence'] == 29 for e, d in messages(slow_received)))
    finally:
        gate.set()
        for task in (consumer, slow_consumer):
            task.cancel()
        await asyncio.gather(consumer, slow_consumer, return_exceptions=True)


@pytest.mark.asyncio
async def test_engineio_pose_queue_is_bounded_and_pending_sources_are_fair(relay):
    first, _ = await member(relay, 'first')
    second, _ = await member(relay, 'second')
    _, slow = await member(relay, 'slow')
    await publish(relay, 'first', first, 0)
    await until(lambda: slow.queue.qsize() == 2)
    for sequence in range(1, 30):
        await publish(relay, 'first', first, sequence)
    await publish(relay, 'second', second, 0)
    assert not relay.handler_tasks
    assert slow.queue.qsize() == 2  # one complete header + attachment, never unbounded fragments
    assert len(relay.sio._pose_targets['slow'].pending) == 2
    await slow.poll()  # transport consumes the first in-flight batch
    await until(lambda: slow.queue.qsize() == 2)
    first_latest = messages(await slow.poll())[0][1]
    assert first_latest['userId'] == 'first' and first_latest['pose']['sequence'] == 29
    await publish(relay, 'first', first, 30)
    await until(lambda: slow.queue.qsize() == 2)
    assert messages(await slow.poll())[0][1]['userId'] == 'second'


@pytest.mark.asyncio
@pytest.mark.parametrize('transition', ['leave', 'profile', 'generation'])
async def test_source_transition_purges_pending_pose_before_ordinary_control(relay, transition):
    owner, _ = await member(relay, 'owner')
    _, slow = await member(relay, 'slow')
    lock = relay.sio._packet_locks.setdefault('slow', asyncio.Lock())
    await lock.acquire()
    task = None
    try:
        await publish(relay, 'owner', owner, 0, teleport=True)
        handlers = relay.sio.handlers['/']
        if transition == 'leave':
            task = asyncio.create_task(handlers['leave_position_room'](owner, {'room_id': 'room'}))
        elif transition == 'profile':
            task = asyncio.create_task(handlers['profile_update'](owner, {'room_id': 'room', 'profile': {'avatarId': 'robot'}}))
        else:
            async def exists(room):
                return True
            relay.room_exists = exists
            task = asyncio.create_task(handlers['join_position_room'](owner, {'room_id': 'room', 'profile': {'avatarId': 'casual'}}))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert ('room', 'owner') not in relay.sio._pose_targets['slow'].pending
        lock.release()
        await asyncio.wait_for(task, .5)
        await asyncio.sleep(0)
        packets = await slow.poll()
        assert not any(event == 'avatar_pose' for event, _ in messages(packets))
        if transition == 'leave':
            assert any(event == 'user_left' for event, _ in messages(packets))
        if transition == 'generation':
            await publish(relay, 'owner', owner, 0)
            await until(lambda: slow.queue.qsize() == 2)
            event, data = messages(await slow.poll())[0]
            assert event == 'avatar_pose' and not data['pose']['teleport']
            assert data['generation'] == relay.presence.generation('room', owner)
    finally:
        if lock.locked():
            lock.release()
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('count', [1, 2])
async def test_disconnect_inside_pose_writer_does_not_self_cancel_or_await(relay, count):
    owner, _ = await member(relay, 'owner')
    sockets=[]
    for i in range(count):
        _, slow = await member(relay, f'slow{i}')
        slow.last_ping = time.time() - relay.sio.eio.ping_timeout - 1
        sockets.append(slow)
    await publish(relay, 'owner', owner, 0)
    await until(lambda: all(s.closed for s in sockets))
    assert all(f'slow{i}' not in relay.sio._pose_targets for i in range(count))
    assert all(f'slow{i}' not in relay.sio._packet_locks for i in range(count))
    assert not relay.sio.manager.pending_disconnect


@pytest.mark.asyncio
async def test_disconnect_cancels_writer_waiting_for_engineio_queue_drain(relay):
    owner, _ = await member(relay, 'owner')
    _, slow = await member(relay, 'slow')
    await publish(relay, 'owner', owner, 0)
    await publish(relay, 'owner', owner, 1)
    state = relay.sio._pose_targets['slow']
    assert slow.queue.qsize() == 2 and state.pending
    await asyncio.wait_for(slow.close(wait=False, abort=True), .5)
    assert state.task.done() and not state.pending
    assert 'slow' not in relay.sio._pose_targets


@pytest.mark.asyncio
async def test_namespace_disconnect_also_cancels_the_recipient_writer(relay):
    owner, _ = await member(relay, 'owner')
    _, slow = await member(relay, 'slow')
    await publish(relay, 'owner', owner, 0)
    await publish(relay, 'owner', owner, 1)
    state = relay.sio._pose_targets['slow']
    await relay.sio._handle_disconnect('slow', '/')
    assert not slow.closed  # namespace ended while Engine.IO can remain alive
    assert state.task.done() and not state.pending
    assert 'slow' not in relay.sio._pose_targets


@pytest.mark.asyncio
async def test_callback_pose_uses_reliable_ack_path_without_coalescing(relay):
    from socketio.packet import Packet
    sid, sock = await member(relay, 'target')
    acknowledgements = []
    await relay.sio.emit('avatar_pose', {'room_id':'room', 'userId':'owner', 'pose':avatar_packet()},
                         to=sid, callback=lambda value: acknowledgements.append(value))
    frames = await sock.poll()
    decoded = Packet(encoded_packet=frames[0].data)
    assert decoded.add_attachment(frames[1].data)
    assert decoded.id is not None and not relay.sio._pose_targets
    await relay.sio.manager.trigger_callback(sid, decoded.id, ['accepted'])
    assert acknowledgements == ['accepted']
    assert decoded.id not in relay.sio.manager.callbacks[sid]


@pytest.mark.asyncio
async def test_pose_binary_batch_stays_atomic_with_ordinary_controls_and_ack(relay):
    from socketio.packet import Packet, ACK
    owner, _ = await member(relay, 'owner')
    target, sock = await member(relay, 'target')
    gate, entered = asyncio.Event(), asyncio.Event()
    original = relay.sio.eio.send
    async def delayed(sid, data):
        if sid == 'target' and isinstance(data, bytes):
            entered.set()
            await gate.wait()
        await original(sid, data)
    relay.sio.eio.send = delayed
    tasks = []
    try:
        await publish(relay, 'owner', owner, 0)
        await entered.wait()
        tasks = [asyncio.create_task(relay.sio.emit('wall.control', {'state':'play'}, to=target))]
        await until(lambda: len(relay.sio._packet_locks['target']._waiters or []) == 1)
        tasks.append(asyncio.create_task(relay.sio._send_packet('target', Packet(ACK, id=7, data=[]))))
        await asyncio.sleep(0)
        assert sock.queue.qsize() == 1
        gate.set()
        await asyncio.wait_for(asyncio.gather(*tasks), .5)
        frames = await sock.poll()
        assert len(frames) == 4
        pose = Packet(encoded_packet=frames[0].data)
        assert pose.add_attachment(frames[1].data) and pose.data[0] == 'avatar_pose'
        assert Packet(encoded_packet=frames[2].data).data[0] == 'wall.control'
        ack = Packet(encoded_packet=frames[3].data)
        assert ack.packet_type == ACK and ack.id == 7
    finally:
        gate.set()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_shutdown_owns_all_pose_tasks_and_pending_entries(relay):
    owner, _ = await member(relay, 'owner')
    await member(relay, 'target')
    await publish(relay, 'owner', owner, 0)
    await publish(relay, 'owner', owner, 1)
    targets = list(relay.sio._pose_targets.values())
    await relay.shutdown()
    assert not relay.sio._pose_targets
    assert all(target.task.done() and not target.pending for target in targets)


@pytest.mark.asyncio
async def test_started_binary_pose_finishes_before_leave_and_no_pending_pose_resurrects(relay):
    owner, _ = await member(relay, 'owner')
    _, target = await member(relay, 'target')
    gate, entered = asyncio.Event(), asyncio.Event()
    original = relay.sio.eio.send
    async def delayed(sid, data):
        if sid == 'target' and isinstance(data, bytes):
            entered.set()
            await gate.wait()
        await original(sid, data)
    relay.sio.eio.send = delayed
    leave = None
    try:
        await publish(relay, 'owner', owner, 0)
        await entered.wait()
        await publish(relay, 'owner', owner, 1)
        leave = asyncio.create_task(relay.sio.handlers['/']['leave_position_room'](owner, {'room_id':'room'}))
        await until(lambda: not relay.sio._pose_targets['target'].pending)
        gate.set()
        await asyncio.wait_for(leave, .5)
        events = messages(await target.poll())
        assert [event for event, _ in events] == ['avatar_pose', 'voice.leave', 'user_left']
        assert events[0][1]['pose']['sequence'] == 0
        await asyncio.sleep(0)
        assert target.queue.empty()
    finally:
        gate.set()
        if leave:
            await asyncio.gather(leave, return_exceptions=True)


@pytest.mark.asyncio
async def test_coalesced_teleport_keeps_latest_pose_and_one_shared_sticky_variant(relay):
    import struct
    from socketio.packet import Packet
    owner, _ = await member(relay, 'owner')
    _, healthy = await member(relay, 'healthy')
    slows = [(await member(relay, name))[1] for name in ['slow1', 'slow2']]
    original, encodes = relay.sio.packet_class, []
    class CountPacket(original):
        def encode(self):
            encodes.append(self.data)
            return super().encode()
    relay.sio.packet_class = CountPacket
    async def receive(sock):
        await until(lambda: sock.queue.qsize() == 2)
        frames = await sock.poll()
        decoded = Packet(encoded_packet=frames[0].data)
        assert decoded.add_attachment(frames[1].data)
        return decoded.data[1]['pose']
    await publish(relay, 'owner', owner, 0)
    await receive(healthy)
    await publish(relay, 'owner', owner, 1, teleport=True)
    assert (await receive(healthy))['teleport']
    values = list(struct.unpack('<98f', avatar_packet(2, 7)['floats']))
    values[8] = .42
    latest = struct.pack('<98f', *values)
    await publish(relay, 'owner', owner, 2, floats=latest, bodyScale=1.2)
    assert not (await receive(healthy))['teleport']
    for sock in slows:
        assert (await receive(sock))['sequence'] == 0
    for sock in slows:
        pose = await receive(sock)
        assert pose['sequence'] == 2 and pose['teleport']
        assert pose['floats'] == latest and pose['bodyScale'] == 1.2
    assert len(encodes) == 4  # three normal encodes + one shared sticky variant
    stored = relay.presence.public_room_state('room')[0]['avatarPose']['pose']
    assert stored['sequence'] == 2 and not stored['teleport']
    await publish(relay, 'owner', owner, 3)
    for sock in [healthy, *slows]:
        assert not (await receive(sock))['teleport']


@pytest.mark.asyncio
async def test_real_asgi_lifespan_stops_pending_pose_relays_before_database_shutdown(app):
    from metamuseum.asgi import create_realtime_app
    wrapped = create_realtime_app(app)
    incoming, outgoing = asyncio.Queue(), asyncio.Queue()
    task = asyncio.create_task(wrapped({'type':'lifespan', 'asgi':{'version':'3.0'}}, incoming.get, outgoing.put))
    try:
        await incoming.put({'type':'lifespan.startup'})
        assert (await asyncio.wait_for(outgoing.get(), 5))['type'] == 'lifespan.startup.complete'
        realtime = app.state.realtime
        owner, _ = await member(realtime, 'owner')
        await member(realtime, 'target')
        await publish(realtime, 'owner', owner, 0)
        await publish(realtime, 'owner', owner, 1)
        targets = list(realtime.sio._pose_targets.values())
        await incoming.put({'type':'lifespan.shutdown'})
        assert (await asyncio.wait_for(outgoing.get(), 5))['type'] == 'lifespan.shutdown.complete'
        await task
        assert not realtime.sio._pose_targets
        assert all(target.task.done() and not target.pending for target in targets)
    finally:
        if not task.done():
            await incoming.put({'type':'lifespan.shutdown'})
            await asyncio.wait_for(task, 5)
