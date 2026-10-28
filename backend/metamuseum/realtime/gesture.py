"""Legacy gesture socket/HTTP relay and bounded, cancellable SSE subscribers."""
import asyncio
import json
import time

from fastapi import Request
from starlette.responses import JSONResponse, StreamingResponse

from .server import payload


class Gesture:
    def __init__(self, realtime, http_app):
        self.sio = realtime.sio
        self.touchpoints = []
        self.result = ''
        self.subscribers = set()
        sio = self.sio

        @sio.on('gesture_mark.join')
        async def join(sid, data=None):
            await sio.enter_room(sid, 'gesture_mark')
            await sio.emit('gesture_mark.state', self.state(), to=sid)

        @sio.on('gesture_mark.touchpoint')
        async def touchpoint(sid, data):
            point = self.point(payload(data))
            self.broadcast_touchpoint(point)
            await sio.emit('gesture_mark.touchpoint', point, room='gesture_mark', skip_sid=sid)

        @sio.on('gesture_mark.gesture')
        async def gesture(sid, data):
            result = payload(data).get('result_str', '')
            self.broadcast_result(result)
            await sio.emit('gesture_mark.gesture', {'result_str': result, 'timestamp': time.time()}, room='gesture_mark', skip_sid=sid)

        @sio.on('gesture_mark.target_select')
        async def select(sid, data):
            data = payload(data)
            await sio.emit('gesture_mark.target_select', {'target_id': data.get('target_id'), 'step': data.get('step', 0), 'timestamp': time.time()}, room='gesture_mark', skip_sid=sid)

        @sio.on('gesture_mark.clear')
        async def clear(sid, data=None):
            self.touchpoints.clear()
            await sio.emit('gesture_mark.clear', {}, room='gesture_mark')

        @http_app.get('/gesture-mark/api/state', include_in_schema=False)
        async def state():
            return self.state()

        @http_app.post('/gesture-mark/api/touchpoint', include_in_schema=False)
        async def post_touchpoint(request: Request):
            data = await self.json_body(request)
            if not data:
                return JSONResponse({'error': 'JSON body required'}, status_code=400)
            self.broadcast_touchpoint(self.point(data))
            return {'status': 'ok'}

        @http_app.post('/gesture-mark/api/gesture', include_in_schema=False)
        async def post_gesture(request: Request):
            data = await self.json_body(request)
            if not data:
                return JSONResponse({'error': 'JSON body required'}, status_code=400)
            result = data.get('result_str', '')
            self.broadcast_result(result)
            return {'status': 'ok', 'gesture': result}

        @http_app.get('/gesture-mark/stream', include_in_schema=False)
        async def stream():
            return StreamingResponse(self.stream(), media_type='text/event-stream',
                                     headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    @staticmethod
    async def json_body(request):
        try:
            return payload(await request.json())
        except (ValueError, UnicodeDecodeError):
            return {}

    @staticmethod
    def point(data):
        return {'x': data.get('x', 0), 'y': data.get('y', 0), 'type': data.get('type', 'trace'),
                'pressure': data.get('pressure', .5), 'timestamp': time.time()}

    def state(self):
        return {'touchpoints': self.touchpoints[-100:], 'gesture_result': self.result}

    def publish(self, data):
        for queue in list(self.subscribers):
            if queue.full():
                # Drop the oldest sample without detaching a still-connected consumer.
                queue.get_nowait()
            queue.put_nowait(data)

    def broadcast_touchpoint(self, point):
        self.touchpoints.append(point)
        del self.touchpoints[:-500]
        self.publish(point)

    def broadcast_result(self, result):
        self.result = result
        self.publish({'datatype': 'gesture_result', 'result_str': result, 'timestamp': time.time()})

    async def stream(self):
        queue = asyncio.Queue(maxsize=200)
        self.subscribers.add(queue)
        try:
            yield ': connected\n\n'
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f'data: {json.dumps(data)}\n\n'
                except TimeoutError:
                    yield ': keepalive\n\n'
        finally:
            self.subscribers.discard(queue)
