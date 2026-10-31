"""Phone marker relay with separate device membership and room state."""
from fastapi import HTTPException

from .server import payload, room_id


def ar_room(room):
    return f'ar:{room}'


class AR:
    def __init__(self, realtime, http_app):
        self.rooms = {}
        self.realtime = realtime
        sio = realtime.sio

        @http_app.get('/ar-companion/status', include_in_schema=False)
        async def status(room_id: str | None = None):
            if not room_id:
                raise HTTPException(400, 'room_id required')
            room = self.rooms.get(room_id, {})
            return {'room_id': room_id, 'phones_count': len(room.get('phones', [])),
                    'vision_pros_count': len(room.get('vision_pros', [])), 'has_pose': room.get('latest_pose') is not None}

        @realtime.on('join_ar_room')
        async def join(sid, data):
            data = payload(data)
            room_id_value = room_id(data)
            device = data.get('device', 'phone')
            if device not in ('phone', 'vision_pro') or room_id_value is None:
                return
            token = realtime.begin_join(sid, 'ar', room_id_value)
            try:
                exists = await realtime.room_exists(room_id_value)
            finally:
                current = realtime.finish_join(sid, 'ar', room_id_value, token)
            if not exists or not current or realtime.stopping or not sio.manager.is_connected(sid, '/'):
                return
            room = self.rooms.setdefault(room_id_value, {'phones': set(), 'vision_pros': set(), 'latest_pose': None, 'marker_config': {}})
            # A single SID has only one device role per room.
            room['phones'].discard(sid)
            room['vision_pros'].discard(sid)
            room['phones' if device == 'phone' else 'vision_pros'].add(sid)
            await sio.enter_room(sid, ar_room(room_id_value))
            if room['latest_pose'] and device == 'vision_pro':
                await sio.emit('pose_update', room['latest_pose'], to=sid)
            await sio.emit('joined', {'status': 'ok', 'room_id': room_id_value, 'device': device,
                'phones_count': len(room['phones']), 'vision_pros_count': len(room['vision_pros'])}, to=sid)

        @realtime.on('leave_ar_room')
        async def leave(sid, data):
            room_id_value = room_id(data)
            realtime.finish_join(sid, 'ar', room_id_value)
            room = self.rooms.get(room_id_value)
            if room:
                room['phones'].discard(sid)
                room['vision_pros'].discard(sid)
                await sio.leave_room(sid, ar_room(room_id_value))

        @realtime.on('marker_update')
        async def marker(sid, data):
            data = payload(data)
            room_id_value = room_id(data)
            room = self.rooms.get(room_id_value)
            if not room or sid not in room['phones']:
                return
            update_type = data.get('update_type')
            marker_id = data.get('marker_id')
            if not isinstance(marker_id, str) or update_type not in ('found', 'lost', 'pose'):
                return
            message = {'type': 'pose_update', 'marker_id': marker_id, 'found': update_type != 'lost'}
            if update_type != 'lost':
                message['pose'] = data.get('pose', {})
            if update_type == 'found':
                config = room['marker_config'].get(marker_id, {})
                message.update(target_position=config.get('target_position', '0 1.6 0'),
                               target_rotation=config.get('target_rotation', '0 0 0'), marker_name=config.get('name', marker_id))
            room['latest_pose'] = message
            await sio.emit('pose_update', message, room=ar_room(room_id_value), skip_sid=sid)

        @realtime.on('set_marker_config')
        async def configure(sid, data):
            data = payload(data)
            room = self.rooms.get(room_id(data))
            markers = data.get('markers', [])
            if not room or sid not in room['phones'] | room['vision_pros'] or not isinstance(markers, list):
                return
            for marker in markers:
                if isinstance(marker, dict) and isinstance(marker.get('id'), str):
                    room['marker_config'][marker['id']] = marker

        @realtime.on('request_sync')
        async def sync(sid, data):
            room = self.rooms.get(room_id(data))
            if room and sid in room['phones'] | room['vision_pros']:
                await sio.emit('sync_state', {'latest_pose': room['latest_pose'], 'phones_count': len(room['phones']),
                               'vision_pros_count': len(room['vision_pros'])}, to=sid)

    def disconnect(self, sid):
        for room in self.rooms.values():
            room['phones'].discard(sid)
            room['vision_pros'].discard(sid)
