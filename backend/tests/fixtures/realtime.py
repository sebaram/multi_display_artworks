import asyncio
from types import SimpleNamespace

import pytest_asyncio
import socketio
import uvicorn
import httpx2


class Events:
    def __init__(self, visitor):
        self.visitor = visitor
        self.queue = asyncio.Queue()
        self.history = []

    async def receive(self, event, data):
        self.history.append((event, data))
        self.queue.put_nowait((event, data))


async def wait_event(events, name):
    async with asyncio.timeout(3):
        while True:
            event, data = await events.queue.get()
            if event == name:
                return data


async def peer(server, *, visitor=None, auth=None, headers=None, transport='websocket'):
    if visitor is None and auth is None:
        visitor = (await server.http.post('/api/v1/visitor-capability')).json()
    events = Events(visitor)
    client = socketio.AsyncClient(reconnection=False)
    client.on('*', events.receive)
    server.clients.append(client)
    try:
        await client.connect(server.url, auth=auth if auth is not None else {'visitorCapability': visitor['capability']},
                             headers=dict(headers or {}), transports=[transport])
    except BaseException:
        await client.eio.disconnect(abort=True)
        raise
    return client, events


@pytest_asyncio.fixture
async def live_realtime(app, unused_tcp_port):
    from metamuseum.asgi import create_realtime_app
    url = f'http://127.0.0.1:{unused_tcp_port}'
    config = uvicorn.Config(create_realtime_app(app), host='127.0.0.1', port=unused_tcp_port,
                            log_level='error', ws='websockets-sansio')
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(8):
            while not server.started:
                if task.done():
                    await task
                await asyncio.sleep(.01)
        async with httpx2.AsyncClient(base_url=url, timeout=5) as http:
            rooms = [r['id'] for r in (await http.get('/api/v1/rooms')).json()]
            state = SimpleNamespace(url=url, http=http, rooms=rooms, app=app, clients=[])
            try:
                yield state
            finally:
                # Server closes polling responses while the clients still read them.
                for sid in list(app.state.sio.eio.sockets):
                    await asyncio.wait_for(app.state.sio.eio.disconnect(sid), timeout=3)
                for client in state.clients:
                    if client.connected:
                        await asyncio.wait_for(client.disconnect(), timeout=3)
                    await client.eio.disconnect(abort=True)
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, 8)
