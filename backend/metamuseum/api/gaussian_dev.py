"""Private research assets; remote delivery is explicitly enabled and session gated."""
import hashlib
import hmac
import time
from ipaddress import ip_address
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import FileResponse
from ..auth import no_store, require_csrf

router = APIRouter(prefix='/api/v1/dev/gaussian-avatar', include_in_schema=False, dependencies=[Depends(no_store)])
FILES = frozenset({'manifest.json', 'rig.bin', 'point_cloud.ply'})
SESSION_KEY = 'gaussian_avatar_preview'
SESSION_SECONDS = 1800


def local_access(request: Request):
    settings = request.app.state.settings
    try:
        local_client = request.client and ip_address(request.client.host).is_loopback
    except ValueError:
        local_client = False
    return (not getattr(settings, 'gaussian_avatar_remote_enabled', False)
            and settings.environment != 'production' and settings.gaussian_avatar_root and local_client
            and request.url.hostname in settings.gaussian_avatar_hosts)


def remote_access(request: Request):
    settings = request.app.state.settings
    return (getattr(settings, 'gaussian_avatar_remote_enabled', False) and settings.gaussian_avatar_root
            and settings.gaussian_avatar_access_pin and request.url.hostname in settings.gaussian_avatar_hosts)


def password_revision(settings):
    return hmac.new(settings.secret_key.encode(), settings.gaussian_avatar_access_pin.encode(), hashlib.sha256).hexdigest()


def authorized(request: Request):
    grant = request.session.get(SESSION_KEY)
    return (isinstance(grant, dict) and isinstance(grant.get('expires'), (int, float))
            and grant['expires'] > time.time() and isinstance(grant.get('revision'), str)
            and hmac.compare_digest(grant['revision'], password_revision(request.app.state.settings)))


def research_root(request: Request):
    if not local_access(request):
        if not remote_access(request):
            raise HTTPException(404, 'not_found')
        if not authorized(request):
            raise HTTPException(401, 'avatar_preview_locked')
    return Path(request.app.state.settings.gaussian_avatar_root).resolve()


@router.get('/status')
def status(request: Request):
    if not local_access(request) and not remote_access(request):
        return {'ready': False, 'scope': 'unavailable', 'reason': 'disabled'}
    root = Path(request.app.state.settings.gaussian_avatar_root).resolve()
    if not all((root / name).is_file() for name in FILES):
        return {'ready': False, 'scope': 'unavailable', 'reason': 'missing_package'}
    if not local_access(request) and not authorized(request):
        return {'ready': False, 'scope': 'password_required'}
    return {'ready': True, 'scope': 'local_research_only' if local_access(request) else 'password_protected'}


class Unlock(BaseModel):
    model_config = ConfigDict(extra='forbid')
    pin: str = Field(min_length=4, max_length=128, repr=False)


@router.post('/unlock', dependencies=[Depends(require_csrf)])
def unlock(body: Unlock, request: Request):
    if not remote_access(request):
        raise HTTPException(404, 'not_found')
    limiter = request.app.state.gaussian_avatar_limiter
    # Single-worker deployment: global budget also limits guesses from rotating addresses.
    limiter.check('preview:global', limit=20, period=300)
    limiter.check('preview:' + (request.client.host if request.client else 'unknown'), limit=5, period=300)
    settings = request.app.state.settings
    if not hmac.compare_digest(body.pin.encode(), settings.gaussian_avatar_access_pin.encode()):
        raise HTTPException(401, 'invalid_preview_pin')
    request.session[SESSION_KEY] = {'expires': time.time()+SESSION_SECONDS, 'revision': password_revision(settings)}
    return {'unlocked': True, 'expires_in': SESSION_SECONDS}


@router.delete('/unlock', dependencies=[Depends(require_csrf)])
def lock(request: Request):
    request.session.pop(SESSION_KEY, None)
    return {'unlocked': False}


@router.api_route('/{name}', methods=['GET', 'HEAD'])
def asset(name: str, request: Request):
    root = research_root(request)
    target = (root / name).resolve()
    if name not in FILES or not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, 'not_found')
    return FileResponse(target, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
