"""Server-only provider adapters and validated gallery proposals; no Flask runtime."""
import json
import http.client
import math
import logging
import smtplib
import socket
import ssl
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from email.message import EmailMessage
from threading import Lock
from urllib.parse import urlsplit

from fastapi import HTTPException
from mongoengine import Q
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .. import models as m
from . import gallery

MAX_RESPONSE = 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def endpoint(base, suffix):
    try:
        parsed = urlsplit(base)
        valid = (parsed.scheme in {'http', 'https'} and parsed.hostname and not parsed.username and not parsed.password
                 and not parsed.query and not parsed.fragment and not any(c.isspace() for c in base))
    except (ValueError, TypeError, AttributeError):
        valid = False
    if not valid:
        raise HTTPException(422, 'invalid_provider_url')
    return base.rstrip('/') + '/' + suffix


def request_json(url, payload, headers, timeout):
    request = urllib.request.Request(url, data=payload, headers=headers, method='POST')
    deadline = time.monotonic()+timeout
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=timeout) as response:
            body = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise HTTPException(504, 'provider_timeout')
                chunk = response.read1(min(65536, MAX_RESPONSE+1-len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > MAX_RESPONSE:
                    raise HTTPException(502, 'provider_response_too_large')
        if time.monotonic() >= deadline:
            raise HTTPException(504, 'provider_timeout')
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (TimeoutError, socket.timeout):
        raise HTTPException(504, 'provider_timeout') from None
    except urllib.error.HTTPError:
        raise HTTPException(502, 'provider_http_error') from None
    except urllib.error.URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise HTTPException(504, 'provider_timeout') from None
        raise HTTPException(502, 'provider_unavailable') from None
    except (ValueError, UnicodeError):
        raise HTTPException(502, 'provider_invalid_json') from None
    except (OSError, http.client.HTTPException):
        raise HTTPException(502, 'provider_unavailable') from None


def call_llm(config, system, user, *, timeout=30):
    if config is None or not config.api_key:
        raise HTTPException(503, 'llm_not_configured')
    payload = dict(model=config.model, temperature=config.temperature, max_tokens=config.max_tokens)
    headers = {'Content-Type': 'application/json'}
    if config.provider == 'anthropic':
        url = endpoint(config.api_base, 'messages')
        headers.update({'X-Api-Key': config.api_key, 'Anthropic-Version': '2023-06-01'})
        payload.update(system=system, messages=[dict(role='user', content=user)])
    elif config.provider in {'minimax', 'openai', 'openrouter'}:
        url = endpoint(config.api_base, 'chat/completions')
        headers['Authorization'] = 'Bearer ' + config.api_key
        payload['messages'] = [dict(role='system', content=system), dict(role='user', content=user)]
    else:
        raise HTTPException(422, 'unsupported_llm_provider')
    result = request_json(url, json.dumps(payload).encode(), headers, timeout)
    try:
        if config.provider == 'anthropic':
            content = ''.join(block['text'] for block in result['content'] if block.get('type') == 'text')
        else:
            content = result['choices'][0]['message']['content']
        content = content.strip()
        if config.provider == 'minimax' and content.startswith('<think>') and '</think>' in content:
            content = content.split('</think>', 1)[1].strip()
        if content.startswith('```') and content.endswith('```'):
            content = '\n'.join(content.splitlines()[1:-1])
        proposal = json.loads(content)
        if not isinstance(proposal, dict):
            raise ValueError()
        return proposal
    except (KeyError, IndexError, TypeError, AttributeError, ValueError):
        raise HTTPException(502, 'provider_invalid_proposal') from None


def transcribe(config, audio, filename, mime, *, timeout=30):
    if config.provider not in {'local', 'openai', 'minimax'}:
        raise HTTPException(422, 'unsupported_stt_provider')
    if config.provider != 'local' and not config.api_key:
        raise HTTPException(503, 'stt_not_configured')
    boundary = uuid.uuid4().hex
    body = bytearray()
    for name, value in [('model', config.model), ('language', config.language)]:
        if value:
            body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    # Ignore untrusted upload names: only preserve a known container extension.
    extension = next((ext for ext in ['webm', 'wav', 'mp3', 'mp4', 'm4a', 'ogg'] if filename.lower().endswith('.'+ext)), 'webm')
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.{extension}"\r\nContent-Type: {mime}\r\n\r\n'.encode())
    body.extend(audio)
    body.extend(f'\r\n--{boundary}--\r\n'.encode())
    headers = {'Content-Type': 'multipart/form-data; boundary='+boundary}
    if config.api_key:
        headers['Authorization'] = 'Bearer '+config.api_key
    result = request_json(endpoint(config.api_base, 'audio/transcriptions'), bytes(body), headers, timeout)
    text = result.get('text')
    if not isinstance(text, str):
        raise HTTPException(502, 'provider_invalid_transcription')
    return text


class RateLimiter:
    def __init__(self):
        self.requests = defaultdict(deque)
        self.lock = Lock()

    def check(self, identity, *, limit=12, period=60):
        now = time.monotonic()
        with self.lock:
            for key in list(self.requests):
                if not self.requests[key] or self.requests[key][-1] < now-period:
                    del self.requests[key]
            queue = self.requests[identity]
            while queue and queue[0] < now-period:
                queue.popleft()
            if len(queue) >= limit:
                raise HTTPException(429, 'rate_limit_exceeded', headers={'Retry-After': str(period)})
            queue.append(now)


class Arrangement(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, strict=True)
    element_id: str = Field(min_length=24, max_length=24)
    wall_name: str = Field(min_length=1, max_length=300)
    position_x: float
    position_y: float
    position_z: float = Field(default=0, ge=0, le=.5)


class Layout(BaseModel):
    model_config = ConfigDict(extra='forbid')
    arrangements: list[Arrangement] = Field(min_length=1, max_length=500)
    explanation: str = Field(default='', max_length=10000)


def context(room_id):
    room = gallery.get('rooms', room_id)
    walls = gallery.walls(room)
    elements = [item for wall in walls for model in (m.Image, m.GaussianSplat, m.GLTFmodel, m.Webpage)
                for item in model.objects(wall=wall)]
    return room, walls, elements


def validate_layout(proposal, room_id, *, upstream=False):
    try:
        parsed = Layout.model_validate(proposal)
    except ValidationError:
        raise HTTPException(502 if upstream else 422, 'invalid_layout_proposal') from None
    _, walls, elements = context(room_id)
    wall_map = {w.name: w for w in walls}
    element_map = {str(e.pk): e for e in elements}
    seen = set()
    for arr in parsed.arrangements:
        wall, element = wall_map.get(arr.wall_name), element_map.get(arr.element_id)
        if wall is None or element is None or arr.element_id in seen:
            raise HTTPException(502 if upstream else 422, 'layout_room_or_element_mismatch')
        if abs(arr.position_x) > wall.width/2 or abs(arr.position_y) > wall.height/2:
            raise HTTPException(502 if upstream else 422, 'layout_outside_wall_bounds')
        if wall.surface_type in {'floor', 'ceiling'} and arr.position_z != 0:
            raise HTTPException(502 if upstream else 422, 'layout_surface_depth_invalid')
        seen.add(arr.element_id)
    return parsed, wall_map, element_map


def prompt_context(room_id, instruction):
    room, walls, elements = context(room_id)
    return json.dumps({'room': room.name, 'instruction': instruction,
        'walls': [dict(name=w.name, width=w.width, height=w.height, surface_type=w.surface_type) for w in walls],
        'elements': [dict(id=str(e.pk), name=e.name, type=e.wall_element_type, wall_name=e.wall.name,
                          description=e.description) for e in elements]}, ensure_ascii=False)


LAYOUT_PROMPT = '''Arrange gallery artworks. Return only JSON: {"arrangements":[{"element_id":"provided ID","wall_name":"provided name","position_x":0,"position_y":0,"position_z":0}],"explanation":"brief reason"}. Use only supplied IDs/walls. Include all artworks. Wall-local origin is center; x is within ±width/2, y within ±height/2. Depth is 0 to 0.5, floor/ceiling depth must be 0.'''
EFFECT_PROMPT = '''Return only JSON: {"effects":[{"effect_type":"ambient","target_id":"","params":{"intensity":0.5},"description":"brief reason"}],"explanation":"brief reason"}. Use 1 to 4 effects of types glitter, spotlight, ambient, fog, sound, pulse, color_shift, shake, fade. Target IDs must come from supplied elements or walls, or empty for room. Params may contain density, color (#RRGGBB), duration (0.1 to 3600 seconds), intensity (0 to 1), volume (0 to 1), loop (boolean), type (warm/cool/dramatic/subtle/in/out), speed (slow/medium/fast), url (http/https audio URL).'''


def propose_layout(room_id, instruction, timeout):
    result = call_llm(m.LLMConfig.get_active(), LAYOUT_PROMPT, prompt_context(room_id, instruction), timeout=timeout)
    parsed, _, _ = validate_layout(result, room_id, upstream=True)
    return parsed.model_dump()


def apply_layout(room_id, arrangements):
    parsed, walls, elements = validate_layout({'arrangements': arrangements}, room_id)
    results = []
    # Validate the complete proposal before the first mutation.
    for arr in parsed.arrangements:
        element, wall = elements[arr.element_id], walls[arr.wall_name]
        payload = dict(wall=str(wall.pk), position_x=arr.position_x, position_y=arr.position_y,
                       position=f'{arr.position_x} {arr.position_y} {arr.position_z}')
        if isinstance(element, m.GLTFmodel):
            payload['position_z'] = arr.position_z
        gallery.save(gallery.ELEMENTS[element.wall_element_type], payload, str(element.pk))
        results.append(dict(id=arr.element_id, status='ok'))
    return {'results': results}


def active_effects(room_id):
    room = gallery.get('rooms', room_id)
    effects = m.RoomEffect.objects(room=room, active=True).filter(Q(expires_at=None) | Q(expires_at__gt=datetime.utcnow()))
    return [dict(effect.to_dict(), expires_at=effect.expires_at.isoformat()+'Z' if effect.expires_at else None) for effect in effects]


def validate_effects(proposal, room_id):
    import re
    _, walls, elements = context(room_id)
    targets = {'', *(str(item.pk) for item in elements), *(str(w.pk) for w in walls)}
    effects = proposal.get('effects')
    if not isinstance(effects, list) or not 1 <= len(effects) <= 4:
        raise HTTPException(502, 'invalid_effect_proposal')
    for effect in effects:
        if (not isinstance(effect, dict) or effect.get('effect_type') not in m.RoomEffect.EFFECT_TYPES
                or not isinstance(effect.get('target_id', ''), str)
                or effect.get('target_id', '') not in targets or not isinstance(effect.get('params', {}), dict)):
            raise HTTPException(502, 'invalid_effect_proposal')
        params = effect.get('params', {})
        if set(params) - {'density', 'color', 'duration', 'intensity', 'volume', 'loop', 'type', 'speed', 'url', 'target_id'}:
            raise HTTPException(502, 'invalid_effect_params')
        for key, value in params.items():
            if key in {'intensity', 'volume', 'density', 'duration'}:
                maximum = 3600 if key == 'duration' else 100 if key == 'density' and effect['effect_type']=='glitter' else 1
                minimum = .1 if key == 'duration' else 0
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
                    raise HTTPException(502, 'invalid_effect_params')
            elif key == 'color' and (not isinstance(value, str) or not re.fullmatch(r'#[0-9A-Fa-f]{6}', value)):
                raise HTTPException(502, 'invalid_effect_params')
            elif key == 'loop' and not isinstance(value, bool):
                raise HTTPException(502, 'invalid_effect_params')
            elif key == 'type' and value not in ['warm', 'cool', 'dramatic', 'subtle', 'in', 'out']:
                raise HTTPException(502, 'invalid_effect_params')
            elif key == 'speed' and value not in ['slow', 'medium', 'fast']:
                raise HTTPException(502, 'invalid_effect_params')
            elif key == 'url':
                if not isinstance(value, str) or len(value) > 2048:
                    raise HTTPException(502, 'invalid_effect_params')
                try:
                    parsed_url = urlsplit(value)
                    valid_url = parsed_url.scheme in {'http', 'https'} and parsed_url.hostname and not parsed_url.username and not parsed_url.password
                except ValueError:
                    valid_url = False
                if not valid_url:
                    raise HTTPException(502, 'invalid_effect_params')
            elif key == 'target_id' and (not isinstance(value, str) or value not in targets):
                raise HTTPException(502, 'invalid_effect_params')
        if not isinstance(effect.get('description', ''), str) or len(effect.get('description', '')) > 2000:
            raise HTTPException(502, 'invalid_effect_proposal')
    return effects


def create_effects(room_id, instruction, created_by, timeout):
    result = call_llm(m.LLMConfig.get_active(), EFFECT_PROMPT, prompt_context(room_id, instruction), timeout=timeout)
    effects = validate_effects(result, room_id)
    room = gallery.get('rooms', room_id)
    for effect in effects:
        duration = effect.get('params', {}).get('duration')
        m.RoomEffect(room=room, effect_type=effect['effect_type'], target_id=effect.get('target_id', ''),
                     params=effect.get('params', {}), description=effect.get('description', ''), created_by=created_by,
                     expires_at=datetime.utcnow()+timedelta(seconds=duration) if duration else None, active=True).save()
    return dict(effects=active_effects(room_id), explanation=str(result.get('explanation', ''))[:10000])


def send_mail(settings, recipients, title, text):
    """Synchronous SMTP adapter; callers dispatch it through the thread pool."""
    if not recipients:
        return False
    message = EmailMessage()
    message['Subject'] = '[CT-AR]' + title
    message['From'] = settings.mail_default_sender
    message['To'] = ', '.join(recipients)
    message.set_content(text)
    client = smtplib.SMTP_SSL if settings.mail_use_ssl else smtplib.SMTP
    try:
        with client(settings.mail_server, settings.mail_port, timeout=settings.provider_timeout_seconds) as smtp:
            if settings.mail_use_tls and not settings.mail_use_ssl:
                smtp.starttls(context=ssl.create_default_context())
            if settings.mail_username:
                smtp.login(settings.mail_username, settings.mail_password)
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException):
        logging.getLogger(__name__).warning('Admin mail delivery failed')
        return False


def send_this_to_admin(title, text, settings):
    recipients = [user.email for user in m.User.objects(user_type='admin')]
    return send_mail(settings, recipients, title, text)
