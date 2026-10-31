"""Browser-session visitor identity and public profile validation."""

import re
from collections.abc import Mapping
from ..avatar_catalog import avatar_catalog
from ..schemas_avatar import normalize_appearance


AVATAR_IDS = frozenset(p['id'] for p in avatar_catalog()['presets'])
DEFAULT_PROFILE = {
    "displayName": "Visitor",
    "avatarId": "shiba",
    "color": "#4CAF50",
}
_NAME = re.compile(r"^[a-zA-Z0-9가-힣\s\-_'.]{3,20}$")
_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


def normalize_profile(data: Mapping | None) -> dict:
    """Return only the valid, public fields from a mapping-like profile payload."""
    profile_get = getattr(data, "get", None)
    if not isinstance(data, Mapping) and not callable(profile_get):
        return dict(DEFAULT_PROFILE)

    name = str(profile_get("displayName", "")).strip()
    avatar_id = profile_get("avatarId")
    color = str(profile_get("color", "")).upper()
    result = {
        "displayName": name if _NAME.fullmatch(name) else DEFAULT_PROFILE["displayName"],
        "avatarId": avatar_id if isinstance(avatar_id, str) and avatar_id in AVATAR_IDS else DEFAULT_PROFILE["avatarId"],
        "color": color if _COLOR.fullmatch(color) else DEFAULT_PROFILE["color"],
    }
    appearance = profile_get('appearance')
    if isinstance(appearance, dict):
        appearance = normalize_appearance(appearance)
        result.update(appearance=appearance, avatarId=appearance['presetId'], color=appearance['colors']['top'])
    return result
