"""Run unmodified legacy tests only after checking the isolated instance marker."""
import os
import sys
from pathlib import Path
from legacy_source import legacy_root
from isolated_db import connect, assert_test_instance, URI, DATABASE

ROOT = Path(__file__).resolve().parents[3]

class InstanceGuard:
    def pytest_runtest_setup(self, item):
        assert_test_instance(self.client)

if __name__ == '__main__':
    os.environ.update(MONGODB_URI=URI, MONGODB_DB=DATABASE, SECRET_KEY='migration-local-secret', SECURITY_PASSWORD_SALT='migration-local-salt')
    guard = InstanceGuard()
    guard.client = connect()
    import pytest
    raise SystemExit(pytest.main([str(legacy_root() / 'tests'), '-ra', *sys.argv[1:]], plugins=[guard]))
