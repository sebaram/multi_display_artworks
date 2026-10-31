"""Shared wall authority: deterministic runtime checks plus real transport/Mongo tests."""
import asyncio
import copy
import json
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest

from fixtures.realtime import live_realtime, peer, wait_event


@pytest.fixture
def controlled(settings):
    from metamuseum.asgi import create_app, create_realtime_app
    app = create_app(settings)
    create_realtime_app(app)
    realtime = app.state.realtime
    assert hasattr(realtime, 'wall_interactions'), 'Shared wall service is missing'
    return realtime


def design(wall='wall', room='room', revision=1):
    return dict(wall_id=wall, room_id=room, revision=revision, config={'state': {'interactive': True}},
                seed=13, animation_epoch_ms=1000,
                playback=dict(wall_id=wall, binding_revision=revision, revision=1, playing=True,
                              position_seconds=4, rate=1, state_time_ms=1000))


async def member(realtime, name='sid', room='room'):
    from metamuseum.auth import VisitorIdentity
    sid = await realtime.sio.manager.connect(name, '/')
    realtime.visitors[sid] = VisitorIdentity(name)
    realtime.presence.join(room, sid, name, None, '0 0 0', '0 0 0')
    return sid


def move(seq=1, **values):
    return dict(wall_id='wall', binding_revision=1, client_seq=seq, kind='move', uv={'u': 1, 'v': 0}, **values)


def test_finite_accepts_persisted_bson_clock_but_rejects_boolean_or_overflow():
    from bson import BSON
    from metamuseum.realtime.wall_interactions import finite
    value = BSON(BSON.encode({'time':1789000000000})).decode()['time']
    assert finite(value)
    assert not finite(True) and not finite(10**1000) and not finite(float('nan'))


@pytest.mark.asyncio
async def test_only_members_can_interact_with_their_wall(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt, room='other')
    handler = rt.sio.handlers['/']['wall.interaction']
    assert (await handler(sid, move()))['status'] == 403
    assert (await handler('device-only', move()))['status'] == 403
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_input_is_finite_bounded_and_revision_checked(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    handler = rt.sio.handlers['/']['wall.interaction']
    for uv in ({'u': float('nan'), 'v': 0}, {'u': 2, 'v': 0}, {'u': True, 'v': 0}, None):
        data = move(); data['uv'] = uv
        assert (await handler(sid, data))['status'] == 422
    data = move(); data['binding_revision'] = 0
    assert (await handler(sid, data))['status'] == 409
    assert (await handler(sid, move()))['ok']
    assert (await handler(sid, move()))['status'] == 409
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_pointer_never_calls_database_and_disabled_design_rejects(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    async def forbidden(*args): pytest.fail('Pointer event called MongoDB')
    rt.database_call = forbidden
    assert (await rt.sio.handlers['/']['wall.interaction'](sid, move()))['ok']
    disabled = design(revision=2); disabled['config']['state']['interactive'] = False
    await rt.broadcast('wall.design_applied', disabled, room_id='room')
    data = move(); data['binding_revision'] = 2
    assert (await rt.sio.handlers['/']['wall.interaction'](sid, data))['status'] == 403
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_last_accepted_input_wins_and_broadcast_is_capped(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    a, b = await member(rt, 'a'), await member(rt, 'b')
    events = []
    async def broadcast(event, data, **kwargs): events.append((event, copy.deepcopy(data)))
    rt.broadcast = broadcast
    handler = rt.sio.handlers['/']['wall.interaction']
    assert (await handler(a, move()))['ok']
    data = move(); data['uv'] = {'u': 0, 'v': 1}
    assert (await handler(b, data))['ok']
    assert (await handler(b, move(2)))['status'] == 429
    await asyncio.sleep(.07)
    states = [data for event, data in events if event == 'wall.interaction_state']
    assert len(states) == 1 and states[0]['pointer'] == {'x': -.5, 'y': -.5}
    assert states[0]['sequence'] == 2
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_active_disconnect_or_idle_resets_pointer(controlled):
    rt = controlled
    clock = [1000]
    rt.wall_interactions.now = lambda: clock[0]
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    handler = rt.sio.handlers['/']['wall.interaction']
    await handler(sid, move())
    clock[0] = 4001
    await rt.wall_interactions.flush()
    state = rt.wall_interactions.state('wall')
    assert state['pointer'] == {'x': 0, 'y': 0} and state['active_until_ms'] == 0
    await asyncio.sleep(.051)
    await handler(sid, move(2))
    await rt.sio.handlers['/']['disconnect'](sid)
    assert rt.wall_interactions.state('wall')['pointer'] == {'x': 0, 'y': 0}
    assert not rt.wall_interactions.sequences
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_nonowner_leave_and_displacement_clear_only_its_sequence(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    a, b = await member(rt, 'a'), await member(rt, 'b')
    handler = rt.sio.handlers['/']['wall.interaction']
    await handler(a, move())
    await handler(b, move())
    await rt.sio.handlers['/']['leave_position_room'](a, {'room_id':'room'})
    assert (a, 'wall') not in rt.wall_interactions.sequences
    assert rt.wall_interactions.runtime['wall']['owner'] == b
    # Exercise the real single join lifecycle, controlling only DB lookup results.
    async def exists(room): return True
    async def no_bindings(*args): return []
    rt.room_exists = exists
    rt.database_call = no_bindings
    replacement = await rt.sio.manager.connect('replacement', '/')
    rt.visitors[replacement] = rt.visitors[b]
    await rt.sio.handlers['/']['join_position_room'](replacement, {'room_id':'room'})
    assert rt.get_room_visitor(b, 'room') is None
    assert (b, 'wall') not in rt.wall_interactions.sequences
    assert rt.wall_interactions.state('wall')['pointer'] == {'x':0, 'y':0}
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_suspended_snapshot_cannot_restore_removed_binding_or_left_visitor(controlled):
    rt = controlled
    sid = await member(rt)
    started, release = asyncio.Event(), asyncio.Event()
    emitted = []
    async def lookup(*args):
        started.set()
        await release.wait()
        return [design()]
    async def emit(event, data, **kwargs): emitted.append((event, data))
    rt.database_call = lookup
    rt.sio.emit = emit
    pending = asyncio.create_task(rt.wall_interactions.joined(sid, 'room'))
    await started.wait()
    await rt.broadcast('wall.design_removed', {'wall_id':'wall','room_id':'room','revision':2}, room_id='room')
    release.set()
    await pending
    snapshot = [data for event, data in emitted if event == 'wall.snapshot'][-1]
    assert snapshot['walls'] == []
    started.clear(); release.clear(); emitted.clear()
    pending = asyncio.create_task(rt.wall_interactions.joined(sid, 'room'))
    await started.wait()
    await rt.sio.handlers['/']['leave_position_room'](sid, {'room_id':'room'})
    release.set()
    await pending
    assert not any(event == 'wall.snapshot' for event, _ in emitted)
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize('delayed', ['apply', 'remove'])
async def test_obsolete_design_notifications_cannot_change_cache_or_transport(controlled, delayed):
    rt = controlled
    emitted = []
    async def emit(event, data, **kwargs): emitted.append((event, copy.deepcopy(data)))
    rt.sio.emit = emit
    await rt.broadcast('wall.design_applied', design(revision=2), room_id='room')
    removed = {'wall_id':'wall','room_id':'room','revision':3,'server_time_ms':2000}
    await rt.broadcast('wall.design_removed', removed, room_id='room')
    if delayed == 'remove':
        await rt.broadcast('wall.design_applied', design(revision=4), room_id='room')
    emitted.clear()
    await rt.broadcast('wall.design_applied' if delayed == 'apply' else 'wall.design_removed',
        design(revision=2) if delayed == 'apply' else removed, room_id='room')
    assert rt.wall_interactions.state('wall') is None if delayed == 'apply' else rt.wall_interactions.state('wall')['binding_revision'] == 4
    assert emitted == []
    sid = await member(rt)
    async def stale_lookup(*args): return [design(revision=2)]
    rt.database_call = stale_lookup
    await rt.wall_interactions.joined(sid, 'room')
    snapshot = [data for event, data in emitted if event == 'wall.snapshot'][-1]
    assert snapshot['walls'] == [] if delayed == 'apply' else snapshot['walls'][0]['design']['revision'] == 4
    assert (await rt.sio.handlers['/']['wall.interaction'](sid, {**move(),'binding_revision':2}))['ok'] is False
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_join_after_commit_cannot_suppress_first_room_design_announcement(controlled):
    from metamuseum.realtime.wall_interactions import room_designs
    from metamuseum.services import wall_designs as storage
    rt = controlled
    existing = await member(rt, 'existing')
    await rt.sio.enter_room(existing, 'presence:room')
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    committed, release = asyncio.Event(), asyncio.Event()
    latest = design(revision=2)
    emitted = []
    async def database_call(function, *args):
        if function is storage.apply:
            committed.set()
            await release.wait()
            return copy.deepcopy(latest)
        assert function is room_designs
        return [copy.deepcopy(latest)]
    async def emit(event, data, **kwargs): emitted.append((event, copy.deepcopy(data), kwargs))
    rt.database_call = database_call
    rt.sio.emit = emit
    applying = asyncio.create_task(rt.wall_interactions.apply_design('wall', {'expected_revision':1}))
    await committed.wait()
    late = await member(rt, 'late')
    await rt.wall_interactions.joined(late, 'room')
    snapshot = next(data for event, data, target in emitted if event == 'wall.snapshot' and target.get('to') == late)
    assert snapshot['walls'][0]['design']['revision'] == 2
    assert not any(event == 'wall.design_applied' for event, _, _ in emitted)
    release.set()
    await applying
    announced = [(event, data) for event, data, target in emitted if target.get('room') == 'presence:room']
    assert [event for event, _ in announced] == ['wall.design_applied', 'wall.interaction_state']
    assert announced[0][1]['revision'] == announced[1][1]['binding_revision'] == 2
    assert announced[1][1]['pointer'] == {'x':0,'y':0}
    # Once the room announcement really happened, duplicates remain suppressed.
    count = len(emitted)
    await rt.broadcast('wall.design_applied', latest, room_id='room')
    assert len(emitted) == count
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize('adapter', ['api', 'legacy'])
async def test_concurrent_apply_and_wall_move_publish_actual_room(controlled, monkeypatch, adapter):
    from metamuseum.api import admin, legacy, wall_designs
    from metamuseum.services import gallery, wall_designs as storage
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    old_sid, new_sid = await member(rt, 'old'), await member(rt, 'new', 'moved-room')
    state = {'room':'room', 'binding':design()}
    entered, moved, release = asyncio.Event(), asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    def apply(wall, body):
        captured_room = state['room']
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(2), 'Controlled apply was not released'
        state['binding'] = design(room=captured_room, revision=2)
        return copy.deepcopy(state['binding'])
    def save(resource, values, identifier):
        state['room'] = values['room']
        loop.call_soon_threadsafe(moved.set)
        return SimpleNamespace(pk=identifier, room=SimpleNamespace(pk=state['room']))
    def binding(wall):
        return {**copy.deepcopy(state['binding']), 'room_id':state['room']}
    monkeypatch.setattr(storage, 'apply', apply)
    monkeypatch.setattr(storage, 'get_binding', binding)
    monkeypatch.setattr(gallery, 'save', save)
    monkeypatch.setattr(gallery, 'dto', lambda doc: {'id':str(doc.pk), 'room':str(doc.room.pk)})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(realtime=rt)))
    body = SimpleNamespace(model_dump=lambda: {'expected_revision':1, 'config':{}})
    from starlette.concurrency import run_in_threadpool
    applying = asyncio.create_task(wall_designs.apply('wall', body, request))
    await entered.wait()
    if adapter == 'api':
        moving = asyncio.create_task(run_in_threadpool(admin.patch, 'walls', 'wall', request, {'room':'moved-room'}))
    else:
        moving = asyncio.create_task(run_in_threadpool(legacy.admin_mutation, 'wall', 'edit', {'room':'moved-room'}, 'wall', request=request))
    try:
        try:
            await asyncio.wait_for(moved.wait(), .1)
        except TimeoutError:
            pass  # With the shared boundary, movement waits for apply publication.
    finally:
        release.set()
        await asyncio.gather(applying, moving)
    assert rt.wall_interactions.bindings['wall']['room_id'] == state['room'] == 'moved-room'
    assert rt.wall_interactions.bindings['wall']['revision'] == 2
    data = {**move(), 'binding_revision':2}
    assert (await rt.sio.handlers['/']['wall.interaction'](old_sid, data))['status'] == 403
    assert (await rt.sio.handlers['/']['wall.interaction'](new_sid, data))['ok']
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_move_authority_rejects_delayed_old_room_publication(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(revision=2), room_id='room')
    async def current(*args): return design(room='moved-room', revision=2)
    rt.database_call = current
    await rt.wall_interactions.wall_changed('wall', 'moved-room')
    emitted = []
    async def emit(event, data, **kwargs): emitted.append((event, data))
    rt.sio.emit = emit
    await rt.broadcast('wall.design_applied', design(revision=2), room_id='room')
    assert rt.wall_interactions.bindings['wall']['room_id'] == 'moved-room'
    assert not emitted
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_cancelled_http_waiter_cannot_release_running_wall_mutation(controlled, monkeypatch):
    from metamuseum.api import admin, wall_designs
    from metamuseum.services import gallery, wall_designs as storage
    from starlette.concurrency import run_in_threadpool
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    state = {'room':'room','binding':design()}
    entered, moved, release = asyncio.Event(), asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    def apply(wall, body):
        captured = state['room']
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(2)
        state['binding'] = design(room=captured, revision=2)
        return copy.deepcopy(state['binding'])
    def save(resource, values, identifier):
        state['room'] = values['room']
        loop.call_soon_threadsafe(moved.set)
        return SimpleNamespace(pk=identifier, room=SimpleNamespace(pk=state['room']))
    monkeypatch.setattr(storage, 'apply', apply)
    monkeypatch.setattr(storage, 'get_binding', lambda wall: {**copy.deepcopy(state['binding']), 'room_id':state['room']})
    monkeypatch.setattr(gallery, 'save', save)
    monkeypatch.setattr(gallery, 'dto', lambda doc: {'id':str(doc.pk),'room':str(doc.room.pk)})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(realtime=rt)))
    body = SimpleNamespace(model_dump=lambda: {'expected_revision':1,'config':{}})
    applying = asyncio.create_task(wall_designs.apply('wall', body, request))
    await entered.wait()
    applying.cancel()
    with pytest.raises(asyncio.CancelledError): await applying
    moving = asyncio.create_task(run_in_threadpool(admin.patch, 'walls', 'wall', request, {'room':'moved-room'}))
    try:
        try: await asyncio.wait_for(moved.wait(), .1)
        except TimeoutError: pass
        moved_before_apply_finished = moved.is_set()
    finally:
        release.set()
        await moving
        await asyncio.gather(*rt.handler_tasks, *rt.database_tasks)
    assert not moved_before_apply_finished
    assert rt.wall_interactions.bindings['wall']['room_id'] == state['room'] == 'moved-room'
    assert rt.wall_interactions.bindings['wall']['revision'] == 2
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_apply_order_removal_and_shutdown_clear_runtime(controlled):
    from metamuseum.realtime.server import presence_room
    from metamuseum.realtime.wall_displays import channel
    rt = controlled
    emitted = []
    async def emit(event, data, **kwargs): emitted.append((event, kwargs['room']))
    rt.sio.emit = emit
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    assert emitted == [
        ('wall.design_applied', presence_room('room')),
        ('wall.design_applied', channel('wall')),
        ('wall.interaction_state', presence_room('room')),
        ('wall.interaction_state', channel('wall')),
    ]
    old = rt.wall_interactions.state('wall')
    await rt.broadcast('wall.design_applied', design(revision=2), room_id='room')
    assert rt.wall_interactions.state('wall')['sequence'] > old['sequence']
    await rt.broadcast('wall.design_removed', {'wall_id':'wall','room_id':'room','revision':3}, room_id='room')
    assert rt.wall_interactions.state('wall') is None
    await rt.shutdown()
    assert not rt.wall_interactions.tasks


@pytest.mark.asyncio
async def test_playback_commands_require_admin_and_revision(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    command = dict(wall_id='wall', binding_revision=1, expected_playback_revision=1, action='pause')
    assert (await rt.sio.handlers['/']['wall.playback_command'](sid, command))['status'] == 403
    assert 'server_time_ms' in await rt.sio.handlers['/']['wall.clock'](sid, {})
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_playback_rechecks_membership_after_suspended_admin_lookup(controlled):
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    started, release = asyncio.Event(), asyncio.Event()
    async def admin(sid):
        started.set()
        await release.wait()
        return True
    async def forbidden(*args): pytest.fail('Command performed DB write after visitor left')
    rt.is_admin = admin
    rt.database_call = forbidden
    command = dict(wall_id='wall', binding_revision=1, expected_playback_revision=1, action='pause')
    pending = asyncio.create_task(rt.sio.handlers['/']['wall.playback_command'](sid, command))
    await started.wait()
    await rt.sio.handlers['/']['disconnect'](sid)
    release.set()
    assert (await pending)['status'] == 403
    await rt.wall_interactions.stop()


@pytest.mark.asyncio
async def test_playback_database_failure_has_structured_ack(controlled):
    from pymongo.errors import PyMongoError
    rt = controlled
    await rt.broadcast('wall.design_applied', design(), room_id='room')
    sid = await member(rt)
    async def admin(sid): return True
    async def unavailable(*args): raise PyMongoError('offline')
    rt.is_admin = admin
    rt.database_call = unavailable
    command = dict(wall_id='wall',binding_revision=1,expected_playback_revision=1,action='pause')
    result = await rt.sio.handlers['/']['wall.playback_command'](sid, command)
    assert result == {'ok':False,'status':503,'detail':'database_unavailable'}
    await rt.wall_interactions.stop()


async def applied_server(server, *, rate=1):
    csrf = (await server.http.get('/api/v1/auth/csrf')).json()['csrf_token']
    signin = await server.http.post('/api/v1/auth/signin', headers={'Origin':'http://testserver','X-CSRF-Token':csrf},
        json={'email':'admin@migration.invalid','password':'Migration-local-123!'})
    assert signin.status_code == 200
    csrf = (await server.http.get('/api/v1/auth/csrf')).json()['csrf_token']
    headers = {'Origin':'http://testserver','X-CSRF-Token':csrf}
    rooms = (await server.http.get('/api/v1/rooms')).json()
    wall = rooms[0]['walls'][0]['id']
    config = json.loads((Path(__file__).parents[2] / 'frontend/public/wall-presets/builtin-0.json').read_text(encoding='utf8'))['config']
    config['state'].update(interactive=True, speed=rate, offset=4)
    result = await server.http.put(f'/api/v1/walls/{wall}/design', headers=headers, json={'config':config,'expected_revision':0})
    assert result.status_code == 200, result.text
    return result.json(), headers


async def admin_peer(server):
    csrf = (await server.http.get('/api/v1/auth/csrf')).json()['csrf_token']
    visitor = (await server.http.post('/api/v1/visitor-capability')).json()
    return await peer(server, auth={'visitorCapability':visitor['capability'],'csrfToken':csrf},
        headers={'Origin':'http://testserver','Cookie':'; '.join(f'{k}={v}' for k,v in server.http.cookies.items())})


@pytest.mark.asyncio
async def test_real_members_concurrent_pointer_rate_room_isolation_and_no_writes(live_realtime, database):
    server = live_realtime
    applied, _ = await applied_server(server)
    a, ae = await peer(server)
    b, be = await peer(server)
    outsider, oe = await peer(server)
    device, _ = await peer(server, auth={})
    for client, room in ((a, applied['room_id']), (b, applied['room_id']), (outsider, server.rooms[1])):
        await client.call('join_position_room', {'room_id':room})
    initial = await wait_event(ae, 'wall.snapshot')
    assert initial['walls'][0]['design'] == applied
    data = dict(wall_id=applied['wall_id'], binding_revision=applied['revision'], client_seq=1, kind='move', uv={'u':1,'v':0})
    assert (await outsider.call('wall.interaction', data))['status'] == 403
    assert (await device.call('wall.interaction', data))['status'] == 403
    before = list(database.wall_design_bindings.find())
    results = await asyncio.gather(a.call('wall.interaction', data), b.call('wall.interaction', {**data,'uv':{'u':0,'v':1}}))
    assert all(result['ok'] for result in results)
    assert (await a.call('wall.interaction', {**data,'client_seq':2}))['status'] == 429
    first, second = await wait_event(ae, 'wall.interaction_state'), await wait_event(be, 'wall.interaction_state')
    assert first == second and first['sequence'] == 2
    assert first['pointer'] in ({'x':.5,'y':.5}, {'x':-.5,'y':-.5})
    assert list(database.wall_design_bindings.find()) == before
    assert not any(event.startswith('wall.interaction') for event, _ in oe.history)
    late, le = await peer(server)
    await late.call('join_position_room', {'room_id':applied['room_id']})
    snapshot = await wait_event(le, 'wall.snapshot')
    assert snapshot['walls'][0]['interaction']['pointer'] == first['pointer']
    assert snapshot['walls'][0]['interaction']['runtime_id'] == first['runtime_id']
    owner = server.app.state.realtime.wall_interactions.runtime[applied['wall_id']]['owner']
    active = a if a.get_sid() == owner else b
    await active.call('leave_position_room', {'room_id':applied['room_id']})
    assert (await wait_event(le, 'wall.interaction_state'))['pointer'] == {'x':0,'y':0}


@pytest.mark.asyncio
async def test_real_playback_admin_cas_revocation_zero_rate_and_binding_changes(live_realtime, database):
    server = live_realtime
    applied, headers = await applied_server(server, rate=0)
    admin, events = await admin_peer(server)
    visitor, ve = await peer(server)
    for client in (admin, visitor):
        await client.call('join_position_room', {'room_id':applied['room_id']})
    command = dict(wall_id=applied['wall_id'], binding_revision=applied['revision'], expected_playback_revision=1, action='pause')
    assert (await visitor.call('wall.playback_command', command))['status'] == 403
    for position in (float('inf'), -1, True):
        assert (await admin.call('wall.playback_command', {**command,'action':'seek','position_seconds':position}))['status'] == 422
    commands = await asyncio.gather(admin.call('wall.playback_command', command), admin.call('wall.playback_command', {**command,'action':'seek','position_seconds':22}))
    assert sorted(result.get('status',200) for result in commands) == [200,409]
    successful = next(result['state'] for result in commands if result['ok'])
    assert (await wait_event(ve, 'wall.playback_state')) == successful
    next_command = {**command,'expected_playback_revision':successful['revision'],'action':'play','position_seconds':7}
    playing = await admin.call('wall.playback_command', next_command)
    assert playing['ok'] and playing['state']['rate'] == 0 and playing['state']['position_seconds'] == 7
    database.users.update_one({'email':'admin@migration.invalid'}, {'$set':{'user_type':[]}})
    assert (await admin.call('wall.playback_command', {**next_command,'expected_playback_revision':playing['state']['revision']}))['status'] == 403
    database.users.update_one({'email':'admin@migration.invalid'}, {'$set':{'user_type':['admin']}})
    removed = await server.http.delete(f"/api/v1/walls/{applied['wall_id']}/design?expected_revision={applied['revision']}", headers=headers)
    assert removed.status_code == 204
    assert server.app.state.realtime.wall_interactions.state(applied['wall_id']) is None
    replacement = await server.http.put(f"/api/v1/walls/{applied['wall_id']}/design", headers=headers,
        json={'config':applied['config'],'expected_revision':0})
    assert replacement.status_code == 200 and replacement.json()['revision'] > applied['revision']
    assert (await admin.call('wall.playback_command', next_command))['status'] == 409
    assert (await visitor.call('wall.interaction', dict(wall_id=applied['wall_id'], binding_revision=applied['revision'],client_seq=1,kind='move',uv={'u':0,'v':0})))['status'] == 409


@pytest.mark.asyncio
@pytest.mark.parametrize('adapter', ['api', 'legacy'])
async def test_wall_move_and_delete_invalidate_cached_room_authority(live_realtime, adapter):
    server = live_realtime
    source, headers = await applied_server(server)
    created = await server.http.post('/api/v1/admin/walls', headers=headers, json=dict(
        name='Movable wall', description='Runtime authority test', room=source['room_id'], position='0 0 0',
        rotation='0 0 0', width=2, height=2, depth=.1))
    assert created.status_code == 201, created.text
    wall = created.json()['id']
    result = await server.http.put(f'/api/v1/walls/{wall}/design', headers=headers,
        json={'config':source['config'],'expected_revision':0})
    applied = result.json()
    a, ae = await peer(server)
    b, be = await peer(server)
    await a.call('join_position_room', {'room_id':source['room_id']})
    await b.call('join_position_room', {'room_id':server.rooms[1]})
    if adapter == 'api':
        changed = await server.http.patch(f'/api/v1/admin/walls/{wall}', headers=headers, json={'room':server.rooms[1]})
        assert changed.status_code == 200
    else:
        changed = await server.http.post(f'/kwanri/wall/edit/?id={wall}', headers=headers, json={'room':server.rooms[1]})
        assert changed.status_code == 303
    data = dict(wall_id=wall,binding_revision=applied['revision'],client_seq=1,kind='move',uv={'u':1,'v':0})
    assert (await a.call('wall.interaction', data))['status'] == 403
    assert (await b.call('wall.interaction', data))['ok']
    assert (await wait_event(be, 'wall.design_applied'))['room_id'] == server.rooms[1]
    if adapter == 'api':
        deleted = await server.http.delete(f'/api/v1/admin/walls/{wall}', headers=headers)
        assert deleted.status_code == 204
    else:
        deleted = await server.http.post(f'/kwanri/wall/delete/?id={wall}', headers=headers, json={})
        assert deleted.status_code == 303
    assert (await b.call('wall.interaction', {**data,'client_seq':2}))['status'] == 403
    assert server.app.state.realtime.wall_interactions.state(wall) is None


@pytest.mark.asyncio
@pytest.mark.parametrize('adapter', ['api', 'legacy_bulk'])
async def test_physical_wall_delete_retires_binding_and_releases_asset(live_realtime, database, tmp_path, adapter):
    from bson import ObjectId
    server = live_realtime
    source, headers = await applied_server(server)
    server.app.state.settings.wall_media_root = tmp_path
    upload = await server.http.post('/api/v1/wall-assets', headers=headers,
        files={'file':('bound.mp4', b'\x00\x00\x00\x18ftypisom' + b'wall-delete', 'video/mp4')})
    assert upload.status_code == 201, upload.text
    asset = upload.json()
    config = copy.deepcopy(source['config'])
    config['state']['videoLayers'] = [{'id':'bound-video','assetId':asset['id']}]
    preset = await server.http.post('/api/v1/wall-presets', headers=headers, json={'name':'Deleted wall asset','config':config})
    assert preset.status_code == 201
    preset = preset.json()
    wall = (await server.http.post('/api/v1/admin/walls', headers=headers, json=dict(
        name='Delete with binding', description='Asset reference retirement', room=source['room_id'],
        position='0 0 0', rotation='0 0 0', width=2, height=2, depth=.1))).json()['id']
    applied = (await server.http.put(f'/api/v1/walls/{wall}/design', headers=headers,
        json={'preset_id':preset['id'],'expected_revision':0})).json()
    removed = await server.http.delete(f"/api/v1/wall-presets/{preset['id']}?expected_revision={preset['revision']}", headers=headers)
    assert removed.status_code == 204
    assert (await server.http.delete('/api/v1/wall-assets/' + asset['id'], headers=headers)).status_code == 409
    visitor, events = await peer(server)
    await visitor.call('join_position_room', {'room_id':source['room_id']})
    if adapter == 'api':
        deleted = await server.http.delete(f'/api/v1/admin/walls/{wall}', headers=headers)
        assert deleted.status_code == 204
    else:
        deleted = await server.http.post('/kwanri/wall/action/', headers=headers, json={'action':'delete','rowid':[wall]})
        assert deleted.status_code == 303
    tombstone = database.wall_design_bindings.find_one({'_id':ObjectId(wall)})
    assert tombstone == {'_id':ObjectId(wall),'revision':applied['revision'] + 1,'active':False,'asset_ids':[]}
    # Repeated request-scoped cleanup must retain the same revision counter.
    await server.app.state.realtime.wall_interactions.wall_changed(wall)
    assert database.wall_design_bindings.find_one({'_id':ObjectId(wall)}) == tombstone
    data = dict(wall_id=wall,binding_revision=applied['revision'],client_seq=1,kind='move',uv={'u':1,'v':0})
    assert (await visitor.call('wall.interaction', data))['status'] == 403
    assert server.app.state.realtime.wall_interactions.state(wall) is None
    assert (await server.http.delete('/api/v1/wall-assets/' + asset['id'], headers=headers)).status_code == 204


@asynccontextmanager
async def running_server(settings, port):
    import httpx2
    import uvicorn
    from metamuseum.asgi import create_app, create_realtime_app
    app = create_app(settings)
    uvicorn_server = uvicorn.Server(uvicorn.Config(create_realtime_app(app), host='127.0.0.1', port=port,
        log_level='error', ws='websockets-sansio'))
    task = asyncio.create_task(uvicorn_server.serve())
    state = SimpleNamespace(url=f'http://127.0.0.1:{port}', app=app, clients=[])
    try:
        async with asyncio.timeout(8):
            while not uvicorn_server.started:
                if task.done(): await task
                await asyncio.sleep(.01)
        async with httpx2.AsyncClient(base_url=state.url) as http:
            state.http = http
            state.rooms = [r['id'] for r in (await http.get('/api/v1/rooms')).json()]
            yield state
    finally:
        for client in state.clients:
            if client.connected: await client.disconnect()
            await client.eio.disconnect(abort=True)
        uvicorn_server.should_exit = True
        await asyncio.wait_for(task, 8)


@pytest.mark.asyncio
async def test_late_join_and_restart_snapshot(settings, database, unused_tcp_port):
    # Stop/start real Uvicorn apps over the same MongoDB, preserving durable state.
    async with running_server(settings, unused_tcp_port) as server:
        applied, _ = await applied_server(server)
        admin, events = await admin_peer(server)
        await admin.call('join_position_room', {'room_id':applied['room_id']})
        initial = await wait_event(events, 'wall.snapshot')
        command = dict(wall_id=applied['wall_id'],binding_revision=applied['revision'],expected_playback_revision=1,action='pause')
        paused = (await admin.call('wall.playback_command', command))['state']
        assert not paused['playing'] and paused['position_seconds'] >= 4
        seek = (await admin.call('wall.playback_command', {**command,'expected_playback_revision':2,'action':'seek','position_seconds':17}))['state']
        assert seek['position_seconds'] == 17 and not seek['playing']
        await admin.call('wall.interaction', dict(wall_id=applied['wall_id'],binding_revision=applied['revision'],client_seq=1,kind='move',uv={'u':1,'v':0}))
        late, le = await peer(server)
        await late.call('join_position_room', {'room_id':applied['room_id']})
        assert (await wait_event(le, 'wall.snapshot'))['walls'][0]['design']['playback'] == seek
    async with running_server(settings, unused_tcp_port) as restarted:
        visitor, events = await peer(restarted)
        await visitor.call('join_position_room', {'room_id':applied['room_id']})
        snapshot = await wait_event(events, 'wall.snapshot')
        wall = snapshot['walls'][0]
        assert wall['design']['playback'] == seek
        assert wall['design']['seed'] == applied['seed']
        assert wall['design']['animation_epoch_ms'] == applied['animation_epoch_ms']
        assert wall['interaction']['pointer'] == {'x':0,'y':0}
        assert wall['interaction']['runtime_id'] != initial['walls'][0]['interaction']['runtime_id']
        clock = await visitor.call('wall.clock', {})
        assert abs(clock['server_time_ms'] - snapshot['server_time_ms']) < 1000
