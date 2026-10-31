"""Integration fixtures may only reset the marker-guarded migration database."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from fixtures.isolated_db import connect, reset_database, URI, DATABASE


@pytest.fixture
def settings():
    from metamuseum.config import Settings
    return Settings(secret_key="deterministic-test-secret-for-new-session",
                           security_password_salt="deterministic-confirmation-salt",
                           mongodb_uri=URI, mongodb_db=DATABASE,
                           allowed_origins=["http://testserver"])


@pytest.fixture
def database():
    from bson import json_util
    client = connect()
    reset_database(client)
    fixture = json.loads((ROOT / "contracts/legacy-bson.json").read_text(encoding="utf8"))
    db = client[DATABASE]
    for entry in fixture["documents"]:
        db[entry["collection"]].insert_one(json_util.loads(json.dumps(entry["document"])))
    yield db
    reset_database(client)
    client.close()


@pytest.fixture
def app(settings, database):
    from metamuseum.asgi import create_app
    return create_app(settings)


@pytest.fixture
def client(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        yield client


@pytest.fixture
def csrf(client):
    return {"X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["csrf_token"],
            "Origin": "http://testserver"}
