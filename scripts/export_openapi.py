"""Export deterministic API metadata without starting or connecting the server."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from metamuseum.asgi import create_app
from metamuseum.config import Settings


def main():
    settings = Settings(secret_key="openapi-export-only", security_password_salt="openapi-export-only")
    document = create_app(settings).openapi()
    destination = ROOT / "contracts/openapi.json"
    destination.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(destination)


if __name__ == "__main__":
    main()
