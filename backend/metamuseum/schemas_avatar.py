"""Public catalog DTOs. Profile and pose validation are added at their API boundaries."""
from typing import Literal
from pydantic import BaseModel

class AvatarAppearanceV2(BaseModel):
    schemaVersion: Literal[2] = 2
    presetId: str
    colors: dict[str, str]
    faceId: str
    hairId: str
    hatId: str
    glassesId: str

class AvatarCatalog(BaseModel):
    schemaVersion: Literal[2] = 2
    presets: list[dict]
