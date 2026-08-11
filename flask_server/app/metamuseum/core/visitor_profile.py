"""Browser-session visitor identity and public profile validation."""

import re
import secrets
from collections.abc import Mapping, MutableMapping


AVATAR_IDS = frozenset({"shiba", "robot", "rigged-simple", "none"})
DEFAULT_PROFILE = {
    "displayName": "Visitor",
    "avatarId": "shiba",
    "color": "#4CAF50",
}
_NAME = re.compile(r"^[a-zA-Z0-9가-힣\s\-_'.]{3,20}$")
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def get_or_create_visitor_id(session: MutableMapping) -> str:
    """Return the signed-session visitor identity, creating it when absent."""
    visitor_id = session.get("visitor_id")
    if isinstance(visitor_id, str) and visitor_id:
        return visitor_id

    visitor_id = secrets.token_urlsafe(18)
    session["visitor_id"] = visitor_id
    session.permanent = True
    return visitor_id


def normalize_profile(data: Mapping | None) -> dict:
    """Return only the valid, public fields from a mapping-like profile payload."""
    profile_get = getattr(data, "get", None)
    if not isinstance(data, Mapping) and not callable(profile_get):
        return dict(DEFAULT_PROFILE)

    name = str(profile_get("displayName", "")).strip()
    avatar_id = profile_get("avatarId")
    color = str(profile_get("color", "")).upper()
    return {
        "displayName": name if _NAME.fullmatch(name) else DEFAULT_PROFILE["displayName"],
        "avatarId": avatar_id if isinstance(avatar_id, str) and avatar_id in AVATAR_IDS else DEFAULT_PROFILE["avatarId"],
        "color": color if _COLOR.fullmatch(color) else DEFAULT_PROFILE["color"],
    }
