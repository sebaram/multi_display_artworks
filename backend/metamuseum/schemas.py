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
