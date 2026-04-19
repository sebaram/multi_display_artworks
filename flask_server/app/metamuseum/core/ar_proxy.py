# -*- coding: utf-8 -*-
"""AR Companion WebSocket — phone detects markers, relays pose to Vision Pro."""
import json
from collections import defaultdict
from flask import request
from flask_socketio import SocketIO, emit, join_room, leave_room

# Global socketio instance (initialized in __init__.py)
socketio_instance = None

# rooms: { room_id: { phone_sids: set(), vision_pro_sids: set(), latest_pose: dict } }
ar_rooms = defaultdict(lambda: {
    'phones': set(),
    'vision_pros': set(),
    'latest_pose': None,
    'marker_config': {}
})


def init_socketio(app):
    """Initialize SocketIO with the Flask app."""
    global socketio_instance
    socketio_instance = SocketIO(
        app,
        cors_allowed_origins='*',
        async_mode='gevent',
        message_queue=None,
        channel='ar_companion'
    )
    _register_handlers(socketio_instance)
    return socketio_instance


def _register_handlers(sio):
    """Register SocketIO event handlers."""

    @sio.on('connect')
    def on_connect():
        print('[SocketIO] Client connected:', request.sid)

    @sio.on('disconnect')
    def on_disconnect():
        # Remove from all rooms
        for room_id, room in ar_rooms.items():
            room['phones'].discard(request.sid)
            room['vision_pros'].discard(request.sid)

    @sio.on('join_ar_room')
    def on_join_ar_room(data):
        """Device joins an AR room as 'phone' or 'vision_pro'."""
        from flask import request
        room_id = data.get('room_id')
        device_type = data.get('device', 'phone')  # 'phone' or 'vision_pro'

        if not room_id:
            return

        join_room(room_id)
        room = ar_rooms[room_id]

        if device_type == 'phone':
            room['phones'].add(request.sid)
            print(f'[SocketIO] Phone joined room {room_id}')
        else:
            room['vision_pros'].add(request.sid)
            print(f'[SocketIO] Vision Pro joined room {room_id}')

        # Send current pose if available (new VP client gets latest)
        if room['latest_pose'] and device_type == 'vision_pro':
            emit('pose_update', room['latest_pose'])

        emit('joined', {
            'status': 'ok',
            'room_id': room_id,
            'device': device_type,
            'phones_count': len(room['phones']),
            'vision_pros_count': len(room['vision_pros'])
        })

    @sio.on('leave_ar_room')
    def on_leave_ar_room(data):
        from flask import request
        room_id = data.get('room_id')
        if room_id and room_id in ar_rooms:
            leave_room(room_id)
            ar_rooms[room_id]['phones'].discard(request.sid)
            ar_rooms[room_id]['vision_pros'].discard(request.sid)

    @sio.on('marker_update')
    def on_marker_update(data):
        """Phone sends marker detection update (found/lost/pose)."""
        from flask import request
        room_id = data.get('room_id')
        if not room_id or room_id not in ar_rooms:
            return

        room = ar_rooms[room_id]
        update_type = data.get('update_type')  # 'found' | 'lost' | 'pose'

        if update_type == 'found':
            # Phone detected a marker
            marker_id = data.get('marker_id')
            pose = data.get('pose', {})
            marker_config = room['marker_config'].get(marker_id, {})

            room['latest_pose'] = {
                'type': 'pose_update',
                'marker_id': marker_id,
                'pose': pose,
                'target_position': marker_config.get('target_position', '0 1.6 0'),
                'target_rotation': marker_config.get('target_rotation', '0 0 0'),
                'marker_name': marker_config.get('name', marker_id),
                'found': True
            }

            # Broadcast to all Vision Pro clients in room
            sio.emit('pose_update', room['latest_pose'], room=room_id, skip_sid=request.sid)

        elif update_type == 'lost':
            room['latest_pose'] = {
                'type': 'pose_update',
                'marker_id': data.get('marker_id'),
                'found': False
            }
            sio.emit('pose_update', room['latest_pose'], room=room_id, skip_sid=request.sid)

        elif update_type == 'pose':
            # Continuous pose update (while tracking)
            room['latest_pose'] = {
                'type': 'pose_update',
                'marker_id': data.get('marker_id'),
                'pose': data.get('pose', {}),
                'found': True
            }
            sio.emit('pose_update', room['latest_pose'], room=room_id, skip_sid=request.sid)

    @sio.on('set_marker_config')
    def on_set_marker_config(data):
        """Store marker config (target positions) for a room."""
        room_id = data.get('room_id')
        markers = data.get('markers', [])

        if room_id:
            room = ar_rooms[room_id]
            for m in markers:
                room['marker_config'][m['id']] = m

    @sio.on('request_sync')
    def on_request_sync(data):
        """Vision Pro requests current state."""
        from flask import request
        room_id = data.get('room_id')
        if not room_id or room_id not in ar_rooms:
            return

        room = ar_rooms[room_id]
        emit('sync_state', {
            'latest_pose': room['latest_pose'],
            'phones_count': len(room['phones']),
            'vision_pros_count': len(room['vision_pros'])
        })
