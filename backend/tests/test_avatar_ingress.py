"""Bounded, in-memory actual Socket.IO binary assembly; no network attack traffic."""
import pytest
import pytest_asyncio
from socketio import packet
from unittest.mock import AsyncMock

from metamuseum.realtime.server import PacketServer
from test_presence_contract import avatar_packet


def encoded_avatar(**changes):
    return packet.Packet(packet.EVENT, data=['avatar_pose', {
        'room_id': 'room', 'generation': 'g', 'pose': {**avatar_packet(), **changes},
    }]).encode()


@pytest_asyncio.fixture
async def incoming(monkeypatch):
    sio = PacketServer()
    await sio.manager.connect('sender', '/')
    monkeypatch.setattr(sio, '_handle_event', AsyncMock())
    monkeypatch.setattr(sio, '_handle_ack', AsyncMock())
    yield sio
    await sio.shutdown()


@pytest.mark.asyncio
async def test_avatar_declared_attachment_count_is_rejected_before_retention():
    sio = PacketServer()
    await sio.manager.connect('sender', '/')
    header = packet.Packet(packet.EVENT, data=['avatar_pose', {
        'room_id': 'room', 'generation': 'g', 'pose': avatar_packet(),
    }]).encode()[0]
    header = header.replace('51-', '5100000-', 1)
    try:
        try:
            await sio._handle_eio_message('sender', header)
            # A tiny bounded probe establishes whether application validation runs
            # before assembly. The declared count is large; actual input is only8KiB.
            for _ in range(8):
                await sio._handle_eio_message('sender', b'x' * 1024)
        except ValueError:
            assert 'sender' not in sio._binary_packet
            return
        retained = sio._binary_packet['sender']
        pytest.fail(f'Pre-handler retained {len(retained.attachments)} chunks / '
                    f'{sum(len(x) for x in retained.attachments)} bytes; '
                    f'declared {retained.attachment_count} attachments')
    finally:
        await sio.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize('count', [0, 2, 65])
async def test_avatar_header_rejects_wrong_count_before_storing(incoming, count):
    header = encoded_avatar()[0].replace('51-', f'5{count}-', 1)
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', header)
    assert not incoming._binary_packet


@pytest.mark.asyncio
async def test_avatar_header_and_attachment_share_four_kib_budget(incoming):
    header = encoded_avatar(extra='x' * 3500)[0]
    assert len(header.encode()) <= 4096 < len(header.encode()) + 392
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', header)
    assert not incoming._binary_packet


@pytest.mark.asyncio
@pytest.mark.parametrize('chunk', [b'', b'x' * 391, b'x' * 393, b'x' * 4097, '2["control"]'])
async def test_invalid_avatar_chunk_clears_partial_then_valid_packet_recovers(incoming, chunk):
    encoded = encoded_avatar()
    await incoming._handle_eio_message('sender', encoded[0])
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', chunk)
    assert not incoming._binary_packet
    for part in encoded:
        await incoming._handle_eio_message('sender', part)
    incoming._handle_event.assert_awaited_once()
    assert incoming._handle_event.call_args.args[3][1]['pose']['floats'] == encoded[1]
    assert not incoming._binary_packet


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['transport', 'client-namespace', 'server-namespace', 'shutdown'])
async def test_incomplete_binary_is_cleared_by_owned_lifecycle(incoming, kind):
    await incoming._handle_eio_message('sender', encoded_avatar()[0])
    assert incoming._binary_packet
    if kind == 'transport':
        await incoming._handle_eio_disconnect('sender', 'test')
    elif kind == 'client-namespace':
        await incoming._handle_disconnect('sender', '/', 'test')
    elif kind == 'server-namespace':
        await incoming.disconnect(incoming.manager.sid_from_eio_sid('sender', '/'))
    else:
        await incoming.shutdown()
    assert not incoming._binary_packet


@pytest.mark.asyncio
async def test_generic_binary_count_and_aggregate_are_bounded_before_append(incoming):
    header = packet.Packet(packet.EVENT, data=['control', b'a', b'b']).encode()[0]
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', header.replace('52-', '565-', 1))
    incoming.eio.max_http_buffer_size = 256
    await incoming._handle_eio_message('sender', header)
    await incoming._handle_eio_message('sender', b'x' * 100)
    retained = incoming._binary_packet['sender']
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', b'y' * 200)
    assert len(retained.attachments) == 1  # oversized chunk never appended
    assert not incoming._binary_packet


@pytest.mark.asyncio
async def test_generic_header_limit_and_exact_attachment_count_boundary(incoming):
    encoded = packet.Packet(packet.EVENT, data=['control', *([b'x'] * 64)]).encode()
    for part in encoded:
        await incoming._handle_eio_message('sender', part)
    incoming._handle_event.assert_awaited_once()
    incoming.eio.max_http_buffer_size = 100
    assert len(encoded[0].encode()) > 100
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', encoded[0])
    assert not incoming._binary_packet


@pytest.mark.asyncio
async def test_pending_disconnect_cannot_start_new_partial_packet(incoming):
    sid = incoming.manager.sid_from_eio_sid('sender', '/')
    incoming.manager.pre_disconnect(sid, '/')
    with pytest.raises(ValueError):
        await incoming._handle_eio_message('sender', encoded_avatar()[0])
    assert not incoming._binary_packet


@pytest.mark.asyncio
async def test_generic_binary_ack_control_and_plain_event_keep_dispatch(incoming):
    for kind, data, ack in [(packet.ACK, [b'a', b'b'], 7),
                            (packet.EVENT, ['control', b'c', b'd'], None),
                            (packet.EVENT, ['ordinary', {'value': 1}], None)]:
        encoded = packet.Packet(kind, data=data, id=ack).encode()
        for part in encoded if isinstance(encoded, list) else [encoded]:
            await incoming._handle_eio_message('sender', part)
    incoming._handle_ack.assert_awaited_once_with('sender', None, 7, [b'a', b'b'])
    assert incoming._handle_event.await_count == 2
    assert incoming._handle_event.call_args_list[0].args[3] == ['control', b'c', b'd']


@pytest.mark.asyncio
async def test_malformed_placeholder_clears_partial(incoming):
    header = encoded_avatar()[0].replace('"num":0', '"num":2')
    await incoming._handle_eio_message('sender', header)
    with pytest.raises((IndexError, ValueError)):
        await incoming._handle_eio_message('sender', b'x' * 392)
    assert not incoming._binary_packet


@pytest.mark.parametrize('count', [20, 50])
def test_outgoing_snapshot_packet_class_keeps_many_binary_attachments(count):
    sio = PacketServer()
    data = ['room_state', {'users': [{'pose': avatar_packet()} for _ in range(count)]}]
    encoded = sio.packet_class(packet.EVENT, data=data).encode()
    assert len(encoded) == count + 1
    decoded = sio.packet_class(encoded_packet=encoded[0])
    for part in encoded[1:]:
        decoded.add_attachment(part)
    assert decoded.data == data
