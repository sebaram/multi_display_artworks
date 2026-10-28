import time
from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from ..auth import require_admin
from ..schemas_wall_design import PresetCreate, PresetPatch, ApplyDesign, PresetRead, AppliedWallDesign
from ..services import wall_designs as service

router = APIRouter(prefix='/api/v1', tags=['wall designs'])

@router.get('/wall-presets', response_model=list[PresetRead])
def list_presets():
    return [service.preset_dto(p) for p in service.collection('presets').find().sort('created_at', 1)]

@router.post('/wall-presets', response_model=PresetRead, status_code=201, dependencies=[Depends(require_admin)])
def create(body: PresetCreate):
    return service.create(body.name, body.config, body.thumbnail_asset_id)

@router.post('/wall-presets/import', response_model=PresetRead, status_code=201, dependencies=[Depends(require_admin)])
def import_preset(body: PresetCreate):
    return service.create(body.name, body.config, body.thumbnail_asset_id, raw=True)

@router.get('/wall-presets/{identifier}', response_model=PresetRead)
def detail(identifier: str):
    return service.preset_dto(service.preset(identifier))

@router.get('/wall-presets/{identifier}/export')
def export(identifier: str):
    doc = service.preset(identifier)
    return JSONResponse({'name': doc['name'], 'config': doc['config']}, headers={'Content-Disposition': 'attachment; filename="wall-look.json"'})

@router.patch('/wall-presets/{identifier}', response_model=PresetRead, dependencies=[Depends(require_admin)])
def patch(identifier: str, body: PresetPatch):
    return service.update(identifier, body.model_dump(exclude_unset=True))

@router.delete('/wall-presets/{identifier}', status_code=204, dependencies=[Depends(require_admin)])
def delete(identifier: str, expected_revision: int = Query(ge=1)):
    service.delete(identifier, expected_revision)
    return Response(status_code=204)

@router.get('/walls/{identifier}/design', response_model=AppliedWallDesign | None)
def design(identifier: str):
    return service.get_binding(identifier)

@router.put('/walls/{identifier}/design', response_model=AppliedWallDesign, dependencies=[Depends(require_admin)])
async def apply(identifier: str, body: ApplyDesign, request: Request):
    result = await run_in_threadpool(service.apply, identifier, body.model_dump())
    realtime = getattr(request.app.state, 'realtime', None)
    if realtime: await realtime.broadcast('wall.design_applied', {**result, 'server_time_ms': int(time.time() * 1000)}, room_id=result['room_id'])
    return result

@router.delete('/walls/{identifier}/design', status_code=204, dependencies=[Depends(require_admin)])
async def unbind(identifier: str, request: Request, expected_revision: int = Query(ge=1)):
    room = await run_in_threadpool(service.unbind, identifier, expected_revision)
    realtime = getattr(request.app.state, 'realtime', None)
    if realtime: await realtime.broadcast('wall.design_removed', {'wall_id': identifier, 'room_id': room, 'revision': expected_revision + 1, 'server_time_ms': int(time.time() * 1000)}, room_id=room)
    return Response(status_code=204)
