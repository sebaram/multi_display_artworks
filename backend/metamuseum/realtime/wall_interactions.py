"""One authoritative pointer per applied wall and a durable shared media clock."""
import asyncio
import copy
import math
import time
import uuid

from bson import ObjectId
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from ..models import Wall
from ..services import wall_designs as designs


def finite(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def positive_int(value):
    return type(value) is int and 0 < value < 2**53


def room_designs(room):
    if not ObjectId.is_valid(room):
        return []
    walls = list(Wall.objects(room=ObjectId(room)))
    documents = {doc['_id']: doc for doc in designs.collection('bindings').find({'_id': {'$in': [wall.pk for wall in walls]}, 'active': {'$ne': False}})}
    return [designs.binding_dto(documents[wall.pk], wall) for wall in walls if wall.pk in documents]


@designs.locked
def retire_deleted_binding(wall):
    col = designs.collection('bindings')
    identifier = designs.object_id(wall)
    previous = col.find_one({'_id': identifier})
    if not previous or previous.get('active') is False:
        return previous['revision'] if previous else 0
    revision = previous['revision'] + 1
    tombstone = dict(_id=identifier, revision=revision, active=False, asset_ids=[])
    changed = col.replace_one({'_id': identifier, 'revision': previous['revision'], 'active': {'$ne': False}}, tombstone)
    if not changed.matched_count:
        raise HTTPException(409, 'binding_revision_conflict')
    return revision


def change_playback(data, room, now):
    # Share the HTTP apply/reference lock; the Mongo predicates also guard CAS.
    with designs.reference_lock:
        wall = designs.get('walls', data['wall_id'])
        if str(wall.room.pk) != room:
            raise HTTPException(403, 'wall_room_mismatch')
        col = designs.collection('bindings')
        doc = col.find_one({'_id': wall.pk})
        if (not doc or doc.get('active') is False or doc['revision'] != data['binding_revision']
                or doc['playback']['revision'] != data['expected_playback_revision']):
            raise HTTPException(409, 'revision_conflict')
        old = doc['playback']
        if not all(finite(old.get(key)) for key in ('position_seconds', 'rate', 'state_time_ms')) or old['rate'] < 0:
            raise HTTPException(422, 'invalid_playback_clock')
        position = old['position_seconds'] + (max(0, now - old['state_time_ms']) / 1000 * old['rate'] if old['playing'] else 0)
        if 'position_seconds' in data:
            position = data['position_seconds']
        state = dict(old, revision=old['revision'] + 1, position_seconds=position, state_time_ms=now)
        if data['action'] != 'seek':
            state['playing'] = data['action'] == 'play'
        if not finite(position):
            raise HTTPException(422, 'invalid_playback_position')
        changed = col.find_one_and_update({'_id': wall.pk, 'revision': data['binding_revision'],
            'active': {'$ne': False},
            'playback.revision': data['expected_playback_revision']}, {'$set': {'playback': state}}, return_document=ReturnDocument.AFTER)
        if not changed:
            raise HTTPException(409, 'revision_conflict')
        return state


class WallInteractions:
    def __init__(self, realtime):
        self.realtime = realtime
        self.bindings = {}
        self.runtime = {}
        self.versions = {}
        self.sequences = {}
        self.tasks = set()
        self.ticker = None
        self.now = lambda: int(time.time() * 1000)
        self._register()

    def state(self, wall):
        runtime = self.runtime.get(wall)
        binding = self.bindings.get(wall)
        if not runtime or not binding:
            return None
        return dict(wall_id=wall, binding_revision=binding['revision'], runtime_id=runtime['runtime_id'],
                    sequence=runtime['sequence'], server_time_ms=self.now(), pointer=dict(runtime['pointer']),
                    seed=binding['seed'], animation_epoch_ms=binding['animation_epoch_ms'],
                    active_until_ms=runtime['active_until_ms'])

    def install(self, binding):
        wall = binding['wall_id']
        old = self.runtime.get(wall)
        self.bindings[wall] = copy.deepcopy(binding)
        self.bindings[wall].pop('server_time_ms', None)
        self.runtime[wall] = dict(runtime_id=old['runtime_id'] if old else uuid.uuid4().hex,
            sequence=old['sequence'] + 1 if old else 0, pointer={'x': 0, 'y': 0},
            active_until_ms=0, owner=None, dirty=False, last_emit=0.)

    def design_changed(self, event, data):
        wall = data['wall_id']
        self.versions[wall] = self.versions.get(wall, 0) + 1
        if event == 'wall.design_applied':
            self.install(data)
        else:
            self.bindings.pop(wall, None)
            self.runtime.pop(wall, None)
        for key in [key for key in self.sequences if key[1] == wall]:
            self.sequences.pop(key, None)

    async def design_announced(self, event, data):
        if event == 'wall.design_applied':
            state = self.state(data['wall_id'])
            if state and state['binding_revision'] == data['revision']:
                await self.realtime.broadcast('wall.interaction_state', state, room_id=data['room_id'])

    async def joined(self, sid, room):
        versions = dict(self.versions)
        bindings = await self.realtime.database_call(room_designs, room)
        if not self.realtime.get_room_visitor(sid, room) or self.realtime.stopping:
            return
        for binding in bindings:
            wall = binding['wall_id']
            # A suspended snapshot lookup cannot restore a removed/older binding.
            if self.versions.get(wall, 0) == versions.get(wall, 0) and wall not in self.bindings:
                self.install(binding)
            elif wall in self.bindings and self.bindings[wall]['revision'] == binding['revision']:
                current = self.bindings[wall]['playback']
                if binding['playback']['revision'] > current['revision']:
                    self.bindings[wall]['playback'] = binding['playback']
        walls = [dict(design=copy.deepcopy(binding), interaction=self.state(wall))
                 for wall, binding in self.bindings.items() if binding['room_id'] == room]
        await self.realtime.sio.emit('wall.snapshot', dict(room_id=room, server_time_ms=self.now(), walls=walls), to=sid)

    async def wall_changed(self, wall, room=None):
        """Request-scoped admin callback after a physical wall moves or is deleted."""
        previous = self.bindings.get(wall)
        if previous and previous['room_id'] == room:
            return
        generation = self.versions.get(wall, 0) + 1
        removal = dict(wall_id=wall, room_id=previous['room_id'] if previous else room,
                       revision=previous['revision'] if previous else 0, server_time_ms=self.now())
        if room is None:
            # Revoke cached input before the tracked DB offload releases asset references.
            self.design_changed('wall.design_removed', removal)
            revision = await self.realtime.database_call(retire_deleted_binding, wall)
            current = self.bindings.get(wall) or previous
            if current:
                removal.update(room_id=current['room_id'], revision=revision)
                await self.realtime.broadcast('wall.design_removed', removal, room_id=current['room_id'])
            else:
                self.design_changed('wall.design_removed', removal)
            return
        if previous:
            # broadcast clears cached authorization synchronously before its emit yields.
            await self.realtime.broadcast('wall.design_removed', removal, room_id=previous['room_id'])
        else:
            self.design_changed('wall.design_removed', removal)
        if self.versions.get(wall) != generation or self.realtime.stopping:
            return
        try:
            binding = await self.realtime.database_call(designs.get_binding, wall)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            binding = None
        if binding and self.versions.get(wall) == generation and not self.realtime.stopping:
            await self.realtime.broadcast('wall.design_applied', {**binding, 'server_time_ms': self.now()}, room_id=binding['room_id'])

    def reset(self, runtime):
        runtime.update(pointer={'x': 0, 'y': 0}, active_until_ms=0, owner=None, dirty=True,
                       sequence=runtime['sequence'] + 1)

    def left(self, sid, room):
        for wall, runtime in self.runtime.items():
            if self.bindings[wall]['room_id'] == room and runtime['owner'] == sid:
                self.reset(runtime)
                self.start_ticker()
        for key in [key for key in self.sequences if key[0] == sid and self.bindings.get(key[1], {}).get('room_id') == room]:
            self.sequences.pop(key, None)

    def start_ticker(self):
        if self.realtime.stopping or self.ticker and not self.ticker.done():
            return
        self.ticker = asyncio.create_task(self.run())
        self.tasks.add(self.ticker)
        self.ticker.add_done_callback(self.tasks.discard)

    async def run(self):
        while not self.realtime.stopping:
            await asyncio.sleep(.05)
            await self.flush()
            if not any(runtime['dirty'] or runtime['owner'] for runtime in self.runtime.values()):
                return

    async def flush(self):
        now = self.now()
        monotonic = time.monotonic()
        for wall, runtime in list(self.runtime.items()):
            if self.runtime.get(wall) is not runtime:
                continue
            binding = self.bindings[wall]
            if runtime['owner'] and runtime['active_until_ms'] <= now:
                self.reset(runtime)
            if runtime['dirty'] and monotonic - runtime['last_emit'] >= .05:
                runtime.update(dirty=False, last_emit=monotonic)
                await self.realtime.broadcast('wall.interaction_state', self.state(wall), room_id=binding['room_id'])

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
        self.bindings.clear()
        self.runtime.clear()
        self.sequences.clear()
        self.versions.clear()

    def member_binding(self, sid, data):
        binding = self.bindings.get(data.get('wall_id')) if isinstance(data.get('wall_id'), str) else None
        if not binding or not self.realtime.get_room_visitor(sid, binding['room_id']):
            raise HTTPException(403, 'wall_membership_required')
        if not positive_int(data.get('binding_revision')) or binding['revision'] != data['binding_revision']:
            raise HTTPException(409, 'binding_revision_conflict')
        return binding

    def _register(self):
        realtime = self.realtime

        @realtime.on('wall.clock')
        async def clock(sid, data=None):
            return {'server_time_ms': self.now()}

        @realtime.on('wall.interaction')
        async def interaction(sid, data):
            try:
                if not isinstance(data, dict):
                    raise HTTPException(422, 'invalid_wall_input')
                binding = self.member_binding(sid, data)
                if binding['config']['state'].get('interactive') is not True:
                    raise HTTPException(403, 'wall_not_interactive')
                if type(data.get('client_seq')) is not int or not 0 <= data['client_seq'] < 2**53 or data.get('kind') not in ('move', 'leave'):
                    raise HTTPException(422, 'invalid_wall_input')
                uv = data.get('uv')
                if data['kind'] == 'move' and (not isinstance(uv, dict) or not all(finite(uv.get(k)) and 0 <= uv[k] <= 1 for k in ('u', 'v'))):
                    raise HTTPException(422, 'invalid_wall_uv')
                wall = binding['wall_id']
                previous, accepted = self.sequences.get((sid, wall), (-1, float('-inf')))
                if data['client_seq'] <= previous:
                    raise HTTPException(409, 'client_sequence_conflict')
                now = time.monotonic()
                if data['kind'] == 'move' and now - accepted < .05:
                    raise HTTPException(429, 'wall_input_rate_limited')
                self.sequences[sid, wall] = (data['client_seq'], now)
                runtime = self.runtime[wall]
                if data['kind'] == 'move':
                    runtime.update(pointer={'x': uv['u'] - .5, 'y': .5 - uv['v']}, owner=sid,
                        active_until_ms=self.now() + 3000, dirty=True, sequence=runtime['sequence'] + 1)
                elif runtime['owner'] == sid:
                    self.reset(runtime)
                self.start_ticker()
                return {'ok': True}
            except HTTPException as exc:
                return {'ok': False, 'status': exc.status_code, 'detail': exc.detail}

        @realtime.on('wall.playback_command')
        async def playback(sid, data):
            try:
                if not isinstance(data, dict):
                    raise HTTPException(422, 'invalid_playback_command')
                binding = self.member_binding(sid, data)
                if not positive_int(data.get('expected_playback_revision')) or data.get('action') not in ('play', 'pause', 'seek'):
                    raise HTTPException(422, 'invalid_playback_command')
                if (data['action'] == 'seek' and 'position_seconds' not in data or 'position_seconds' in data and
                        (not finite(data['position_seconds']) or not 0 <= data['position_seconds'] <= 1e10)):
                    raise HTTPException(422, 'invalid_playback_position')
                if not await realtime.is_admin(sid):
                    raise HTTPException(403, 'admin_required')
                # Role lookup yields: membership and binding must still be current.
                binding = self.member_binding(sid, data)
                room = binding['room_id']
                state = await realtime.database_call(change_playback, data, room, self.now())
                current = self.bindings.get(data['wall_id'])
                if current and current['revision'] == data['binding_revision'] and state['revision'] > current['playback']['revision']:
                    current['playback'] = state
                    await realtime.broadcast('wall.playback_state', state, room_id=room)
                return {'ok': True, 'state': state}
            except HTTPException as exc:
                return {'ok': False, 'status': exc.status_code, 'detail': exc.detail}
            except PyMongoError:
                return {'ok': False, 'status': 503, 'detail': 'database_unavailable'}
