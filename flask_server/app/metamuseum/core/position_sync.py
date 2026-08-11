# -*- coding: utf-8 -*-
"""Position Sync via Socket.IO — replaces HTTP polling for multi-user avatar positions.

Events:
- join_position_room   → user joins a room, receives current state
- leave_position_room  → user leaves
- position_update      → broadcast position/rotation/hand data to others in room
- user_joined          → notify others a new user arrived
- user_left            → notify others a user left
- room_state           → send full room state to newly joined user
"""
import importlib.util
from collections import defaultdict
from flask import request, session
from mongoengine import ValidationError

from metamuseum.core.presence_service import PresenceService

_SOCKETIO_ASYNC_MODE = (
    'eventlet' if importlib.util.find_spec('eventlet') is not None
    else 'gevent' if importlib.util.find_spec('gevent') is not None
    else 'threading'
)

# Global socketio instance (also exported as `socketio` for convenience)
socketio_instance = None
socketio = None  # alias used by other modules

# Compatibility alias for code that still inspects the in-memory room mapping.
presence_service = PresenceService()
room_users = presence_service.rooms


# room_voice_enabled: { room_id: bool } — server-authoritative voice state
room_voice_enabled = defaultdict(lambda: False)


def _room_exists(room_id):
    if not isinstance(room_id, str) or not room_id:
        return False
    from metamuseum.elements.basic import Room

    try:
        return Room.objects(_id=room_id).first() is not None
    except (ValidationError, TypeError, ValueError):
        return False


def _session_is_admin():
    """Resolve the existing Flask-Login session identity for socket events."""
    from metamuseum.models import User

    user_id = session.get('_user_id')
    if not user_id:
        return False
    user = User.objects(email=user_id).first()
    return bool(user and user.is_admin())


def init_socketio(app, existing_sio=None):
    global socketio_instance, socketio
    if socketio_instance:
        return socketio_instance

    if existing_sio:
        socketio_instance = existing_sio
    else:
        from flask_socketio import SocketIO
        socketio_instance = SocketIO(
            app,
            cors_allowed_origins='*',
            async_mode=_SOCKETIO_ASYNC_MODE
        )

    socketio = socketio_instance  # update module-level alias
    _register_sync_handlers(socketio_instance)
    return socketio_instance


def _register_sync_handlers(sio):
    from flask_socketio import join_room, leave_room

    def voice_identity(data):
        if not isinstance(data, dict):
            return None
        room_id = data.get('room_id')
        user_id = presence_service.user_id(room_id, request.sid)
        if not room_id or not user_id:
            return None
        return room_id, user_id

    def voice_target(data):
        if not isinstance(data, dict):
            return None
        room_id = data.get('room_id')
        target_id = data.get('target')
        target_sid = presence_service.sid_for_user(room_id, target_id)
        if not target_id or not target_sid:
            return None
        return target_id, target_sid

    @sio.on('disconnect')
    def on_disconnect():
        # Clean up AR rooms (ar_proxy shares this SocketIO instance)
        from metamuseum.core.ar_proxy import ar_rooms
        for room_id, room in ar_rooms.items():
            room['phones'].discard(request.sid)
            room['vision_pros'].discard(request.sid)

        # Remove from all position rooms and notify others
        for event in presence_service.leave_all(request.sid):
            sio.emit('user_left', event, room=event['room_id'])
            print(f'[PositionSync] {event["userId"]} left room {event["room_id"]}')

    @sio.on('join_position_room')
    def on_join(data):
        data = data or {}
        room_id = data.get('room_id')
        visitor_id = session.get('visitor_id')

        if not visitor_id or not _room_exists(room_id):
            return

        join_room(room_id)
        presence, existing_users, displaced_sid = presence_service.join(
            room_id,
            request.sid,
            visitor_id,
            data.get('profile'),
            data.get('position', '0 1.6 0'),
            data.get('rotation', '0 0 0'),
        )
        if displaced_sid:
            leave_room(room_id, sid=displaced_sid)
            sio.emit('voice.displaced', {'room_id': room_id}, room=displaced_sid)
            sio.emit('voice.leave', {
                'room_id': room_id,
                'userId': visitor_id,
            }, room=room_id, skip_sid=request.sid)

        # Send current room state to the new joiner
        sio.emit('room_state', {
            'users': existing_users,
            'room_id': room_id
        }, room=request.sid)

        # Notify others that a new user joined
        sio.emit('user_joined', {
            'userId': presence['userId'],
            'displayName': presence['displayName'],
            'avatarId': presence['avatarId'],
            'color': presence['color'],
            'room_id': room_id
        }, room=room_id, skip_sid=request.sid)
        if displaced_sid:
            sio.emit(
                'position_update',
                dict(presence, room_id=room_id),
                room=room_id,
                skip_sid=request.sid,
            )

    @sio.on('leave_position_room')
    def on_leave(data):
        room_id = data.get('room_id')
        if not room_id or not presence_service.has_room(room_id):
            return

        event = presence_service.leave(room_id, request.sid)
        leave_room(room_id)

        if event:
            sio.emit('user_left', event, room=room_id)

    @sio.on('position_update')
    def on_position_update(data):
        """Receive position update from a client, broadcast to others in room."""
        data = data or {}
        room_id = data.get('room_id')
        broadcast_data = presence_service.update_position(
            room_id, request.sid, data
        )
        if not broadcast_data:
            return

        # Broadcast to all OTHER clients in the room
        sio.emit('position_update', broadcast_data, room=room_id, skip_sid=request.sid)

    @sio.on('profile_update')
    def on_profile_update(data):
        """Update only the sender's normalized public profile fields."""
        data = data or {}
        room_id = data.get('room_id')
        event = presence_service.update_profile(
            room_id, request.sid, data.get('profile')
        )
        if not event:
            return
        sio.emit('profile_updated', event, room=room_id, skip_sid=request.sid)

    @sio.on('request_room_state')
    def on_request_state(data):
        """Re-send full room state to requesting client."""
        room_id = data.get('room_id')
        if not room_id or not presence_service.has_room(room_id):
            return

        existing_users = presence_service.public_room_state(
            room_id, exclude_sid=request.sid
        )
        sio.emit('room_state', {
            'users': existing_users,
            'room_id': room_id
        }, room=request.sid)


    @sio.on('expression')
    def on_expression(data):
        """Broadcast emoji expression to all other users in room."""
        room_id = data.get('room_id')
        if not room_id or not presence_service.has_room(room_id):
            return

        sio.emit('expression', {
            'userId': presence_service.user_id(room_id, request.sid) or '?',
            'expression': data.get('expression', ''),
            'room_id': room_id
        }, room=room_id, skip_sid=request.sid)

    @sio.on('voice.admin_toggle')
    def on_voice_admin_toggle(data):
        """Admin enables/disables voice chat for a room. Server-authoritative."""
        identity = voice_identity(data)
        if not identity or not _session_is_admin():
            return
        room_id, _ = identity

        # Update server-side authoritative state
        enabled = bool(data.get('enabled', False))
        room_voice_enabled[room_id] = enabled

        # Broadcast to all in room (including sender — they sync to server state)
        sio.emit('voice_admin_toggle', {
            'enabled': enabled,
            'room_id': room_id
        }, room=room_id)

    @sio.on('voice.get_state')
    def on_voice_get_state(data):
        """Client requests current voice state (on join/reconnect)."""
        identity = voice_identity(data)
        if not identity:
            return
        room_id, _ = identity
        sio.emit('voice_admin_toggle', {
            'enabled': room_voice_enabled.get(room_id, False),
            'room_id': room_id
        }, room=request.sid)

    @sio.on('voice.offer')
    def on_voice_offer(data):
        """Relay WebRTC offer to target peer."""
        target = voice_target(data)
        identity = voice_identity(data)
        if not target or not identity:
            return
        room_id, user_id = identity
        target_id, target_sid = target
        sio.emit('voice.offer', {
            'room_id': room_id,
            'from': user_id,
            'target': target_id,
            'sdp': data.get('sdp'),
            'type': data.get('type'),
        }, room=target_sid)

    @sio.on('voice.answer')
    def on_voice_answer(data):
        """Relay WebRTC answer to target peer."""
        target = voice_target(data)
        identity = voice_identity(data)
        if not target or not identity:
            return
        room_id, user_id = identity
        target_id, target_sid = target
        sio.emit('voice.answer', {
            'room_id': room_id,
            'from': user_id,
            'target': target_id,
            'sdp': data.get('sdp'),
            'type': data.get('type'),
        }, room=target_sid)

    @sio.on('voice.ice')
    def on_voice_ice(data):
        """Relay ICE candidate to target peer."""
        target = voice_target(data)
        identity = voice_identity(data)
        if not target or not identity:
            return
        room_id, user_id = identity
        target_id, target_sid = target
        sio.emit('voice.ice', {
            'room_id': room_id,
            'from': user_id,
            'target': target_id,
            'candidate': data.get('candidate'),
        }, room=target_sid)

    @sio.on('voice.join')
    def on_voice_join(data):
        """Relay voice join to all others in room."""
        identity = voice_identity(data)
        if not identity:
            return
        room_id, user_id = identity
        sio.emit('voice.join', {
            'room_id': room_id,
            'userId': user_id,
        }, room=room_id, skip_sid=request.sid)

    @sio.on('voice.leave')
    def on_voice_leave(data):
        """Relay voice leave to all others in room."""
        identity = voice_identity(data)
        if not identity:
            return
        room_id, user_id = identity
        sio.emit('voice.leave', {
            'room_id': room_id,
            'userId': user_id,
        }, room=room_id, skip_sid=request.sid)

    @sio.on('voice.mute')
    def on_voice_mute(data):
        """Relay mute state to all others in room."""
        identity = voice_identity(data)
        if not identity:
            return
        room_id, user_id = identity
        sio.emit('voice.mute', {
            'room_id': room_id,
            'userId': user_id,
            'muted': bool(data.get('muted')),
        }, room=room_id, skip_sid=request.sid)

    @sio.on('voice.transcript')
    def on_voice_transcript(data):
        """Relay Whisper transcript to all others in room."""
        identity = voice_identity(data)
        if not identity:
            return
        room_id, user_id = identity
        sio.emit('voice.transcript', {
            'room_id': room_id,
            'userId': user_id,
            'text': data.get('text', ''),
            'language': data.get('language', 'auto'),
        }, room=room_id, skip_sid=request.sid)


# ─── Legacy HTTP endpoints (kept for backward compat, can be removed later) ───

def get_position_rooms():
    """Return serializable dict of current rooms for HTTP fallback."""
    return presence_service.public_rooms()
