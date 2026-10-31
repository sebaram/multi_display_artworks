"""The product release version is shared by packages and the API contract."""
import json
from pathlib import Path
import tomllib


def test_package_and_openapi_versions_match(settings):
    from metamuseum.asgi import create_app

    root = Path(__file__).resolve().parents[2]
    backend = tomllib.loads((root / "backend/pyproject.toml").read_text(encoding="utf8"))
    frontend = json.loads((root / "frontend/package.json").read_text(encoding="utf8"))
    lock = json.loads((root / "frontend/package-lock.json").read_text(encoding="utf8"))
    contract = json.loads((root / "contracts/openapi.json").read_text(encoding="utf8"))
    version = backend["project"]["version"]

    assert frontend["version"] == version
    assert lock["version"] == version
    assert lock["packages"][""]["version"] == version
    assert create_app(settings).openapi()["info"]["version"] == version
    assert contract["info"]["version"] == version
