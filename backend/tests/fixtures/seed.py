"""Seed synthetic golden BSON into the guarded migration database, never production."""
import json
from pathlib import Path
from bson import json_util
from isolated_db import connect, reset_database, DATABASE

ROOT = Path(__file__).resolve().parents[3]

def seed(client):
    reset_database(client)
    golden = json.loads((ROOT/'contracts/legacy-bson.json').read_text(encoding='utf8'))
    database = client[DATABASE]
    for entry in golden['documents']:
        document = json_util.loads(json.dumps(entry['document']))
        database[entry['collection']].insert_one(document)
    return golden

if __name__ == '__main__':
    client = connect()
    golden = seed(client)
    print(f"Seeded {len(golden['documents'])} synthetic documents in {DATABASE}; room=000000000000000000000001")
    print('Local-only credentials: admin@migration.invalid / Migration-local-123!')
