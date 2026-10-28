from anyio import from_thread
from fastapi import APIRouter, Body, Depends, Query, Request, Response

from ..auth import require_admin
from ..schemas import AdminSchema, DocumentDTO, DocumentPage
from ..services import gallery as service

router = APIRouter(prefix='/api/v1/admin', tags=['admin'], dependencies=[Depends(require_admin)])


def notify_wall_change(request, identifier, room=None):
    realtime = getattr(request.app.state, 'realtime', None) if request else None
    if realtime:
        from_thread.run(realtime.wall_interactions.wall_changed, identifier, room)


@router.get('/schema', response_model=AdminSchema, response_model_exclude_none=True)
def schema():
    return service.schema()


@router.get('/{resource}', response_model=DocumentPage)
def list_documents(resource: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    query = service.model_for(resource).objects
    return {'items': [service.dto(item) for item in query.skip(offset).limit(limit)], 'total': query.count()}


@router.get('/{resource}/{identifier}', response_model=DocumentDTO)
def detail(resource: str, identifier: str):
    return service.dto(service.get(resource, identifier))


@router.post('/{resource}', response_model=DocumentDTO, status_code=201)
def create(resource: str, data: dict = Body(...)):
    return service.dto(service.save(resource, data))


@router.patch('/{resource}/{identifier}', response_model=DocumentDTO)
def patch(resource: str, identifier: str, request: Request, data: dict = Body(...)):
    document = service.save(resource, data, identifier)
    if resource == 'walls' and 'room' in data:
        notify_wall_change(request, identifier, str(document.room.pk))
    return service.dto(document)


@router.delete('/{resource}/{identifier}', status_code=204)
def delete(resource: str, identifier: str, request: Request):
    service.delete(resource, identifier)
    if resource == 'walls':
        notify_wall_change(request, identifier)
    return Response(status_code=204)
