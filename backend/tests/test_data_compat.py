import json
from pathlib import Path

import bcrypt
from bson import json_util
from fastapi.testclient import TestClient
from itsdangerous import URLSafeTimedSerializer

ROOT = Path(__file__).resolve().parents[2]


def test_existing_bson_and_passwords_round_trip(app, database):
    from metamuseum import models
    fixture = json.loads((ROOT / "contracts/legacy-bson.json").read_text(encoding="utf8"))
    with TestClient(app):
        for entry in fixture["documents"]:
            model = getattr(models, entry["model"])
            original = json_util.loads(json.dumps(entry["document"]))
            loaded = model.objects(pk=original["_id"]).first()
            assert loaded is not None
            assert loaded.to_mongo().to_dict() == original
        for user in models.User.objects:
            assert bcrypt.checkpw(b"Migration-local-123!", user.password.encode())
        assert models.Room.objects.first().walls[0].room.pk == models.Room.objects.first().pk


def test_models_keep_collection_reference_and_inheritance_metadata(settings):
    from metamuseum import models
    fixture = json.loads((ROOT / "contracts/legacy-bson.json").read_text(encoding="utf8"))
    for row in fixture["schemas"]:
        cls = getattr(models, row["model"])
        assert cls._get_collection_name() == row["collection"]
        assert bool(cls._meta.get("allow_inheritance")) == row["allow_inheritance"]
        assert set(cls._fields) == set(row["fields"])
        for name, expected in row["fields"].items():
            field = cls._fields[name]
            assert type(field).__name__ == expected["type"]
            assert field.db_field == expected["db_field"]
            if row['model'] == 'WhisperConfig' and name == 'api_key':
                # Local OpenAI-compatible STT may be keyless; remote configs validate in clean().
                assert expected['required'] is True and field.required is False
            else:
                assert field.required == expected["required"]
            if "dbref" in expected:
                assert getattr(field, "field", field).dbref == expected["dbref"]


def test_tokens_keep_existing_format(client, settings):
    from metamuseum.auth import resolve_visitor, generate_confirmation_token
    serializer = URLSafeTimedSerializer(settings.secret_key, salt="metamuseum.visitor-capability.v1")
    legacy = serializer.dumps({"visitorId": "legacy-tab-visitor"})
    assert resolve_visitor(legacy, settings=settings).visitor_id == "legacy-tab-visitor"
    issued = client.post("/visitor-capability").json()
    assert serializer.loads(issued["capability"], max_age=86400) == {"visitorId": issued["visitorId"]}
    confirmation = generate_confirmation_token("admin@migration.invalid", settings=settings)
    assert URLSafeTimedSerializer(settings.secret_key).loads(confirmation, salt=settings.security_password_salt, max_age=3600) == "admin@migration.invalid"


def test_confirmation_and_capability_reject_invalid_and_expired_tokens(client, settings, monkeypatch):
    from itsdangerous.timed import TimestampSigner
    from metamuseum.auth import resolve_visitor, generate_confirmation_token
    import pytest
    from fastapi import HTTPException
    with monkeypatch.context() as old:
        old.setattr(TimestampSigner, "get_timestamp", lambda self: 1)
        visitor = URLSafeTimedSerializer(settings.secret_key, salt="metamuseum.visitor-capability.v1").dumps({"visitorId": "expired"})
        confirmation = generate_confirmation_token("admin@migration.invalid", settings=settings)
    for capability in ["garbage", visitor, URLSafeTimedSerializer(settings.secret_key, salt="metamuseum.visitor-capability.v1").dumps(["bad"] )]:
        with pytest.raises(HTTPException):
            resolve_visitor(capability, settings=settings)
    assert client.get("/confirm/" + confirmation, follow_redirects=False).status_code == 400
