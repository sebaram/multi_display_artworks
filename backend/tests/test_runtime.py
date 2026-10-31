import pytest


def test_runtime_exposes_application_factory(settings):
    from metamuseum.asgi import create_app
    app = create_app(settings)
    assert "/health" in app.openapi()["paths"]


def test_real_mongo_health_and_unknown_api(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/does-not-exist").status_code == 404


def test_runtime_disconnects_after_lifespan(app):
    from fastapi.testclient import TestClient
    from mongoengine.connection import _connections
    with TestClient(app):
        assert "default" in _connections
    assert "default" not in _connections


def test_settings_requires_secrets_and_production_secure_cookie():
    from pydantic import ValidationError
    from metamuseum.config import Settings
    with pytest.raises(ValidationError):
        Settings(_env_file=None, secret_key="", security_password_salt="")
    configured = Settings(secret_key="test-key", security_password_salt="test-salt", environment="production")
    assert configured.session_secure


def test_legacy_mongodb_host_port_environment_is_used_when_uri_absent(monkeypatch):
    from metamuseum.config import Settings
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.setenv("MONGODB_HOST", "legacy-mongo.invalid")
    monkeypatch.setenv("MONGODB_PORT", "27123")
    monkeypatch.setenv("MONGODB_DB", "legacy-gallery")
    config = Settings(secret_key="test-key", security_password_salt="test-salt")
    assert config.mongodb_host == "legacy-mongo.invalid"
    assert config.mongodb_port == 27123
    assert config.mongodb_db == "legacy-gallery"


def test_full_mongodb_uri_precedes_host_port_and_is_not_in_settings_repr(monkeypatch):
    from metamuseum.config import Settings
    monkeypatch.setenv("MONGODB_HOST", "ignored-mongo.invalid")
    monkeypatch.setenv("MONGODB_PORT", "27123")
    monkeypatch.setenv("MONGODB_URI", "mongodb://synthetic-user:synthetic-secret@uri-mongo.invalid:27124/gallery")
    config = Settings(secret_key="test-key", security_password_salt="test-salt")
    assert config.mongodb_uri.startswith("mongodb://synthetic-user:")
    assert "synthetic-secret" not in repr(config)


def test_legacy_host_port_settings_connect_to_real_mongo(settings, database):
    from fastapi.testclient import TestClient
    from metamuseum.asgi import create_app
    config = settings.model_copy(update={"mongodb_uri": "  ", "mongodb_host": "127.0.0.1", "mongodb_port": 27028})
    with TestClient(create_app(config)) as client:
        assert client.get("/health").json() == {"status": "ok"}
