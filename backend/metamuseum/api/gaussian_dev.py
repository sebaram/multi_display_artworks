"""Opt-in private research assets via loopback or a local private-network forwarder."""
from ipaddress import ip_address
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import FileResponse

router = APIRouter(prefix='/api/v1/dev/gaussian-avatar', include_in_schema=False)
FILES = frozenset({'manifest.json', 'rig.bin', 'point_cloud.ply'})


def research_root(request: Request):
    settings = request.app.state.settings
    try:
        local_client = request.client and ip_address(request.client.host).is_loopback
    except ValueError:
        local_client = False
    if (settings.environment == 'production' or not settings.gaussian_avatar_root or not local_client
            or request.url.hostname not in settings.gaussian_avatar_hosts):
        raise HTTPException(404, 'not_found')
    return Path(settings.gaussian_avatar_root).resolve()


@router.get('/status')
def status(request: Request):
    root = research_root(request)
    return {'ready': all((root / name).is_file() for name in FILES), 'scope': 'local_research_only'}


@router.api_route('/{name}', methods=['GET', 'HEAD'])
def asset(name: str, request: Request):
    root = research_root(request)
    target = (root / name).resolve()
    if name not in FILES or not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, 'not_found')
    return FileResponse(target, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
