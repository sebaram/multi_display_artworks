"""Display sockets use an in-memory Socket.IO manager; no DB/lifespan fixtures."""
import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metamuseum.asgi import create_app, create_realtime_app
from metamuseum.config import Settings

WALL = '00000000000000000000000b'
ROOM = '000000000000000000000001'


def design(revision=1):
    return dict(wall_id=WALL, room_id=ROOM, revision=revision,
                config={'state': {'interactive': True}}, seed=2, animation_epoch_ms=1000,
                playback=dict(wall_id=WALL, binding_revision=revision, revision=1,
                              playing=False, position_seconds=2, rate=1, state_time_ms=1000))


class WallDisplayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = create_app(Settings(secret_key='display-unit-test-secret',
                                  security_password_salt='display-unit-salt'))
        create_realtime_app(app)
        self.rt = app.state.realtime
        self.assertIn('wall.watch', self.rt.sio.handlers['/'])
        self.sid = await self.rt.sio.manager.connect('display-eio', '/')
        self.rt.sio.emit = AsyncMock()
        self.rt.database_call = AsyncMock(return_value={'room_id': ROOM, 'binding': design()})

    async def asyncTearDown(self):
        await self.rt.wall_interactions.stop()

    async def watch(self):
        return await self.rt.sio.handlers['/']['wall.watch'](self.sid, {'wall_id': WALL})

    async def test_public_display_gets_snapshot_without_visitor_or_write_authority(self):
        result = await self.watch()
        self.assertTrue(result['ok'])
        self.assertEqual(self.rt.visitors, {})
        self.assertEqual(self.rt.presence.rooms, {})
        snapshots = [call.args[1] for call in self.rt.sio.emit.call_args_list if call.args[0] == 'wall.snapshot']
        self.assertEqual(snapshots[0]['walls'][0]['design']['wall_id'], WALL)
        interaction = await self.rt.sio.handlers['/']['wall.interaction'](self.sid,
            dict(wall_id=WALL, binding_revision=1, client_seq=1, kind='move', uv={'u': .5, 'v': .5}))
        self.assertEqual(interaction['status'], 403)
        playback = await self.rt.sio.handlers['/']['wall.playback_command'](self.sid,
            dict(wall_id=WALL, binding_revision=1, expected_playback_revision=1, action='play'))
        self.assertEqual(playback['status'], 403)

    async def test_only_wall_events_are_fanned_out_to_the_scoped_display_channel(self):
        await self.watch()
        self.rt.sio.emit.reset_mock()
        await self.rt.broadcast('wall.playback_state', design()['playback'], room_id=ROOM)
        calls = self.rt.sio.emit.call_args_list
        self.assertTrue(any(call.kwargs.get('room') == 'wall-display:' + WALL for call in calls))
        self.rt.sio.emit.reset_mock()
        await self.rt.broadcast('position_update', {'room_id': ROOM, 'userId': 'other'}, room_id=ROOM)
        self.assertFalse(any(call.kwargs.get('room', '').startswith('wall-display:') for call in self.rt.sio.emit.call_args_list))

    async def test_disconnect_during_lookup_cannot_rejoin_or_emit_a_snapshot(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(*args):
            entered.set(); await release.wait()
            return {'room_id': ROOM, 'binding': design()}
        self.rt.database_call = delayed
        pending = asyncio.create_task(self.watch())
        await asyncio.wait_for(entered.wait(), 1)
        self.rt.wall_displays.disconnected(self.sid)
        await self.rt.sio.manager.disconnect(self.sid, '/')
        release.set()
        self.assertFalse((await pending)['ok'])
        self.assertFalse(self.rt.sio.emit.called)

    async def test_old_lookup_does_not_overwrite_newer_design_or_playback(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(*args):
            entered.set(); await release.wait()
            return {'room_id': ROOM, 'binding': design()}
        self.rt.database_call = delayed
        pending = asyncio.create_task(self.watch())
        await asyncio.wait_for(entered.wait(), 1)
        await self.rt.broadcast('wall.design_applied', design(2), room_id=ROOM)
        self.rt.wall_interactions.bindings[WALL]['playback']['revision'] = 3
        release.set(); self.assertTrue((await pending)['ok'])
        snapshots = [call.args[1] for call in self.rt.sio.emit.call_args_list if call.args[0] == 'wall.snapshot']
        self.assertEqual(snapshots[-1]['walls'][0]['design']['revision'], 2)
        self.assertEqual(snapshots[-1]['walls'][0]['design']['playback']['revision'], 3)


if __name__ == '__main__':
    unittest.main()
