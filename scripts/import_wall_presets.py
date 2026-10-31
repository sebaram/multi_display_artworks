"""Idempotently import pinned wall presets into the configured Mongo database."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from metamuseum.config import Settings
from metamuseum.db import connect_database, disconnect_database
from metamuseum.services.wall_designs import import_defaults

if __name__ == '__main__':
    settings = Settings()
    connect_database(settings)
    try:
        print(f'Imported {import_defaults(settings)} source presets')
    finally:
        disconnect_database()
