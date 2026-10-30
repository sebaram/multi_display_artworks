"""Public catalog DTOs. Profile and pose validation are added at their API boundaries."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .avatar_catalog import avatar_catalog


def normalize_appearance(value: dict, *, strict=False) -> dict:
    presets = {p['id']: p for p in avatar_catalog()['presets']}
    identifier = value.get('presetId', value.get('avatarId', 'shiba'))
    if not isinstance(identifier, str) or identifier not in presets:
        if strict:
            raise ValueError('unknown_preset')
        identifier = 'shiba'
    preset = presets[identifier]
    fallback = preset['defaultAppearance'] or {
        **presets['casual']['defaultAppearance'], 'presetId': identifier,
        'faceId': 'none', 'hairId': 'none', 'hatId': 'none', 'glassesId': 'none'}
    import re
    supplied = value.get('colors', {})
    if not isinstance(supplied, dict):
        supplied = {}
    colors = {}
    for slot, default in fallback['colors'].items():
        color = supplied.get(slot, value.get('color', default) if slot == 'top' else default)
        valid = isinstance(color, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', color)
        if strict and not valid:
            raise ValueError('invalid_color')
        colors[slot] = color.upper() if valid else default
    result = dict(schemaVersion=2, presetId=identifier, colors=colors)
    for key in ['faceId', 'hairId', 'hatId', 'glassesId']:
        item = value.get(key, fallback[key])
        # Unknown component IDs are never asset URLs; unsupported faces fall back.
        if strict and key != 'faceId' and item not in preset['options'].get(key, ['none']):
            raise ValueError('invalid_component')
        result[key] = item if item in preset['options'].get(key, ['none']) else fallback[key]
    if result['hatId'] == 'cap':
        result['hairId'] = 'none'
    return result

class AvatarAppearanceV2(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal[2] = 2
    presetId: str
    colors: dict[str, str]
    faceId: str
    hairId: str
    hatId: str
    glassesId: str

    @model_validator(mode='after')
    def canonical(self):
        normalized = normalize_appearance(self.model_dump(), strict=True)
        for key, value in normalized.items():
            object.__setattr__(self, key, value)
        return self

    @field_validator('colors')
    @classmethod
    def color_slots(cls, value):
        if set(value) != {'skin', 'top', 'bottom', 'hair', 'eyes'}:
            raise ValueError('invalid_color_slots')
        return value


class AvatarProfileWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    appearance: AvatarAppearanceV2
    expectedRevision: int = Field(ge=0, strict=True)
    ownerScopeToken: str = Field(pattern=r'^[0-9a-f]{64}$')

class AvatarCatalog(BaseModel):
    schemaVersion: Literal[2] = 2
    presets: list[dict]


def validate_avatar_pose(value):
    """Fixed core22 LE float32 boundary; return only a bounded canonical snapshot."""
    import json
    import math
    import struct
    from .avatar_catalog import RIG_VERSION
    keys = {'version', 'rigVersion', 'sequence', 'sampleTime', 'bodyScale', 'tracking', 'teleport', 'floats'}
    if not isinstance(value, dict) or set(value) - keys:
        return None
    blob = value.get('floats')
    if not isinstance(blob, bytes) or len(blob) != 392:
        return None
    metadata = {k: v for k, v in value.items() if k != 'floats'}
    try:
        if len(json.dumps(metadata, allow_nan=False).encode()) + len(blob) > 4096:
            return None
    except (ValueError, TypeError, OverflowError):
        return None
    sequence, sample_time, scale = value.get('sequence'), value.get('sampleTime'), value.get('bodyScale', 1)
    tracking = value.get('tracking')
    if (value.get('version') != 2 or value.get('rigVersion') != RIG_VERSION
            or type(sequence) is not int or not 0 <= sequence <= 9007199254740991
            or type(sample_time) not in (float, int) or not 0 <= sample_time <= 1e15
            or type(scale) not in (float, int) or not .5 <= scale <= 2
            or type(value.get('teleport')) is not bool or not isinstance(tracking, dict)
            or set(tracking) != {'head', 'left', 'right'} or any(type(v) is not bool for v in tracking.values())):
        return None
    numbers = struct.unpack('<98f', blob)
    if (not all(math.isfinite(n) for n in numbers) or any(abs(n) > 1e5 for n in numbers[:3])
            or any(abs(n) > 2 for n in numbers[7:10])
            or any(abs(math.sqrt(sum(n*n for n in numbers[i:i+4])) - 1) > .01 for i in [3, *range(10, 98, 4)])):
        return None
    return {**metadata, 'bodyScale': scale, 'tracking': dict(tracking), 'floats': blob}
