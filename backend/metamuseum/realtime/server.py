"""One Socket.IO lifecycle for public visitors and legacy device clients."""
import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from functools import wraps
from http.cookies import SimpleCookie, CookieError

import socketio
from socketio import packet
from fastapi import HTTPException
from mongoengine import ValidationError
from starlette.concurrency import run_in_threadpool

from ..auth import VisitorIdentity, admin_from_session, decode_session_cookie, resolve_visitor
from ..models import Room
from .presence import PresenceService


class PacketManager(socketio.AsyncManager):
    """Queue each entire Socket.IO message, instead of separate attachment tasks."""
    async def emit(self, event, data, namespace, room=None, skip_sid=None, callback=None, to=None, **kwargs):
        if namespace not in self.rooms:
            return
        args = list(data) if isinstance(data, tuple) else [data] if data is not None else []
        skipped = skip_sid if isinstance(skip_sid, list) else [skip_sid]
        tasks = []
        encoded = self.server.packet_class(packet.EVENT, namespace=namespace, data=[event]+args).encode() if not callback else None
        pose_batch = (_PoseBatch(tuple(encoded if isinstance(encoded, list) else [encoded]),
                                 data.get('generation'), data['pose']['teleport'])
                      if event == 'avatar_pose' and not callback else None)
        for sid, eio_sid in self.get_participants(namespace, to or room):
            if sid in skipped or not self.is_connected(sid, namespace):
                continue
            if pose_batch is not None:
                self.server.queue_avatar_pose(eio_sid, sid, namespace, (data['room_id'], data['userId']), pose_batch)
            elif callback:
                ack = self._generate_ack_id(sid, callback)
                message = self.server.packet_class(packet.EVENT, namespace=namespace, data=[event]+args, id=ack)
                tasks.append(self.server._send_packet(eio_sid, message))
            else:
                tasks.append(self.server._send_encoded_packet(eio_sid, encoded))
        if tasks:
            await asyncio.gather(*tasks)


@dataclass
class _PoseBatch:
    encoded: tuple
    generation: str | None
    teleport: bool
    sticky_encoded: tuple | None = None

    def packets(self, teleport, packet_class):
        if not teleport or self.teleport:
            return self.encoded
        if self.sticky_encoded is None:
            # Decode a private copy only for this rare variant; the shared base and
            # authoritative latest presence stay untouched. All slow peers reuse it.
            message = packet_class(encoded_packet=self.encoded[0])
            for attachment in self.encoded[1:]:
                message.add_attachment(attachment)
            message.data[1]['pose']['teleport'] = True
            self.sticky_encoded = tuple(message.encode())
        return self.sticky_encoded


@dataclass
class _PendingPose:
    batch: _PoseBatch
    teleport: bool


@dataclass
class _PoseTarget:
    sid: str
    namespace: str
    pending: dict = field(default_factory=dict)
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None


class PacketServer(socketio.AsyncServer):
    def __init__(self, **kwargs):
        super().__init__(client_manager=PacketManager(), **kwargs)
        self._packet_locks = {}
        self._pose_targets = {}
        self._pose_stopping = False

    async def _handle_eio_message(self, eio_sid, data):
        # Bound incoming assembly before Packet.add_attachment retains chunks.
        # Keep packet_class unchanged: outgoing snapshots can contain many poses.
        try:
            partial = self._binary_packet.get(eio_sid)
            if partial is not None:
                if not isinstance(data, bytes):
                    raise ValueError('Expected binary attachment')
                size = partial._ingress_bytes + len(data)
                if size > partial._ingress_limit or (partial._avatar_ingress and len(data) != 392):
                    raise ValueError('Binary attachment exceeds message contract')
                partial._ingress_bytes = size
            elif isinstance(data, str) and data[:1] in ('5', '6'):
                size = len(data.encode('utf-8'))
                if size > self.eio.max_http_buffer_size:
                    raise ValueError('Binary header exceeds message limit')
                incoming = self.packet_class(encoded_packet=data)
                if not 1 <= incoming.attachment_count <= 64:
                    raise ValueError('Invalid binary attachment count')
                namespace = incoming.namespace or '/'
                sid = self.manager.sid_from_eio_sid(eio_sid, namespace)
                if not sid or not self.manager.is_connected(sid, namespace):
                    raise ValueError('Unexpected binary packet')
                avatar = (incoming.packet_type == packet.BINARY_EVENT
                          and isinstance(incoming.data, list) and incoming.data
                          and incoming.data[0] == 'avatar_pose')
                limit = min(self.eio.max_http_buffer_size, 4096) if avatar else self.eio.max_http_buffer_size
                if avatar and (incoming.attachment_count != 1 or size + 392 > limit):
                    raise ValueError('Avatar binary header exceeds pose contract')
                incoming._avatar_ingress = bool(avatar)
                incoming._ingress_bytes = size
                incoming._ingress_limit = limit
                self._binary_packet[eio_sid] = incoming
                return
            await super()._handle_eio_message(eio_sid, data)
        except Exception:
            # Reconstruction errors and interleaved text must not poison the next message.
            self._binary_packet.pop(eio_sid, None)
            raise

    def queue_avatar_pose(self, eio_sid, sid, namespace, source, batch):
        if self._pose_stopping:
            return
        target = self._pose_targets.get(eio_sid)
        if target is None:
            target = self._pose_targets[eio_sid] = _PoseTarget(sid, namespace)
            target.task = asyncio.create_task(self._drain_avatar_poses(eio_sid, target))
        # Replacing an existing dict key preserves its turn among other sources.
        previous = target.pending.get(source)
        teleport = batch.teleport or bool(previous and previous.batch.generation == batch.generation and previous.teleport)
        target.pending[source] = _PendingPose(batch, teleport)
        target.wake.set()

    async def _drain_avatar_poses(self, eio_sid, target):
        try:
            while self._pose_targets.get(eio_sid) is target:
                await target.wake.wait()
                while target.pending and self._pose_targets.get(eio_sid) is target:
                    socket = self.eio.sockets.get(eio_sid)
                    if (socket is None or socket.closed or socket.closing
                            or not self.manager.is_connected(target.sid, target.namespace)):
                        return
                    # Engine.IO poll acknowledges queued packets before its physical send.
                    # Allow one queued pose batch plus that current transport batch, never
                    # an unbounded pose queue. Reliable controls retain their existing path.
                    await socket.queue.join()
                    async with self._packet_locks.setdefault(eio_sid, asyncio.Lock()):
                        if (self._pose_targets.get(eio_sid) is not target or socket.closed or socket.closing
                                or not self.manager.is_connected(target.sid, target.namespace)):
                            return
                        if not socket.queue.empty() or not target.pending:
                            continue
                        source = next(iter(target.pending))
                        pending = target.pending.pop(source)
                        encoded = pending.batch.packets(pending.teleport, self.packet_class)
                        for part in encoded:
                            if self._pose_targets.get(eio_sid) is not target:
                                break
                            await self.eio.send(eio_sid, part)
                    await asyncio.sleep(0)
                target.wake.clear()
        except Exception:
            self.logger.exception('Avatar pose writer failed for %s', eio_sid)
        finally:
            target.pending.clear()
            if self._pose_targets.get(eio_sid) is target:
                self._pose_targets.pop(eio_sid)

    def purge_avatar_source(self, room, user):
        for target in self._pose_targets.values():
            target.pending.pop((room, user), None)

    def purge_avatar_target_room(self, sid, room):
        eio_sid = self.manager.eio_sid_from_sid(sid, '/')
        target = self._pose_targets.get(eio_sid)
        if target:
            for source in list(target.pending):
                if source[0] == room:
                    target.pending.pop(source)

    async def _stop_avatar_target(self, eio_sid):
        target = self._pose_targets.pop(eio_sid, None)
        if target:
            target.pending.clear()
            # Ping timeout can call disconnect from inside this very writer.
            if target.task is not asyncio.current_task():
                target.task.cancel()
                await asyncio.gather(target.task, return_exceptions=True)

    async def stop_avatar_relays(self):
        self._pose_stopping = True
        for eio_sid in list(self._pose_targets):
            await self._stop_avatar_target(eio_sid)

    async def shutdown(self):
        self._binary_packet.clear()
        await self.stop_avatar_relays()
        await super().shutdown()

    async def _send_packet(self, eio_sid, message):
        await self._send_encoded_packet(eio_sid, message.encode())

    async def _send_encoded_packet(self, eio_sid, encoded):
        # Binary header + attachments must stay contiguous with snapshots, ACKs and ordinary events.
        socket = self.eio.sockets.get(eio_sid)
        if socket is None or socket.closed or socket.closing:
            return
        async with self._packet_locks.setdefault(eio_sid, asyncio.Lock()):
            if socket.closed or socket.closing:
                return
            for part in encoded if isinstance(encoded, list) else [encoded]:
                await self.eio.send(eio_sid, part)

    async def _handle_eio_disconnect(self, eio_sid, reason):
        self._binary_packet.pop(eio_sid, None)
        await self._stop_avatar_target(eio_sid)
        try:
            await super()._handle_eio_disconnect(eio_sid, reason)
        finally:
            self._packet_locks.pop(eio_sid, None)


def payload(data):
    return data if isinstance(data, dict) else {}


def room_id(data):
    value = payload(data).get('room_id')
    return value if isinstance(value, str) and value else None


def presence_room(room):
    return f'presence:{room}'


def _room_exists(room):
    if room is None:
        return False
    try:
        return Room.objects(_id=room).first() is not None
    except (ValidationError, ValueError, TypeError):
        return False


class Realtime:
    def __init__(self, http_app):
        self.settings = http_app.state.settings
        self.sio = PacketServer(async_mode='asgi', cors_allowed_origins=self.settings.allowed_origins)
        self.presence = PresenceService()
        self.visitors = {}
        self.admin_sessions = {}
        self.pending_joins = {}
        self.handler_tasks = set()
        self.database_tasks = set()
        self.stopping = False
        from .voice import Voice
        from .ar import AR
        from .gesture import Gesture
        self.voice = Voice(self)
        self.ar = AR(self, http_app)
        self.gesture = Gesture(self, http_app)
        from .wall_interactions import WallInteractions
        self.wall_interactions = WallInteractions(self)
        self._register()

    def get_room_visitor(self, sid: str, room_id: str) -> VisitorIdentity | None:
        if not isinstance(room_id, str):
            return None
        identity = self.visitors.get(sid)
        return identity if identity and self.presence.user_id(room_id, sid) == identity.visitor_id else None

    async def is_admin(self, sid):
        session = self.admin_sessions.get(sid)
        return bool(session and await self.session_is_admin(session))

    async def session_is_admin(self, session):
        return bool(await self.database_call(admin_from_session, session))

    async def database_call(self, function, *args):
        # Cancelling an async handler cannot stop its already-running DB thread.
        if self.stopping:
            raise asyncio.CancelledError
        task = asyncio.create_task(run_in_threadpool(function, *args))
        self.database_tasks.add(task)

        def completed(done):
            self.database_tasks.discard(done)
            if not done.cancelled():
                done.exception()

        task.add_done_callback(completed)
        return await asyncio.shield(task)

    def on(self, event):
        """Track only application handlers, including connect/disconnect tasks."""
        def register(handler):
            @wraps(handler)
            async def tracked(*args, **kwargs):
                if self.stopping:
                    return False if event == 'connect' else None
                task = asyncio.current_task()
                nested = task in self.handler_tasks
                self.handler_tasks.add(task)
                try:
                    return await handler(*args, **kwargs)
                finally:
                    if not nested:
                        self.handler_tasks.discard(task)
            self.sio.on(event, handler=tracked)
            return tracked
        return register

    def begin_join(self, sid, kind, room):
        token = object()
        self.pending_joins.setdefault(sid, {})[kind, room] = token
        return token

    def finish_join(self, sid, kind, room, token=None):
        pending = self.pending_joins.get(sid, {})
        current = pending.get((kind, room))
        if token is not None and current is not token:
            return False
        pending.pop((kind, room), None)
        if not pending:
            self.pending_joins.pop(sid, None)
        return current is not None

    async def shutdown(self, *, drain_timeout=5, cancel_timeout=1):
        """Drain handlers before Mongo closes; cancel overdue async work boundedly."""
        self.stopping = True
        self.pending_joins.clear()
        await self.sio.stop_avatar_relays()
        await self.wall_interactions.stop()
        tasks = (self.handler_tasks | self.database_tasks) - {asyncio.current_task()}
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=drain_timeout)
            for task in pending & self.handler_tasks:
                task.cancel()
            if pending:
                _, pending = await asyncio.wait(pending, timeout=cancel_timeout)
                if pending:
                    raise RuntimeError('Realtime handlers did not stop before database shutdown')
        self.visitors.clear()
        self.admin_sessions.clear()
        self.presence.rooms.clear()
        self.presence.rates.clear()
        for room in self.ar.rooms.values():
            room['phones'].clear()
            room['vision_pros'].clear()
        await self.sio.shutdown()

    async def room_exists(self, room):
        return await self.database_call(_room_exists, room)

    async def broadcast(self, event, data, *, room_id, skip_sid=None, physical_wall_move=False):
        if event in ('wall.design_applied', 'wall.design_removed'):
            if not self.wall_interactions.design_changed(event, data, physical_move=physical_wall_move):
                return
        await self.sio.emit(event, data, room=presence_room(room_id), skip_sid=skip_sid)
        if event in ('wall.design_applied', 'wall.design_removed'):
            await self.wall_interactions.design_announced(event, data)

    async def _left(self, event, sid):
        self.sio.purge_avatar_source(event['room_id'], event['userId'])
        self.wall_interactions.left(sid, event['room_id'])
        await self.voice.left(event['room_id'], event['userId'], sid)
        await self.broadcast('user_left', event, room_id=event['room_id'])

    def _register(self):
        sio = self.sio

        @self.on('connect')
        async def connect(sid, environ, auth):
            auth = payload(auth)
            capability = auth.get('visitorCapability')
            if capability is not None:
                try:
                    identity = resolve_visitor(capability, settings=self.settings)
                except HTTPException:
                    return False
            else:
                identity = None
            session = {}
            if 'csrfToken' in auth:
                if environ.get('HTTP_ORIGIN') not in self.settings.allowed_origins:
                    return False
                cookies = SimpleCookie()
                try:
                    cookies.load(environ.get('HTTP_COOKIE', ''))
                except CookieError:
                    return False
                cookie = cookies.get(self.settings.session_cookie)
                session = decode_session_cookie(cookie.value, settings=self.settings) if cookie else {}
                expected, supplied = session.get('csrf_token'), auth.get('csrfToken')
                if (not isinstance(expected, str) or not isinstance(supplied, str)
                        or not expected.isascii() or not supplied.isascii()
                        or not secrets.compare_digest(expected, supplied)
                        or not await self.session_is_admin(session)):
                    return False
            if self.stopping or not sio.manager.is_connected(sid, '/'):
                return False
            if identity:
                self.visitors[sid] = identity
            if session:
                self.admin_sessions[sid] = session

        @self.on('disconnect')
        async def disconnect(sid, reason=None):
            await sio._stop_avatar_target(sio.manager.eio_sid_from_sid(sid, '/'))
            self.visitors.pop(sid, None)
            self.admin_sessions.pop(sid, None)
            self.pending_joins.pop(sid, None)
            self.ar.disconnect(sid)
            events = self.presence.leave_all(sid)
            for event in events:
                sio.purge_avatar_source(event['room_id'], event['userId'])
            for event in events:
                await self._left(event, sid)

        @self.on('join_position_room')
        async def join(sid, data):
            data = payload(data)
            room = room_id(data)
            identity = self.visitors.get(sid)
            if not identity or room is None:
                return
            token = self.begin_join(sid, 'presence', room)
            try:
                exists = await self.room_exists(room)
            finally:
                current = self.finish_join(sid, 'presence', room, token)
            if not exists or not current or sid not in self.visitors or self.stopping:
                return
            self.sio.purge_avatar_source(room, identity.visitor_id)
            self.sio.purge_avatar_target_room(sid, room)
            public, existing, displaced = self.presence.join(room, sid, identity.visitor_id,
                data.get('profile'), data.get('position', '0 1.6 0'), data.get('rotation', '0 0 0'))
            await sio.enter_room(sid, presence_room(room))
            if displaced:
                self.sio.purge_avatar_target_room(displaced, room)
                self.wall_interactions.left(displaced, room)
                await sio.leave_room(displaced, presence_room(room))
                await sio.emit('voice.displaced', {'room_id': room}, to=displaced)
                await self.voice.left(room, identity.visitor_id, sid)
            await sio.emit('room_state', {'users': existing, 'room_id': room, 'generation': self.presence.generation(room, sid), 'serverTime': time.time()*1000}, to=sid)
            await self.wall_interactions.joined(sid, room)
            if not self.get_room_visitor(sid, room) or self.stopping:
                return
            await self.broadcast('user_joined', {key: public[key] for key in ['userId', 'displayName', 'avatarId', 'color', 'appearance'] if key in public} | {'room_id': room}, room_id=room, skip_sid=sid)
            if displaced:
                await self.broadcast('position_update', public | {'room_id': room}, room_id=room, skip_sid=sid)

        @self.on('leave_position_room')
        async def leave(sid, data):
            room = room_id(data)
            if not room:
                return
            self.finish_join(sid, 'presence', room)
            self.sio.purge_avatar_target_room(sid, room)
            event = self.presence.leave(room, sid)
            await sio.leave_room(sid, presence_room(room))
            if event:
                await self._left(event, sid)

        @self.on('position_update')
        async def position(sid, data):
            data = payload(data)
            room = room_id(data)
            event = self.presence.update_position(room, sid, data)
            if event:
                await self.broadcast('position_update', event, room_id=room, skip_sid=sid)

        @self.on('avatar_pose')
        async def avatar_pose(sid, data):
            data = payload(data)
            if set(data) != {'room_id', 'generation', 'pose'} or not isinstance(data.get('pose'), dict):
                return
            try:
                metadata = {**data, 'pose': {k: v for k, v in data['pose'].items() if k != 'floats'}}
                if len(json.dumps(metadata, allow_nan=False).encode()) + len(data['pose'].get('floats', b'')) > 4096:
                    return
            except (TypeError, ValueError, OverflowError):
                return
            room = room_id(data)
            if self.get_room_visitor(sid, room):
                event = self.presence.update_avatar_pose(room, sid, data.get('generation'), data.get('pose'))
                if event:
                    await self.broadcast('avatar_pose', event, room_id=room, skip_sid=sid)

        @self.on('profile_update')
        async def profile(sid, data):
            data = payload(data)
            room = room_id(data)
            event = self.presence.update_profile(room, sid, data.get('profile'))
            if event:
                self.sio.purge_avatar_source(room, event['userId'])
                await self.broadcast('profile_updated', event, room_id=room, skip_sid=sid)

        @self.on('request_room_state')
        async def state(sid, data):
            room = room_id(data)
            if self.get_room_visitor(sid, room):
                await sio.emit('room_state', {'users': self.presence.public_room_state(room, exclude_sid=sid), 'room_id': room, 'generation': self.presence.generation(room, sid), 'serverTime': time.time()*1000}, to=sid)

        @self.on('expression')
        async def expression(sid, data):
            data = payload(data)
            room = room_id(data)
            identity = self.get_room_visitor(sid, room)
            if identity:
                await self.broadcast('expression', {'userId': identity.visitor_id, 'expression': data.get('expression', ''), 'room_id': room}, room_id=room, skip_sid=sid)


def create_realtime_app(http_app):
    """Wrap the HTTP factory once; state remains scoped to this one-worker app."""
    if not hasattr(http_app.state, 'realtime'):
        http_app.state.realtime = Realtime(http_app)
        http_app.state.sio = http_app.state.realtime.sio
    return socketio.ASGIApp(http_app.state.sio, other_asgi_app=http_app)
