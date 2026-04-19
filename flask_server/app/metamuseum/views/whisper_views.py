# -*- coding: utf-8 -*-
"""Whisper API transcription — audio blob → text."""
import tempfile
import os
import logging
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
    import requests

    url = f"{config.api_base.rstrip('/')}/audio/transcriptions"

    with open(audio_path, 'rb') as f:
        files = {'file': ('audio.webm', f, 'audio/webm')}
        data = {'model': config.model}
        if config.language:
            data['language'] = config.language

        resp = requests.post(
            url,
            files=files,
            data=data,
            headers={'Authorization': f"Bearer {config.api_key}"},
            timeout=30
        )

    resp.raise_for_status()
    result = resp.json()
    return result.get('text', '').strip()
