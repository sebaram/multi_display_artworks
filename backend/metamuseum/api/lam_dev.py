"""Explicitly configured private LAM browser packages; input photos are never served."""
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import FileResponse
from ..auth import no_store, require_csrf
from .gaussian_dev import Unlock, lock, preview_status, research_root, unlock_preview

router = APIRouter(prefix='/api/v1/dev/lam-avatar', include_in_schema=False,
                   dependencies=[Depends(no_store)])
FILES = frozenset({'manifest.json', 'avatar.zip'})


@router.get('/status')
def status(request: Request):
    return preview_status(request, 'lam_avatar_root', FILES)


@router.post('/unlock', dependencies=[Depends(require_csrf)])
def unlock(body: Unlock, request: Request):
    return unlock_preview(body, request, 'lam_avatar_root')


@router.delete('/unlock', dependencies=[Depends(require_csrf)])
def relock(request: Request):
    return lock(request)


@router.api_route('/{name}', methods=['GET', 'HEAD'])
def asset(name: str, request: Request):
    root = research_root(request, 'lam_avatar_root')
    target = (root / name).resolve()
    if name not in FILES or not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(404, 'not_found')
    return FileResponse(target, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
