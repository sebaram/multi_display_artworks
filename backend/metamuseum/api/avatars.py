from fastapi import APIRouter
from ..avatar_catalog import avatar_catalog
from ..schemas_avatar import AvatarCatalog

router = APIRouter(prefix='/api/v1/avatars', tags=['avatars'])

@router.get('/catalog', response_model=AvatarCatalog)
def catalog():
    return avatar_catalog()
