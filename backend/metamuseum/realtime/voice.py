"""Legacy WebRTC signaling, bound to the sender's actual visitor presence."""
from .server import payload, room_id


class Voice:
    def __init__(self, realtime):
        self.realtime = realtime
        self.enabled = {}
        sio = realtime.sio

        @realtime.on('voice.admin_toggle')
        async def toggle(sid, data):
            data = payload(data)
            room = room_id(data)
            if (realtime.get_room_visitor(sid, room) and await realtime.is_admin(sid)
                    and realtime.get_room_visitor(sid, room)):
                self.enabled[room] = bool(data.get('enabled', False))
                await realtime.broadcast('voice_admin_toggle', {'room_id': room, 'enabled': self.enabled[room]}, room_id=room)

        @realtime.on('voice.get_state')
        async def state(sid, data):
            room = room_id(data)
            if realtime.get_room_visitor(sid, room):
                await sio.emit('voice_admin_toggle', {'room_id': room, 'enabled': self.enabled.get(room, False)}, to=sid)

        for event in ['voice.offer', 'voice.answer', 'voice.ice']:
            self._register_signal(event)
        for event in ['voice.join', 'voice.leave', 'voice.mute', 'voice.transcript']:
            self._register_broadcast(event)

    async def left(self, room, visitor_id, sid):
        await self.realtime.broadcast('voice.leave', {'room_id': room, 'userId': visitor_id}, room_id=room, skip_sid=sid)

    def _register_signal(self, event):
        realtime = self.realtime

        @realtime.on(event)
        async def signal(sid, data):
            data = payload(data)
            room = room_id(data)
            identity = realtime.get_room_visitor(sid, room)
            target = data.get('target')
            target_sid = realtime.presence.sid_for_user(room, target) if isinstance(target, str) else None
            if not identity or not target_sid:
                return
            keys = ['candidate'] if event == 'voice.ice' else ['sdp', 'type']
            message = {'room_id': room, 'from': identity.visitor_id, 'target': target}
            message.update({key: data.get(key) for key in keys})
            await realtime.sio.emit(event, message, to=target_sid)

    def _register_broadcast(self, event):
        realtime = self.realtime

        @realtime.on(event)
        async def relay(sid, data):
            data = payload(data)
            room = room_id(data)
            identity = realtime.get_room_visitor(sid, room)
            if not identity:
                return
            message = {'room_id': room, 'userId': identity.visitor_id}
            if event == 'voice.mute':
                message['muted'] = bool(data.get('muted'))
            if event == 'voice.transcript':
                message.update(text=data.get('text', ''), language=data.get('language', 'auto'))
            await realtime.broadcast(event, message, room_id=room, skip_sid=sid)
