"""Runtime configuration; deployment supplies the existing token secrets."""
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    secret_key: str = Field(min_length=1, repr=False)
    security_password_salt: str = Field(min_length=1, repr=False)
    mongodb_uri: str = Field(default="", repr=False)
    mongodb_host: str = Field(default="localhost", min_length=1, repr=False)
    mongodb_port: int = Field(default=27017, ge=1, le=65535)
    mongodb_db: str = "metamuseum"
    environment: Literal["development", "test", "production"] = "development"
    allowed_origins: list[str] = ["http://localhost:8000", "http://127.0.0.1:8000"]
    session_cookie: str = "metamuseum_session"
    session_max_age: int = Field(default=86400, gt=0)
    session_secure: bool = False
    frontend_root: Path | None = None
    media_root: Path | None = None
    wall_media_root: Path = Path('wall_media')
    wall_media_max_file_bytes: int = Field(default=2 * 1024**3, gt=0)
    wall_media_quota_bytes: int = Field(default=20 * 1024**3, gt=0)

    @model_validator(mode="after")
    def secure_production_cookie(self):
        if self.environment == "production":
            self.session_secure = True
        return self
