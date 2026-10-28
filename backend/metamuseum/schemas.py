"""Public DTOs explicitly exclude credentials and service secrets."""
from pydantic import BaseModel, ConfigDict, Field, SecretStr


class SessionRead(BaseModel):
    authenticated: bool
    is_admin: bool


class CSRFRead(BaseModel):
    csrf_token: str


class SigninRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=1, max_length=254)
    password: SecretStr
    next: str = Field(default="/", max_length=2048)


class VisitorRead(BaseModel):
    visitorId: str
    capability: str


class HealthRead(BaseModel):
    status: str


class DocumentDTO(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str


class DocumentPage(BaseModel):
    items: list[DocumentDTO]
    total: int


class FieldSpec(BaseModel):
    name: str
    label: str
    type: str
    required: bool
    readonly: bool
    default: object = None
    choices: list | None = None
    reference: str | None = None
    secret: bool = False


class ResourceSpec(BaseModel):
    name: str
    label: str
    fields: list[FieldSpec]


class AdminSchema(BaseModel):
    resources: list[ResourceSpec]


class RoomSummary(BaseModel):
    id: str
    name: str
    description: str
    walls: list[DocumentDTO]
    created_time: str | None = None


class RoomScene(BaseModel):
    room: DocumentDTO
    roomId: str
    boundary: dict[str, float]
    presets: list[dict]
    spawn_preset: dict | None
    walls: list[DocumentDTO]
    wallList: list[dict]
    visitorCapabilityUrl: str
    avatarCatalog: list[str]
    isAdmin: bool
    syncDebugEnabled: bool
    isArMarker: bool
    isArCompanion: bool
    roomControlsEnabled: bool
