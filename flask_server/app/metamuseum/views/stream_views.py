# -*- coding: utf-8 -*-
from flask import Blueprint, Response, stream_with_context
from flask import request, send_from_directory, jsonify
import logging
import os
from pathlib import Path
from metamuseum.core.streaming import (
    start_rtsp_to_hls, stop_stream, get_stream_url,
    save_mediarecorder_chunk, active_ffmpeg, STREAM_DIR
)

logger = logging.getLogger(__name__)
bp = Blueprint('stream', __name__, url_prefix='/stream')


@bp.route('/push/<stream_id>', methods=['POST'])
def push_chunk(stream_id):
    """Receive MediaRecorder chunks from browser (phone camera streaming)."""
    if 'chunk' not in request.files:
        return 'chunk required', 400

    chunk_file = request.files['chunk']
    chunk_idx = int(request.form.get('idx', 0))

    try:
        data = chunk_file.read()
        save_mediarecorder_chunk(stream_id, data, chunk_idx)
        return jsonify({'status': 'ok', 'idx': chunk_idx})
    except Exception as e:
        logger.error(f'Chunk save error: {e}')
        return str(e), 500


@bp.route('/start-rtsp', methods=['POST'])
def start_rtsp():
    """Start RTSP→HLS conversion for an IP camera stream."""
    data = request.json
    stream_id = data.get('stream_id', 'cam1')
    rtsp_url = data.get('rtsp_url')

    if not rtsp_url:
        return jsonify({'error': 'rtsp_url required'}), 400

    try:
        start_rtsp_to_hls(stream_id, rtsp_url)
        playlist_url = get_stream_url(stream_id)
        return jsonify({'status': 'started', 'stream_id': stream_id, 'url': playlist_url})
    except Exception as e:
        logger.error(f'RTSP start error: {e}')
        return jsonify({'error': str(e)}), 500


@bp.route('/stop/<stream_id>', methods=['POST'])
def stop_stream_endpoint(stream_id):
    """Stop an active stream."""
    try:
        stop_stream(stream_id)
        return jsonify({'status': 'stopped'})
    except Exception as e:
        logger.error(f'Stop stream error: {e}')
        return jsonify({'error': str(e)}), 500


@bp.route('/playlist/<stream_id>', methods=['GET'])
def get_playlist(stream_id):
    """Serve HLS playlist file."""
    playlist_path = STREAM_DIR / stream_id / 'playlist.m3u8'
    if not playlist_path.exists():
        return 'Stream not found', 404

    def generate():
        with open(playlist_path, 'r') as f:
            yield from f

    return Response(stream_with_context(generate()),
                   mimetype='application/vnd.apple.mpegurl')


@bp.route('/segment/<stream_id>/<segment>', methods=['GET'])
def get_segment(stream_id, segment):
    """Serve HLS segment file."""
    segment_path = STREAM_DIR / stream_id / segment
    if not segment_path.exists():
        return 'Segment not found', 404

    return send_from_directory(segment_path.parent, segment)


@bp.route('/list', methods=['GET'])
def list_streams():
    """List all active and available streams."""
    active = []
    stream_path = STREAM_DIR
    if stream_path.exists():
        for d in stream_path.iterdir():
            if d.is_dir():
                has_playlist = (d / 'playlist.m3u8').exists()
                ffmpeg_running = d.name in active_ffmpeg
                active.append({
                    'stream_id': d.name,
                    'has_playlist': has_playlist,
                    'ffmpeg_running': ffmpeg_running,
                    'url': f'/stream/playlist/{d.name}' if has_playlist else None
                })
    return jsonify(active)
