import importlib.util
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

import pytest


def stream_service():
    assert importlib.util.find_spec('metamuseum.services.streams'), 'stream manager missing'
    from metamuseum.services.streams import StreamManager
    return StreamManager


@pytest.fixture
def ffmpeg():
    binary = os.environ.get('FFMPEG_PATH', 'ffmpeg')
    result = subprocess.run([binary, '-version'], capture_output=True)
    assert result.returncode == 0
    return binary


def test_hls_segments_resolve_and_process_stops(tmp_path, ffmpeg):
    manager = stream_service()(tmp_path / 'streams', ffmpeg)
    source = tmp_path / 'source.mp4'
    subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15',
                    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
    manager.start_source('room1-wall1', str(source), realtime=True)
    deadline = time.monotonic()+12
    while time.monotonic() < deadline:
        if (tmp_path/'streams/room1-wall1/playlist.m3u8').exists():
            break
        time.sleep(.1)
    playlist = manager.playlist('room1-wall1')
    assert '#EXTM3U' in playlist
    segments = [line for line in playlist.splitlines() if line and not line.startswith('#')]
    assert segments and all(line.startswith('/stream/segment/room1-wall1/') for line in segments)
    for uri in segments:
        path = manager.segment('room1-wall1', Path(urlsplit(uri).path).name)
        decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-f', 'null', '-'], capture_output=True)
        assert decoded.returncode == 0, decoded.stderr
    process = manager.sessions['room1-wall1'].process
    manager.stop('room1-wall1')
    assert process.poll() is not None
    assert not (tmp_path/'streams/room1-wall1').exists()
    manager.close()


@pytest.mark.parametrize('stream_id', ['../oops', '..', 'x/y', 'x\\y', '', 'a'*65, 'CON', 'nul'])
def test_stream_paths_reject_traversal(tmp_path, stream_id):
    manager = stream_service()(tmp_path/'streams')
    with pytest.raises(Exception) as error:
        manager.stop(stream_id)
    assert getattr(error.value, 'status_code', None) == 400


@pytest.mark.parametrize('container', ['webm', 'mp4'])
def test_phone_media_is_transcoded_to_transport_stream(tmp_path, ffmpeg, container):
    manager = stream_service()(tmp_path/'streams', ffmpeg)
    source = tmp_path/('phone.'+container)
    encoding = ['-c:v', 'libvpx'] if container == 'webm' else ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov']
    subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15',
                    '-t', '5', *encoding, str(source)], check=True)
    data = source.read_bytes()
    # Later MediaRecorder chunks are continuations, not standalone WebM files.
    manager.push('phone-wall', data[:len(data)//2], 0, 'video/'+container)
    manager.push('phone-wall', data[len(data)//2:], 1, 'video/'+container)
    manager.finish_input('phone-wall')
    deadline = time.monotonic()+10
    while time.monotonic() < deadline and manager.sessions['phone-wall'].process.poll() is None:
        time.sleep(.1)
    playlist = manager.playlist('phone-wall')
    uri = next(line for line in playlist.splitlines() if line and not line.startswith('#'))
    segment = manager.segment('phone-wall', Path(uri).name)
    assert segment.read_bytes()[0] == 0x47
    decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(segment), '-f', 'null', '-'], capture_output=True)
    assert decoded.returncode == 0, decoded.stderr
    manager.close()
    assert not (tmp_path/'streams/phone-wall').exists()


def test_stream_http_aliases_and_admin_boundary(settings, tmp_path, ffmpeg):
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app
    settings.stream_root = tmp_path/'streams'
    settings.ffmpeg_path = ffmpeg
    app = create_app(settings)
    client = TestClient(app)  # No DB lifecycle needed for public stream routes.
    manager = app.state.streams
    source = tmp_path/'source.mp4'
    subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15',
                    '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], check=True)
    try:
        manager.start_source('http-wall', str(source))
        manager.sessions['http-wall'].process.wait(timeout=10)
        listing = client.get('/stream/list').json()
        assert listing[0]['has_playlist'] and 'diagnostics' not in listing[0]
        result = client.get('/stream/playlist/http-wall')
        assert result.status_code == 200 and result.headers['content-type'].startswith('application/vnd.apple.mpegurl')
        uri = next(line for line in result.text.splitlines() if line and not line.startswith('#'))
        segment = client.get(uri)
        assert segment.status_code == 200 and segment.headers['content-type'] == 'video/mp2t'
        assert segment.content[0] == 0x47
        assert client.post('/stream/stop/http-wall').status_code == 403
        assert client.post('/stream/start-rtsp', json={'stream_id':'x','rtsp_url':'rtsp://127.0.0.1/x'}).status_code == 403
        assert client.post('/stream/push/http-wall', files={'chunk': ('part.webm', b'x', 'video/webm')}).status_code == 403
        assert client.get('/stream/playlist/bad%5Cname').status_code == 400
        assert client.get('/stream/segment/http-wall/bad%5Csegment.ts').status_code == 400
    finally:
        manager.close()
        client.close()


def test_phone_rejects_wrong_container_order_and_failed_source(tmp_path, ffmpeg):
    from fastapi import HTTPException
    manager = stream_service()(tmp_path/'streams', ffmpeg)
    with pytest.raises(HTTPException) as error:
        manager.push('phone-wall', b'not-webm', 0, 'video/webm')
    assert error.value.status_code == 415
    with pytest.raises(HTTPException) as error:
        manager.push('phone-wall', b'not-webm', 1, 'video/webm')
    assert error.value.status_code == 409
    assert not manager.sessions
    try:
        manager.start_rtsp('failed-wall', 'rtsp://fixture-user:fixture-password@127.0.0.1:1/missing?secret=token')
        manager.sessions['failed-wall'].process.wait(timeout=25)
        status = manager.status('failed-wall')
        assert not status['ffmpeg_running']
        assert 'fixture-password' not in str(status) and '?secret=token' not in str(status)
        assert status['diagnostics']
    finally:
        manager.close()


@pytest.mark.skipif(not os.environ.get('RTSP_FIXTURE_URL'), reason='controlled MediaMTX fixture not requested')
def test_real_rtsp_source_produces_decodable_hls_and_stops(tmp_path, ffmpeg):
    manager = stream_service()(tmp_path/'streams', ffmpeg)
    try:
        manager.start_rtsp('rtsp-room-wall', os.environ['RTSP_FIXTURE_URL'])
        deadline = time.monotonic()+20
        while time.monotonic() < deadline and not manager.status('rtsp-room-wall')['has_playlist']:
            assert manager.sessions['rtsp-room-wall'].process.poll() is None, manager.status('rtsp-room-wall')
            time.sleep(.1)
        status = manager.status('rtsp-room-wall')
        assert status['ffmpeg_running'] and status['has_playlist'], status
        playlist = manager.playlist('rtsp-room-wall')
        segments = [line for line in playlist.splitlines() if line and not line.startswith('#')]
        assert segments
        for uri in segments:
            segment = manager.segment('rtsp-room-wall', Path(uri).name)
            decoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(segment), '-f', 'null', '-'], capture_output=True, timeout=10)
            assert decoded.returncode == 0, decoded.stderr
        process = manager.sessions['rtsp-room-wall'].process
        manager.stop('rtsp-room-wall')
        assert process.poll() is not None
        assert not manager.list()
    finally:
        manager.close()
