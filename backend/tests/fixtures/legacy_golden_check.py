"""Golden fixtures preserve the actual legacy BSON representation, not guessed JSON."""
import os
import json
import sys
import unittest
from pathlib import Path
from bson import BSON, json_util

os.environ.setdefault('SECRET_KEY','migration-local-secret')
os.environ.setdefault('SECURITY_PASSWORD_SALT','migration-local-salt')
ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT/'flask_server'), str(ROOT/'flask_server/app')]

class GoldenBsonTests(unittest.TestCase):
    def test_bson_and_legacy_model_round_trip(self):
        from metamuseum.elements import basic, user
        from metamuseum import models
        fixture=json.loads((ROOT/'contracts/legacy-bson.json').read_text(encoding='utf8'))
        for entry in fixture['documents']:
            with self.subTest(model=entry['model']):
                doc=json_util.loads(json.dumps(entry['document']))
                self.assertEqual(BSON(BSON.encode(doc)).decode(),doc)
                cls=next(getattr(module,entry['model']) for module in (basic,user,models) if hasattr(module,entry['model']))
                self.assertEqual(cls._from_son(doc).to_mongo().to_dict(),doc)
                self.assertEqual(cls._get_collection_name(),entry['collection'])

    def test_synthetic_passwords_are_valid_bcrypt(self):
        import bcrypt
        fixture=json.loads((ROOT/'contracts/legacy-bson.json').read_text(encoding='utf8'))
        for entry in fixture['documents']:
            if entry['model']=='User':
                self.assertTrue(bcrypt.checkpw(fixture['local_credentials']['password'].encode(),entry['document']['password'].encode()))

    def test_public_llm_serialization_excludes_secret(self):
        from metamuseum.models import LLMConfig
        self.assertNotIn('api_key',LLMConfig(provider='openai',api_base='http://127.0.0.1:8766/v1',api_key='synthetic',model='fixture').to_dict())

if __name__=='__main__':
    unittest.main()
