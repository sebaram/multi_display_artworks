import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import URLSafeTimedSerializer, BadData
from mongoengine import NotUniqueError
from pymongo.errors import DuplicateKeyError
from ..avatar_catalog import avatar_catalog
from ..schemas_avatar import AvatarCatalog, AvatarProfileWrite
from ..auth import require_csrf, session_user, no_store
from ..models import AvatarProfile

router = APIRouter(prefix='/api/v1', tags=['avatars'], dependencies=[Depends(no_store)])
COOKIE = 'metamuseum_avatar_owner'
MAX_AGE = 90 * 86400

@router.get('/avatars/catalog', response_model=AvatarCatalog)
def catalog():
    return avatar_catalog()


def owner(request: Request, response: Response, *, create=False):
    settings = request.app.state.settings
    signer = URLSafeTimedSerializer(settings.secret_key, salt='avatar-owner-v1')
    try:
        key = signer.loads(request.cookies.get(COOKIE, ''), max_age=MAX_AGE)
        if not isinstance(key, str) or len(key) != 43:
            raise BadData('invalid')
    except BadData:
        if not create:
            raise HTTPException(409, 'avatar_owner_changed_reload') from None
        key = secrets.token_urlsafe(32)
    response.set_cookie(COOKIE, signer.dumps(key), max_age=MAX_AGE,
                        httponly=True, samesite='lax', secure=settings.session_secure)
    anonymous = 'anonymous:' + key
    user = session_user(request.session)
    resolved = 'account:' + str(user.id) if user else anonymous
    token = hmac.new(settings.secret_key.encode(), ('avatar-scope-v1:' + resolved + ':' + key).encode(), hashlib.sha256).hexdigest()
    return resolved, anonymous, token


@router.get('/me/avatar')
def read_avatar(request: Request, response: Response):
    key, anonymous, token = owner(request, response, create=True)
    record = AvatarProfile.objects(ownerKey=key).first()
    draft = record or (AvatarProfile.objects(ownerKey=anonymous).first() if key != anonymous else None)
    return dict(appearance=draft.appearance if draft else None,
                revision=record.revision if record else 0, ownerScopeToken=token)


@router.put('/me/avatar', dependencies=[Depends(require_csrf)])
def save_avatar(body: AvatarProfileWrite, request: Request, response: Response):
    key, anonymous, token = owner(request, response)
    if not hmac.compare_digest(body.ownerScopeToken, token):
        raise HTTPException(409, 'avatar_owner_changed_reload')
    look = body.appearance.model_dump(exclude_none=True)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=90) if key == anonymous else None
    if body.expectedRevision == 0:
        try:
            AvatarProfile(ownerKey=key, appearance=look, revision=1, updatedAt=now, expiresAt=expires).save(force_insert=True)
        except (NotUniqueError, DuplicateKeyError):
            raise HTTPException(409, 'avatar_revision_conflict_reload') from None
    else:
        updated = AvatarProfile.objects(ownerKey=key, revision=body.expectedRevision).update_one(
            set__appearance=look, inc__revision=1, set__updatedAt=now, set__expiresAt=expires)
        if not updated:
            raise HTTPException(409, 'avatar_revision_conflict_reload')
    return dict(appearance=look, revision=body.expectedRevision + 1, ownerScopeToken=token)
