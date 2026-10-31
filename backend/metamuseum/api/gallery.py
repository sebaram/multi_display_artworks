from fastapi import APIRouter, HTTPException, Request

from ..auth import admin_from_session
from ..models import Room
from ..schemas import DocumentDTO, RoomScene, RoomSummary
from ..services import gallery as service

router = APIRouter(prefix='/api/v1', tags=['gallery'])


@router.get('/rooms', response_model=list[RoomSummary])
def rooms():
    return [service.summary(room) for room in Room.objects]


@router.get('/rooms/{identifier}/scene', response_model=RoomScene)
def room_scene(identifier: str, request: Request, ar: str | None = None,
               preset: str | None = None, debug: str | None = None):
    return service.scene(service.get('rooms', identifier), admin=bool(admin_from_session(request.session)),
                         ar=ar, preset=preset, debug=debug)


@router.get('/walls/{identifier}', response_model=DocumentDTO)
def wall(identifier: str):
    document = service.get('walls', identifier)
    return {**service.wall_dto(document), 'room': service.summary(document.room)}


@router.get('/elements/{element_type}/{identifier}', response_model=DocumentDTO)
def element(element_type: str, identifier: str):
    resource = service.ELEMENTS.get(element_type)
    if resource is None:
        raise HTTPException(400, 'unknown_element_type')
    document = service.get(resource, identifier)
    return {**service.dto(document), 'room': str(document.wall.room.pk) if document.wall else None}
