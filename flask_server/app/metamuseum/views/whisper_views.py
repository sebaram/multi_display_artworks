# -*- coding: utf-8 -*-
"""Whisper API transcription — audio blob → text."""
import tempfile
import os
import logging
import json
import uuid
import urllib.request
import urllib.error
from flask import Blueprint, request, jsonify
from metamuseum.models import WhisperConfig

logger = logging.getLogger(__name__)
bp = Blueprint('whisper', __name__, url_prefix='/api')


@bp.route('/transcribe', methods=['POST'])
def transcribe():
    """Receive audio blob, transcribe via Whisper API, return text."""
    config = WhisperConfig.get_active()

    if not config or not config.enabled:
        return jsonify({'error': 'Whisper not enabled'}), 400

    if 'audio' not in request.files and 'audio_data' not in request.form:
        return jsonify({'error': 'audio required'}), 400

    try:
        # Save temp audio file
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp:
            tmp_path = tmp.name
            if 'audio' in request.files:
                request.files['audio'].save(tmp_path)
            else:
                # base64 encoded
                import base64
                data = request.form.get('audio_data', '')
                tmp.write(base64.b64decode(data))

        # Call Whisper API
        result_text = call_whisper(config, tmp_path)

        # Cleanup
        os.unlink(tmp_path)

        if result_text is None:
            return jsonify({'error': 'Transcription failed'}), 500

        return jsonify({
            'text': result_text,
            'language': config.language or 'auto'
        })

    except Exception as e:
        logger.error(f'Transcribe error: {e}')
        return jsonify({'error': str(e)}), 500


@bp.route('/whisper-config', methods=['GET', 'PUT'])
def whisper_config_endpoint():
    """Get or update Whisper config (admin only)."""
    from flask_login import current_user
    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403

    config = WhisperConfig.get_active()

    if request.method == 'GET':
        if config:
            return jsonify({
                'provider': config.provider,
                'api_base': config.api_base,
                'model': config.model,
                'language': config.language,
                'enabled': config.enabled
            })
        return jsonify({
            'provider': '',
            'api_base': '',
            'model': 'whisper-1',
            'language': '',
            'enabled': False
        })

    # PUT
    data = request.json
    config = WhisperConfig.set_config(
        provider=data.get('provider', 'openai'),
        api_base=data.get('api_base', 'https://api.openai.com/v1'),
        api_key=data.get('api_key', ''),
        model=data.get('model', 'whisper-1'),
        language=data.get('language', ''),
        enabled=data.get('enabled', False)
    )
    return jsonify({'status': 'ok', 'enabled': config.enabled})


def call_whisper(config, audio_path):
    """Call Whisper API (OpenAI-compatible endpoint)."""
    url = f"{config.api_base.rstrip('/')}/audio/transcriptions"
    boundary = uuid.uuid4().hex

    with open(audio_path, 'rb') as f:
        audio_bytes = f.read()

    # Build multipart/form-data body manually (stdlib has no multipart helper)
    crlf = b'\r\n'
    parts = []

    def add_field(name, value):
        parts.append(f'--{boundary}{crlf.decode()}'.encode())
        parts.append(f'Content-Disposition: form-data; name="{name}"{crlf.decode() * 2}'.encode())
        parts.append(f'{value}{crlf.decode()}'.encode())

    add_field('model', config.model)
    if config.language:
        add_field('language', config.language)

    parts.append(f'--{boundary}{crlf.decode()}'.encode())
    parts.append(f'Content-Disposition: form-data; name="file"; filename="audio.webm"{crlf.decode()}'.encode())
    parts.append(f'Content-Type: audio/webm{crlf.decode() * 2}'.encode())
    parts.append(audio_bytes)
    parts.append(crlf)
    parts.append(f'--{boundary}--{crlf.decode()}'.encode())

    body = b''.join(parts)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            'Authorization': f'Bearer {config.api_key}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        return result.get('text', '').strip()
    except urllib.error.HTTPError as e:
        err_body = ''
        try:
            err_body = e.read().decode('utf-8', 'ignore')[:300]
        except Exception:
            pass
        logger.error(f'Whisper HTTP error {e.code}: {err_body}')
        return None
    except Exception as e:
        logger.error(f'Whisper call failed: {e}')
        return None
