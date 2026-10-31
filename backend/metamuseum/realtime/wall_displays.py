"""Public, read-only wall subscriptions without room visitor membership."""
import copy
import time

from fastapi import HTTPException
from pymongo.errors import PyMongoError

from ..services import gallery, wall_designs


def channel(wall):
    return 'wall-display:' + wall


def read_display(wall):
    document = gallery.get('walls', wall)
    return {'room_id': str(document.room.pk), 'binding': wall_designs.get_binding(wall)}


class WallDisplays:
    def __init__(self, realtime):
        self.realtime = realtime
        self.walls = {}
        self.pending = {}
        self.requests = {}
        realtime.on('wall.watch')(self.watch)

    def disconnected(self, sid):
        self.walls.pop(sid, None)
        self.pending.pop(sid, None)
        self.requests.pop(sid, None)

    def clear(self):
        self.walls.clear()
        self.pending.clear()
        self.requests.clear()

    async def watch(self, sid, data):
        rt = self.realtime
        token = object()
        try:
            if not isinstance(data, dict):
                raise HTTPException(422, 'wall_id_required')
            wall = str(gallery.object_id(data.get('wall_id')))
            if not rt.sio.manager.is_connected(sid, '/'):
                raise HTTPException(410, 'display_disconnected')
            now = time.monotonic()
            if now - self.requests.get(sid, float('-inf')) < .25:
                raise HTTPException(429, 'display_watch_rate_limited')
            self.requests[sid] = now
            self.pending[sid] = token
            interaction = rt.wall_interactions
            version = interaction.versions.get(wall, 0)
            loaded = await rt.database_call(read_display, wall)
            def current():
                return (self.pending.get(sid) is token and not rt.stopping
                        and rt.sio.manager.is_connected(sid, '/'))
            if not current():
                return {'ok': False, 'status': 410, 'detail': 'display_disconnected'}
            old = self.walls.get(sid)
            if old and old != wall:
                await rt.sio.leave_room(sid, channel(old))
            await rt.sio.enter_room(sid, channel(wall))
            if not current():
                await rt.sio.leave_room(sid, channel(wall))
                return {'ok': False, 'status': 410, 'detail': 'display_disconnected'}
            self.walls[sid] = wall
            binding = loaded['binding']
            if interaction.versions.get(wall, 0) == version:
                cached = interaction.bindings.get(wall)
                if binding and (not cached or binding['revision'] > cached['revision']):
                    interaction.install(binding)
                elif binding and cached and binding['revision'] == cached['revision']:
                    if binding['playback']['revision'] > cached['playback']['revision']:
                        cached['playback'] = binding['playback']
                if binding:
                    binding = interaction.bindings.get(wall)
            else:
                # A suspended DB read must not restore a removed/older design.
                binding = interaction.bindings.get(wall)
            walls = [dict(design=copy.deepcopy(binding), interaction=interaction.state(wall))] if binding else []
            await rt.sio.emit('wall.snapshot', dict(room_id=binding['room_id'] if binding else loaded['room_id'],
                              server_time_ms=interaction.now(), walls=walls), to=sid)
            return {'ok': True}
        except HTTPException as error:
            return {'ok': False, 'status': error.status_code, 'detail': error.detail}
        except PyMongoError:
            return {'ok': False, 'status': 503, 'detail': 'database_unavailable'}
        finally:
            if self.pending.get(sid) is token:
                self.pending.pop(sid, None)
