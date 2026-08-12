"""Signed, short-lived visitor capabilities for Socket.IO authentication."""

import secrets

from flask import current_app
from itsdangerous import BadData, URLSafeTimedSerializer


CAPABILITY_SALT = "metamuseum.visitor-capability.v1"


def issue_visitor_capability() -> dict[str, str]:
    visitor_id = secrets.token_urlsafe(18)
    capability = URLSafeTimedSerializer(
        current_app.secret_key, salt=CAPABILITY_SALT
    ).dumps({"visitorId": visitor_id})
    return {"visitorId": visitor_id, "capability": capability}


def validate_visitor_capability(
    capability: object, *, max_age: int = 86400
) -> str | None:
    try:
        payload = URLSafeTimedSerializer(
            current_app.secret_key, salt=CAPABILITY_SALT
        ).loads(capability, max_age=max_age)
    except (BadData, TypeError):
        return None

    visitor_id = payload.get("visitorId") if isinstance(payload, dict) else None
    return visitor_id if isinstance(visitor_id, str) and visitor_id else None
