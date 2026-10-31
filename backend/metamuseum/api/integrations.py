"""Compatibility HTTP contracts for AI, STT and managed live media."""
import asyncio
import base64
import binascii
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse, JSONResponse, Response

from .. import models as m
from ..auth import admin_from_session, require_admin
from ..services import gallery
from ..services import providers as service

router = APIRouter(tags=['integrations'])
INTEGRATION_PATHS = {'/api/auto-layout', '/api/apply-layout', '/api/auto-effect', '/api/clear-effects',
                     '/api/transcribe', '/api/whisper-config', '/stream/start-rtsp'}


async def bounded_integration_body(request, call_next):
    path = request.url.path
    if request.method in {'POST', 'PUT'} and (path in INTEGRATION_PATHS or path.startswith('/stream/push/')):
        maximum = request.app.state.settings.integration_max_bytes if path == '/api/transcribe' or path.startswith('/stream/push/') else 65536
        try:
            if int(request.headers.get('content-length', '0')) > maximum:
                return JSONResponse({'detail': 'body_too_large'}, status_code=413)
        except ValueError:
            return JSONResponse({'detail': 'invalid_content_length'}, status_code=400)
        body = bytearray()
        try:
            async with asyncio.timeout(15):
                async for chunk in request.stream():
                    if len(body)+len(chunk) > maximum:
                        return JSONResponse({'detail': 'body_too_large'}, status_code=413)
                    body.extend(chunk)
        except TimeoutError:
            return JSONResponse({'detail': 'body_timeout'}, status_code=408)
        request._body = bytes(body)
    return await call_next(request)


class RoomRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    room_id: str = Field(min_length=24, max_length=24)


class PromptRequest(RoomRequest):
    prompt: str = Field(min_length=1, max_length=8000)


class ApplyRequest(RoomRequest):
    arrangements: list[service.Arrangement] = Field(min_length=1, max_length=500)


def rate(request, category, *, limit=12):
    identity = request.session.get('user_id') or (request.client.host if request.client else 'anonymous')
    request.app.state.integration_limiter.check((category, identity), limit=limit)
    request.app.state.integration_limiter.check((category, '*'), limit=120)


async def broadcast(request, event, data, room_id):
    if hasattr(request.app.state, 'realtime'):
        await request.app.state.realtime.broadcast(event, data, room_id=room_id)


@router.post('/api/auto-layout', dependencies=[Depends(require_admin)])
def auto_layout(body: PromptRequest, request: Request):
    if not body.prompt.strip():
        raise HTTPException(422, 'prompt_required')
    rate(request, 'llm')
    return service.propose_layout(body.room_id, body.prompt.strip(), request.app.state.settings.provider_timeout_seconds)


@router.post('/api/apply-layout', dependencies=[Depends(require_admin)])
async def apply_layout(body: ApplyRequest, request: Request):
    return await run_in_threadpool(service.apply_layout, body.room_id, [item.model_dump() for item in body.arrangements])


@router.post('/api/auto-effect')
async def auto_effect(body: PromptRequest, request: Request, user=Depends(require_admin)):
    if not body.prompt.strip():
        raise HTTPException(422, 'prompt_required')
    rate(request, 'llm')
    result = await run_in_threadpool(service.create_effects, body.room_id, body.prompt.strip(), user.name,
                                   request.app.state.settings.provider_timeout_seconds)
    await broadcast(request, 'room_effects', {'room_id': body.room_id, 'effects': result['effects']}, body.room_id)
    return result


@router.get('/api/v1/rooms/{room_id}/effects')
def effects(room_id: str):
    return service.active_effects(room_id)


@router.post('/api/clear-effects', dependencies=[Depends(require_admin)])
async def clear_effects(body: RoomRequest, request: Request):
    def clear():
        gallery.get('rooms', body.room_id)
        m.RoomEffect.clear_room(body.room_id)
    await run_in_threadpool(clear)
    await broadcast(request, 'room_effects_cleared', {'room_id': body.room_id}, body.room_id)
    return {'status': 'ok'}


def whisper_dto(config):
    return dict(provider=config.provider if config else '', api_base=config.api_base if config else '',
                model=config.model if config else 'whisper-1', language=config.language if config else '',
                enabled=bool(config and config.enabled), has_api_key=bool(config and config.api_key))


@router.get('/api/whisper-config')
def whisper_config(request: Request):
    config = m.WhisperConfig.get_active()
    if admin_from_session(request.session):
        return whisper_dto(config)
    return {'enabled': bool(config and config.enabled)}


class WhisperWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: Literal['openai', 'minimax', 'local'] | None = None
    api_base: str | None = Field(default=None, max_length=2048)
    api_key: SecretStr | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)
    language: str | None = Field(default=None, max_length=16)
    enabled: bool | None = None


@router.put('/api/whisper-config', dependencies=[Depends(require_admin)])
def put_whisper(body: WhisperWrite):
    config = m.WhisperConfig.get_active()
    values = body.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, 'null_config_field')
    if body.api_base:
        service.endpoint(body.api_base, 'audio/transcriptions')
    if config is None:
        if not {'provider', 'api_base'} <= values.keys():
            raise HTTPException(422, 'provider_and_api_base_required')
        config = m.WhisperConfig(api_key='', model='whisper-1')
    for name, value in values.items():
        if name == 'api_key':
            value = value.get_secret_value()
            if not value:
                continue  # Empty password field preserves the configured secret.
        setattr(config, name, value)
    if config.provider != 'local' and not config.api_key:
        raise HTTPException(422, 'api_key_required')
    config.save()
    return {'status': 'ok', 'enabled': config.enabled}


@router.post('/api/transcribe')
def transcribe(request: Request, audio: UploadFile | None = File(default=None), audio_data: str | None = Form(default=None)):
    rate(request, 'stt', limit=20)
    config = m.WhisperConfig.get_active()
    if config is None or not config.enabled:
        raise HTTPException(400, 'stt_disabled')
    maximum = request.app.state.settings.integration_max_bytes
    if audio:
        data = audio.file.read(maximum+1)
        mime = (audio.content_type or 'audio/webm').split(';')[0]
        filename = audio.filename or 'audio.webm'
    elif audio_data:
        try:
            data = base64.b64decode(audio_data, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(422, 'invalid_audio_data') from None
        mime, filename = 'audio/webm', 'audio.webm'
    else:
        raise HTTPException(422, 'audio_required')
    if not data or len(data) > maximum:
        raise HTTPException(413 if data else 422, 'invalid_audio_size')
    if mime not in {'audio/webm', 'video/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'video/mp4', 'audio/ogg', 'application/ogg'}:
        raise HTTPException(415, 'unsupported_audio_type')
    text = service.transcribe(config, data, filename, mime, timeout=request.app.state.settings.provider_timeout_seconds)
    return {'text': text, 'language': config.language or 'auto'}


class RTSPRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    stream_id: str = Field(default='cam1', min_length=1, max_length=64)
    rtsp_url: str = Field(min_length=1, max_length=2048, repr=False)


@router.post('/stream/start-rtsp', dependencies=[Depends(require_admin)])
def start_rtsp(body: RTSPRequest, request: Request):
    rate(request, 'stream-start', limit=10)
    request.app.state.streams.start_rtsp(body.stream_id, body.rtsp_url)
    return dict(status='started', stream_id=body.stream_id, url=f'/stream/playlist/{body.stream_id}')


@router.post('/stream/push/{stream_id}', dependencies=[Depends(require_admin)])
def push(stream_id: str, request: Request, chunk: UploadFile = File(...), idx: int = Form(0), final: bool = Form(False)):
    data = chunk.file.read(request.app.state.settings.integration_max_bytes+1)
    result = request.app.state.streams.push(stream_id, data, idx, chunk.content_type or 'application/octet-stream')
    if final:
        request.app.state.streams.finish_input(stream_id)
    return result


@router.post('/stream/stop/{stream_id}', dependencies=[Depends(require_admin)])
def stop(stream_id: str, request: Request):
    return request.app.state.streams.stop(stream_id)


@router.get('/stream/list')
def streams(request: Request):
    result = request.app.state.streams.list()
    if not admin_from_session(request.session):
        for item in result:
            item.pop('diagnostics', None)
    return result


@router.get('/stream/playlist/{stream_id}')
def playlist(stream_id: str, request: Request):
    return Response(request.app.state.streams.playlist(stream_id), media_type='application/vnd.apple.mpegurl',
                    headers={'Cache-Control': 'no-store'})


@router.get('/stream/segment/{stream_id}/{segment}')
def segment(stream_id: str, segment: str, request: Request):
    return FileResponse(request.app.state.streams.segment(stream_id, segment), media_type='video/mp2t',
                        headers={'Cache-Control': 'no-store'})
