"""Compatibility adapters for gallery links and their existing JSON mutations."""
import hashlib
import json
from pathlib import Path
from urllib.parse import parse_qs, quote

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from starlette.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

from ..auth import admin_from_session, require_admin
from ..models import LocationPreset, Marker
from ..services import gallery as service

router = APIRouter(include_in_schema=False)
LEGACY_RESOURCES = {'room':'rooms', 'wall':'walls', 'image':'images', 'gaussiansplat':'splats',
                    'gltfmodel':'gltfs', 'webpage':'webpages', 'locationpreset':'locations',
                    'roomeffect':'effects', 'marker':'markers', 'mm_marker_admin':'markers',
                    'llmconfig':'llm-configs', 'whisperconfig':'whisper-configs'}


def spa(request):
    root = request.app.state.settings.frontend_root
    if root and (Path(root) / 'index.html').is_file():
        return FileResponse(Path(root) / 'index.html', headers={'Cache-Control':'no-cache'})
    return HTMLResponse('<!doctype html><html lang="ko"><head><title>MetaMuseum</title></head>'
                        '<body><main id="root">MetaMuseum UI build is unavailable.</main></body></html>')


@router.get('/')
@router.get('/signin')
@router.get('/logout')
def home(request: Request):
    return spa(request)


@router.get('/room')
def room(request: Request, room_id: str | None = None):
    if room_id is None:
        raise HTTPException(400, 'room_id_required')
    service.get('rooms', room_id)
    return spa(request)


@router.get('/wall')
def wall(request: Request, wall_id: str | None = None):
    if wall_id is None:
        raise HTTPException(400, 'wall_id_required')
    document = service.get('walls', wall_id)
    # Content hash includes ordered artworks as well as the persisted wall timestamp.
    etag = '"' + hashlib.sha256(json.dumps(service.wall_dto(document), sort_keys=True).encode()).hexdigest() + '"'
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers={'ETag':etag})
    response = spa(request)
    response.headers['ETag'] = etag
    if document.updated_time:
        response.headers['Last-Modified'] = document.updated_time.strftime('%a, %d %b %Y %H:%M:%S GMT')
    return response


@router.get('/element')
def element(request: Request, wall_element_id: str | None = None, type: str | None = None):
    if wall_element_id is None or type not in service.ELEMENTS:
        raise HTTPException(400, 'element_id_and_type_required')
    service.get(service.ELEMENTS[type], wall_element_id)
    return spa(request)


@router.get('/kwanri')
@router.get('/kwanri/{path:path}')
def admin_page(request: Request, path: str = ''):
    if admin_from_session(request.session) is None:
        return RedirectResponse('/signin?next=' + quote(request.url.path + ('?' + request.url.query if request.url.query else ''), safe=''), status_code=302)
    if path and path.strip('/').split('/')[0] not in {*LEGACY_RESOURCES, *service.RESOURCES}:
        raise HTTPException(404, 'unknown_resource')
    parts = path.strip('/').split('/')
    if len(parts) > 1 and ('/'.join(parts[1:]).startswith(('export/', 'api/file', 'ajax/lookup'))):
        raise HTTPException(410, 'legacy_admin_operation_retired')
    return spa(request)


@router.patch('/element/{identifier}/{element_type}', dependencies=[Depends(require_admin)])
def update_element(identifier: str, element_type: str, data: dict = Body(...)):
    if element_type not in service.ELEMENTS:
        raise HTTPException(400, 'unknown_element_type')
    service.save(service.ELEMENTS[element_type], data, identifier)
    return {'status':'success', 'element_id':identifier}


@router.get('/room/{identifier}/presets')
def presets(identifier: str):
    room = service.get('rooms', identifier)
    return [p.to_dict() for p in LocationPreset.objects(room=room)]


@router.post('/room/{identifier}/preset', dependencies=[Depends(require_admin)])
def create_preset(identifier: str, data: dict = Body(...)):
    service.get('rooms', identifier)
    values = {'position_x':0.0, 'position_y':1.6, 'position_z':0.0, **data, 'room':identifier}
    document = service.save('locations', values)
    return {'status':'success', 'preset':document.to_dict()}


@router.delete('/preset/{identifier}', dependencies=[Depends(require_admin)])
def delete_preset(identifier: str):
    service.delete('locations', identifier)
    return {'status':'success'}


@router.get('/room/{identifier}/boundary')
def boundary(identifier: str):
    return service.boundary(service.get('rooms', identifier))


@router.get('/marker/room/{identifier}/markers')
def markers(identifier: str):
    room = service.get('rooms', identifier)
    return [m.to_dict() for m in Marker.objects(room=room, is_active=True)]


@router.get('/marker/by-value/{marker_type}/{marker_value:path}')
def marker_by_value(marker_type: str, marker_value: str):
    document = Marker.objects(marker_type=marker_type, marker_value=marker_value, is_active=True).first()
    if document is None:
        raise HTTPException(404, 'document_not_found')
    return document.to_dict()


@router.get('/marker/{identifier}/config')
def marker_config(identifier: str):
    return service.get('markers', identifier).to_dict()


@router.put('/marker/{identifier}', dependencies=[Depends(require_admin)])
def update_marker(identifier: str, data: dict = Body(...)):
    values = dict(data)
    if 'target_preset_id' in values:
        values['target_preset'] = values.pop('target_preset_id')
    return service.save('markers', values, identifier).to_dict()


@router.delete('/marker/{identifier}', dependencies=[Depends(require_admin)])
def delete_marker(identifier: str):
    service.delete('markers', identifier)
    return {'status':'deleted'}


def admin_mutation(resource, action, data, identifier, *, form=False):
    slug = LEGACY_RESOURCES.get(resource, resource)
    model = service.model_for(slug)
    if action == 'action':
        if data.get('action') != 'delete':
            raise HTTPException(400, 'unknown_action')
        identifiers = data.get('rowid', [])
        identifiers = identifiers if isinstance(identifiers, list) else [identifiers]
        if len(identifiers) > 200:
            raise HTTPException(422, 'too_many_selected_documents')
        for selected in identifiers:
            service.ensure_deletable(service.get(slug, selected))
        for selected in identifiers:
            service.delete(slug, selected)
    elif action == 'delete':
        service.delete(slug, identifier or data.get('id'))
    elif action in {'new', 'edit', 'ajax/update'}:
        values = dict(data)
        if action == 'ajax/update':
            identifier = values.get('pk')
            name = values.get('name')
            if not isinstance(name, str):
                raise HTTPException(422, 'field_name_required')
            values = {name:values.get('value')}
        else:
            values.pop('id', None)
            values.pop('_continue_editing', None)
            values.pop('_add_another', None)
            values.pop('csrf_token', None)
        if form:
            from mongoengine import BooleanField, FloatField, IntField, DictField
            for name, value in values.items():
                field = model._fields.get(name)
                try:
                    if isinstance(field, BooleanField):
                        if value not in {'true', 'false', '1', '0', 'on', 'off', ''}:
                            raise ValueError
                        values[name] = value in {'true', '1', 'on'}
                    elif isinstance(field, FloatField):
                        values[name] = float(value)
                    elif isinstance(field, IntField):
                        values[name] = int(value)
                    elif isinstance(field, DictField):
                        values[name] = json.loads(value)
                except (ValueError, TypeError):
                    raise HTTPException(422, 'invalid_form_field') from None
        if action != 'new' and not identifier:
            raise HTTPException(400, 'id_required')
        service.save(slug, values, identifier if action != 'new' else None)
        if action == 'ajax/update':
            return {'status':'success'}
    else:
        raise HTTPException(410, 'legacy_admin_operation_retired')
    return RedirectResponse('/kwanri/' + resource + '/', status_code=303)


@router.post('/kwanri/{resource}/{action:path}', dependencies=[Depends(require_admin)])
async def legacy_admin_mutation(resource: str, action: str, request: Request):
    is_form = request.headers.get('content-type', '').split(';')[0] == 'application/x-www-form-urlencoded'
    try:
        if is_form:
            fields = parse_qs((await request.body()).decode(), keep_blank_values=True)
            data = {k:v if k == 'rowid' else v[-1] for k,v in fields.items()}
        else:
            data = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, 'invalid_request_body') from None
    if not isinstance(data, dict):
        raise HTTPException(422, 'object_required')
    return await run_in_threadpool(admin_mutation, resource, action.strip('/'), data,
                                   request.query_params.get('id'), form=is_form)
