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
import socketio
from collections import defaultdict
from flask import request

# Global socketio instance
socketio_instance = None

# room_users: { room_id: { sid: { userId, avatar, position, rotation, leftHand, rightHand, handTracking } } }
room_users = defaultdict(dict)


def init_socketio(app):
    global socketio_instance
    if socketio_instance:
        return socketio_instance

    from flask_socketio import SocketIO
    socketio_instance = SocketIO(
        app,
        cors_allowed_origins='*',
        async_mode='gevent'
    )

    _register_sync_handlers(socketio_instance)
    return socketio_instance


def _register_sync_handlers(sio):

    @sio.on('connect')
    def on_connect():
        print('[PositionSync] Connected:', request.sid)

    @sio.on('disconnect')
    def on_disconnect():
        # Remove from all rooms and notify others
        for room_id, users in list(room_users.items()):
            if request.sid in users:
                user = users.pop(request.sid)
                sio.emit('user_left', {
                    'userId': user['userId'],
                    'room_id': room_id
                }, room=room_id)
                print(f'[PositionSync] {user["userId"]} left room {room_id}')

    @sio.on('join_position_room')
    def on_join(data):
        room_id = data.get('room_id')
        userId = data.get('userId')
        avatar = data.get('avatar', 'shiba')

        if not room_id or not userId:
            return

        sio.enter_room(room_id)
        room_users[room_id][request.sid] = {
            'userId': userId,
            'avatar': avatar,
            'position': data.get('position', '0 1.6 0'),
            'rotation': data.get('rotation', '0 0 0'),
            'leftHand': None,
            'rightHand': None,
            'handTracking': False
        }

        # Send current room state to the new joiner
        existing_users = [
            {**u, 'sid': sid}
            for sid, u in room_users[room_id].items()
            if sid != request.sid
        ]
        sio.emit('room_state', {
            'users': existing_users,
            'room_id': room_id
        }, room=request.sid)

        # Notify others
        sio.emit('user_joined', {
            'userId': userId,
            'avatar': avatar,
            'room_id': room_id
        }, room=room_id, skip_sid=request.sid)

        print(f'[PositionSync] {userId} joined room {room_id} ({len(room_users[room_id])} users)')

    @sio.on('leave_position_room')
    def on_leave(data):
        room_id = data.get('room_id')
        if not room_id or room_id not in room_users:
            return

        user = room_users[room_id].pop(request.sid, None)
        sio.leave_room(room_id)

        if user:
            sio.emit('user_left', {
                'userId': user['userId'],
                'room_id': room_id
            }, room=room_id)

    @sio.on('position_update')
    def on_position_update(data):
        """Receive position update from a client, broadcast to others in room."""
        room_id = data.get('room_id')
        if not room_id or room_id not in room_users:
            return

        sid = request.sid
        if sid not in room_users[room_id]:
            return

        # Update local state
        user = room_users[room_id][sid]
        user['position'] = data.get('position', user['position'])
        user['rotation'] = data.get('rotation', user['rotation'])
        user['leftHand'] = data.get('leftHand')
        user['rightHand'] = data.get('rightHand')
        user['handTracking'] = data.get('handTracking', user['handTracking'])

        # Broadcast to all OTHER clients in the room
        broadcast_data = {
            'userId': user['userId'],
            'avatar': user['avatar'],
            'position': user['position'],
            'rotation': user['rotation'],
            'leftHand': user['leftHand'],
            'rightHand': user['rightHand'],
            'handTracking': user['handTracking'],
            'room_id': room_id
        }
        sio.emit('position_update', broadcast_data, room=room_id, skip_sid=request.sid)

    @sio.on('request_room_state')
    def on_request_state(data):
        """Re-send full room state to requesting client."""
        room_id = data.get('room_id')
        if not room_id or room_id not in room_users:
            return

        existing_users = [
            {**u, 'sid': sid}
            for sid, u in room_users[room_id].items()
            if sid != request.sid
        ]
        sio.emit('room_state', {
            'users': existing_users,
            'room_id': room_id
        }, room=request.sid)


# ─── Legacy HTTP endpoints (kept for backward compat, can be removed later) ───

def get_position_rooms():
    """Return serializable dict of current rooms for HTTP fallback."""
    return {
        room_id: {
            sid: {
                'userId': u['userId'],
                'avatar': u['avatar'],
                'position': u['position'],
                'rotation': u['rotation'],
                'leftHand': u['leftHand'],
                'rightHand': u['rightHand'],
                'handTracking': u['handTracking']
            }
            for sid, u in users.items()
        }
        for room_id, users in room_users.items()
    }
