"""Streaming management for live video walls.

Supports:
- Browser MediaRecorder → Flask (phone camera streaming)
- RTSP → HLS via FFmpeg (IP cameras)
- Serves HLS playlists and segments
"""

import os
import subprocess
import threading
import time
import shutil
from pathlib import Path

STREAM_DIR = Path(__file__).parent.parent.parent / 'streams'
STREAM_DIR.mkdir(exist_ok=True)

# Active FFmpeg processes per stream
active_ffmpeg = {}


def start_rtsp_to_hls(stream_id, rtsp_url):
    """Start FFmpeg converting RTSP stream to HLS segments."""
    stream_path = STREAM_DIR / stream_id
    stream_path.mkdir(exist_ok=True)

    playlist_path = stream_path / 'playlist.m3u8'
    segment_path = stream_path / 'segment%03d.ts'

    cmd = [
        'ffmpeg',
        '-rtsp_transport', 'tcp',
        '-i', rtsp_url,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-b:v', '1000k',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments',
        '-hls_segment_filename', str(segment_path),
        str(playlist_path)
    ]

    proc = subprocess.Popen(cmd, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
    active_ffmpeg[stream_id] = proc
    return True


def stop_stream(stream_id):
    """Stop an active stream."""
    if stream_id in active_ffmpeg:
        proc = active_ffmpeg.pop(stream_id)
        proc.terminate()
        proc.wait(timeout=5)

    # Clean up files
    stream_path = STREAM_DIR / stream_id
    if stream_path.exists():
        shutil.rmtree(stream_path)


def get_stream_url(stream_id):
    """Get HLS playlist URL for a stream."""
    return f'/stream/playlist/{stream_id}'


def save_mediarecorder_chunk(stream_id, chunk_data, chunk_idx):
    """Save a MediaRecorder chunk (from browser) as a .ts segment."""
    stream_path = STREAM_DIR / stream_id
    stream_path.mkdir(exist_ok=True)

    segment_file = stream_path / f'{stream_id}_{chunk_idx}.ts'
    with open(segment_file, 'wb') as f:
        f.write(chunk_data)

    # Update playlist
    playlist_file = stream_path / 'playlist.m3u8'
    segment_count = chunk_idx + 1
    max_segments = 10

    with open(playlist_file, 'w') as f:
        f.write('#EXTM3U\n')
        f.write('#EXT-X-VERSION:3\n')
        f.write('#EXT-X-TARGETDURATION:5\n')
        f.write('#EXT-X-MEDIA-SEQUENCE:0\n')
        for i in range(max(0, segment_count - max_segments), segment_count):
            f.write(f'#EXTINF:2.0,\n')
            f.write(f'{stream_id}_{i}.ts\n')
        f.write('#EXT-X-ENDLIST\n')

    return str(segment_file)
