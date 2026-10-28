"""Signed sessions, legacy visitor tokens, and one shared admin decision."""
import base64
import json
import secrets
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from itsdangerous import BadData, TimestampSigner, URLSafeTimedSerializer
from starlette.responses import RedirectResponse

from .config import Settings
from .models import User
from .schemas import CSRFRead, SessionRead, SigninRequest, VisitorRead

CAPABILITY_SALT = "metamuseum.visitor-capability.v1"


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(dependencies=[Depends(no_store)])


def _settings(settings: Settings | None = None) -> Settings:
    return settings if settings is not None else Settings()


def require_origin(request: Request):
    origin = request.headers.get("origin")
    if origin not in request.app.state.settings.allowed_origins:
        raise HTTPException(403, "origin_denied")


def require_csrf(request: Request, csrf_token: str | None = Header(default=None, alias="X-CSRF-Token")):
    require_origin(request)
    expected = request.session.get("csrf_token")
    supplied = request.headers.get("x-csrf-token")
    if not isinstance(expected, str) or not supplied or not secrets.compare_digest(expected, supplied):
        raise HTTPException(403, "csrf_denied")


def session_user(session: dict) -> User | None:
    email = session.get("user_id")
    if not isinstance(email, str):
        return None
    user = User.objects(email=email).first()
    return user if user and user.email_verified else None


def admin_from_session(session: dict) -> User | None:
    """Sync DB helper: socket handlers must use run_in_threadpool/to_thread."""
    user = session_user(session)
    return user if user and user.is_admin() else None


def require_admin(request: Request) -> User:
    user = admin_from_session(request.session)
    if user is None:
        raise HTTPException(403, "admin_required")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        require_csrf(request)
    return user


def decode_session_cookie(cookie: str, *, settings: Settings | None = None) -> dict:
    """Decode the same Starlette cookie for a separately wrapped Socket.IO app."""
    config = _settings(settings)
    try:
        value = TimestampSigner(config.secret_key).unsign(cookie, max_age=config.session_max_age)
        payload = json.loads(base64.b64decode(value, validate=True))
        return payload if isinstance(payload, dict) else {}
    except (BadData, ValueError, TypeError, UnicodeDecodeError):
        return {}


@dataclass(frozen=True)
class VisitorIdentity:
    visitor_id: str


def resolve_visitor(capability: str, *, settings: Settings | None = None) -> VisitorIdentity:
    config = _settings(settings)
    try:
        payload = URLSafeTimedSerializer(config.secret_key, salt=CAPABILITY_SALT).loads(capability, max_age=86400)
    except (BadData, TypeError):
        raise HTTPException(401, "invalid_capability") from None
    visitor_id = payload.get("visitorId") if isinstance(payload, dict) else None
    if not isinstance(visitor_id, str) or not visitor_id:
        raise HTTPException(401, "invalid_capability")
    return VisitorIdentity(visitor_id)


def generate_confirmation_token(email: str, *, settings: Settings | None = None) -> str:
    config = _settings(settings)
    return URLSafeTimedSerializer(config.secret_key).dumps(email, salt=config.security_password_salt)


def safe_return_url(target: str) -> str:
    decoded = target
    for _ in range(3):
        decoded = unquote(decoded)
    parsed = urlsplit(decoded)
    if (not decoded.startswith("/") or decoded.startswith("//") or "\\" in decoded
            or parsed.scheme or parsed.netloc or any(ord(c) < 32 or ord(c) == 127 for c in decoded)):
        raise HTTPException(400, "invalid_return_url")
    return target


@router.get("/api/v1/auth/csrf", response_model=CSRFRead)
def csrf(request: Request):
    token = request.session.setdefault("csrf_token", secrets.token_urlsafe(32))
    return CSRFRead(csrf_token=token)


@router.get("/api/v1/auth/session", response_model=SessionRead)
def read_session(request: Request):
    user = session_user(request.session)
    return SessionRead(authenticated=user is not None, is_admin=bool(user and user.is_admin()))


@router.post("/api/v1/auth/signin", response_model=SessionRead, dependencies=[Depends(require_csrf)],
             responses={400: {"description": "invalid_return_url"}, 401: {"description": "invalid_credentials"},
                        403: {"description": "csrf_denied or origin_denied"}})
def signin(body: SigninRequest, request: Request):
    safe_return_url(body.next)
    user = User.objects(email=body.email).first()
    valid = False
    if user:
        try:
            # Legacy bcrypt silently truncated at 72 bytes; preserve those account hashes.
            valid = bcrypt.checkpw(body.password.get_secret_value().encode()[:72], user.password.encode())
        except ValueError:
            pass
    if not valid or not user.email_verified:
        raise HTTPException(401, "invalid_credentials")
    request.session.clear()
    request.session.update(user_id=user.email, csrf_token=secrets.token_urlsafe(32))
    return SessionRead(authenticated=True, is_admin=user.is_admin())


@router.post("/logout", response_model=SessionRead, dependencies=[Depends(require_csrf)], include_in_schema=False)
@router.post("/api/v1/auth/signout", response_model=SessionRead, dependencies=[Depends(require_csrf)],
             responses={403: {"description": "csrf_denied or origin_denied"}})
def signout(request: Request):
    request.session.clear()
    request.session["csrf_token"] = secrets.token_urlsafe(32)
    return SessionRead(authenticated=False, is_admin=False)


@router.api_route("/register", methods=["GET", "POST"], include_in_schema=False)
def register():
    raise HTTPException(403, "registration_closed")


@router.get("/confirm/{token}", include_in_schema=False)
def confirm(token: str, request: Request):
    config = request.app.state.settings
    try:
        email = URLSafeTimedSerializer(config.secret_key).loads(token, salt=config.security_password_salt, max_age=3600)
    except (BadData, TypeError):
        raise HTTPException(400, "invalid_confirmation") from None
    if not isinstance(email, str):
        raise HTTPException(400, "invalid_confirmation")
    user = User.objects(email=email).first()
    if user is None:
        raise HTTPException(400, "invalid_confirmation")
    if not user.email_verified:
        user.update(set__email_verified=True)
    return RedirectResponse("/signin", status_code=303)


@router.get("/protected", include_in_schema=False)
def protected(request: Request):
    if session_user(request.session) is None:
        raise HTTPException(401, "authentication_required")
    return {"authenticated": True}


@router.post("/visitor-capability", response_model=VisitorRead, status_code=201, include_in_schema=False)
@router.post("/api/v1/visitor-capability", response_model=VisitorRead, status_code=201)
def issue_visitor(request: Request):
    visitor_id = secrets.token_urlsafe(18)
    config = request.app.state.settings
    token = URLSafeTimedSerializer(config.secret_key, salt=CAPABILITY_SALT).dumps({"visitorId": visitor_id})
    return VisitorRead(visitorId=visitor_id, capability=token)
