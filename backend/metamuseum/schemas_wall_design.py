from typing import Any
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class PresetCreate(Strict):
    name: str = Field(min_length=1, max_length=200)
    config: dict[str, Any]
    thumbnail_asset_id: str | None = None

class PresetPatch(Strict):
    expected_revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    config: dict[str, Any] | None = None
    thumbnail_asset_id: str | None = None

class ApplyDesign(Strict):
    expected_revision: int = Field(ge=0)
    preset_id: str | None = None
    config: dict[str, Any] | None = None

class WallLook(Strict):
    schema_version: int
    source_commit: str
    logical_screen: str
    seed: int
    state: dict[str, Any]

class PresetRead(BaseModel):
    id: str
    name: str
    revision: int
    read_only: bool
    source_key: str | None
    schema_version: int
    renderer_version: str
    config: WallLook
    asset_ids: list[str]
    thumbnail_asset_id: str | None
    thumbnail_url: str | None
    created_at: str
    updated_at: str

class PlaybackState(BaseModel):
    wall_id: str
    binding_revision: int
    revision: int
    playing: bool
    position_seconds: float
    rate: float
    state_time_ms: int

class AppliedWallDesign(BaseModel):
    wall_id: str
    room_id: str
    revision: int
    preset_id: str | None
    preset_revision: int | None
    config: WallLook
    asset_ids: list[str]
    logical_screen: str
    seed: int
    animation_epoch_ms: int
    playback: PlaybackState

class AssetRead(BaseModel):
    id: str
    name: str
    content_type: str
    size: int
    url: str
    created_at: str
