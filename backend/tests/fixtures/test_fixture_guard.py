"""Destructive-fixture safety contract; run without MongoDB or application imports."""
import unittest
from unittest.mock import MagicMock

from isolated_db import reset_database, MARKER, MARKER_DB

URI = 'mongodb://127.0.0.1:27028/metamuseum_test?directConnection=true'

class FixtureGuardTests(unittest.TestCase):
    def test_destructive_fixture_rejects_wrong_database_or_marker(self):
        client = MagicMock()
        client.address = ('127.0.0.1', 27028)
        client[MARKER_DB].instance.find_one.return_value = MARKER
        for uri, database in [(URI, 'metamuseum'), ('mongodb://external.invalid:27028/metamuseum_test', 'metamuseum_test'), ('mongodb://127.0.0.1:27017/metamuseum_test', 'metamuseum_test')]:
            with self.subTest(uri=uri, database=database), self.assertRaises(RuntimeError):
                reset_database(client, uri, database)
        for marker in (None, {**MARKER, 'project':'unrelated-project'}):
            client[MARKER_DB].instance.find_one.return_value = marker
            with self.subTest(marker=marker), self.assertRaises(RuntimeError):
                reset_database(client, URI, 'metamuseum_test')
        client.drop_database.assert_not_called()

    def test_reset_uses_marker_outside_test_database(self):
        client = MagicMock()
        client.address = ('127.0.0.1', 27028)
        client[MARKER_DB].instance.find_one.return_value = MARKER
        reset_database(client, URI, 'metamuseum_test')
        client.drop_database.assert_called_once_with('metamuseum_test')
        self.assertNotEqual(MARKER_DB, 'metamuseum_test')

    def test_wrong_actual_server_is_rejected(self):
        client = MagicMock()
        client.address = ('127.0.0.1', 27017)
        with self.assertRaises(RuntimeError):
            reset_database(client, URI, 'metamuseum_test')
        client.drop_database.assert_not_called()

if __name__ == '__main__':
    unittest.main()
