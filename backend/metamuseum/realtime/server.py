"""One Socket.IO lifecycle for public visitors and legacy device clients."""
import secrets
from http.cookies import SimpleCookie, CookieError

import socketio
from fastapi import HTTPException
from mongoengine import ValidationError
from starlette.concurrency import run_in_threadpool

from ..auth import VisitorIdentity, admin_from_session, decode_session_cookie, resolve_visitor
from ..models import Room
from .presence import PresenceService


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
        self.sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=self.settings.allowed_origins)
        self.presence = PresenceService()
        self.visitors = {}
        self.admin_sessions = {}
        from .voice import Voice
        from .ar import AR
        from .gesture import Gesture
        self.voice = Voice(self)
        self.ar = AR(self, http_app)
        self.gesture = Gesture(self, http_app)
        self._register()

    def get_room_visitor(self, sid: str, room_id: str) -> VisitorIdentity | None:
        if not isinstance(room_id, str):
            return None
        identity = self.visitors.get(sid)
        return identity if identity and self.presence.user_id(room_id, sid) == identity.visitor_id else None

    async def is_admin(self, sid):
        session = self.admin_sessions.get(sid)
        return bool(session and await run_in_threadpool(admin_from_session, session))

    async def room_exists(self, room):
        return await run_in_threadpool(_room_exists, room)

    async def broadcast(self, event, data, *, room_id, skip_sid=None):
        await self.sio.emit(event, data, room=presence_room(room_id), skip_sid=skip_sid)

    async def _left(self, event, sid):
        await self.voice.left(event['room_id'], event['userId'], sid)
        await self.broadcast('user_left', event, room_id=event['room_id'])

    def _register(self):
        sio = self.sio

        @sio.event
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
                        or not await run_in_threadpool(admin_from_session, session)):
                    return False
            if identity:
                self.visitors[sid] = identity
            if session:
                self.admin_sessions[sid] = session

        @sio.event
        async def disconnect(sid, reason=None):
            self.visitors.pop(sid, None)
            self.admin_sessions.pop(sid, None)
            self.ar.disconnect(sid)
            for event in self.presence.leave_all(sid):
                await self._left(event, sid)

        @sio.on('join_position_room')
        async def join(sid, data):
            data = payload(data)
            room = room_id(data)
            identity = self.visitors.get(sid)
            if not identity or not await self.room_exists(room):
                return
            # No await between identity validation and the atomic in-memory replacement.
            if sid not in self.visitors:
                return
            public, existing, displaced = self.presence.join(room, sid, identity.visitor_id,
                data.get('profile'), data.get('position', '0 1.6 0'), data.get('rotation', '0 0 0'))
            await sio.enter_room(sid, presence_room(room))
            if displaced:
                await sio.leave_room(displaced, presence_room(room))
                await sio.emit('voice.displaced', {'room_id': room}, to=displaced)
                await self.voice.left(room, identity.visitor_id, sid)
            await sio.emit('room_state', {'users': existing, 'room_id': room}, to=sid)
            await self.broadcast('user_joined', {key: public[key] for key in ['userId', 'displayName', 'avatarId', 'color']} | {'room_id': room}, room_id=room, skip_sid=sid)
            if displaced:
                await self.broadcast('position_update', public | {'room_id': room}, room_id=room, skip_sid=sid)

        @sio.on('leave_position_room')
        async def leave(sid, data):
            room = room_id(data)
            if not room:
                return
            event = self.presence.leave(room, sid)
            await sio.leave_room(sid, presence_room(room))
            if event:
                await self._left(event, sid)

        @sio.on('position_update')
        async def position(sid, data):
            data = payload(data)
            room = room_id(data)
            event = self.presence.update_position(room, sid, data)
            if event:
                await self.broadcast('position_update', event, room_id=room, skip_sid=sid)

        @sio.on('profile_update')
        async def profile(sid, data):
            data = payload(data)
            room = room_id(data)
            event = self.presence.update_profile(room, sid, data.get('profile'))
            if event:
                await self.broadcast('profile_updated', event, room_id=room, skip_sid=sid)

        @sio.on('request_room_state')
        async def state(sid, data):
            room = room_id(data)
            if self.get_room_visitor(sid, room):
                await sio.emit('room_state', {'users': self.presence.public_room_state(room, exclude_sid=sid), 'room_id': room}, to=sid)

        @sio.on('expression')
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
