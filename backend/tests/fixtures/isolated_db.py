"""Only the dedicated local migration instance may be reset or seeded."""
from urllib.parse import urlsplit, parse_qs

DATABASE = 'metamuseum_test'
URI = 'mongodb://127.0.0.1:27028/metamuseum_test?directConnection=true'
MARKER_DB = 'metamuseum_migration_guard'
MARKER = {'_id': 'migration-test-instance', 'project': 'metamuseum-migration', 'purpose': 'destructive-fixtures-only', 'version': 1}


def validate_uri(uri, database=DATABASE):
    parsed = urlsplit(uri)
    if (database != DATABASE or parsed.scheme != 'mongodb' or parsed.hostname != '127.0.0.1'
            or parsed.port != 27028 or parsed.username or parsed.password
            or parsed.path != '/' + DATABASE or parsed.fragment
            or parse_qs(parsed.query) != {'directConnection': ['true']}):
        raise RuntimeError('Refusing destructive fixture: require dedicated 127.0.0.1:27028/metamuseum_test direct connection')


def assert_test_instance(client, uri=URI, database=DATABASE):
    validate_uri(uri, database)
    client.admin.command('ping')
    if client.address != ('127.0.0.1', 27028):
        raise RuntimeError('Refusing destructive fixture: unexpected actual server')
    if client[MARKER_DB].instance.find_one({'_id': MARKER['_id']}) != MARKER:
        raise RuntimeError('Refusing destructive fixture: isolated instance marker missing or invalid')


def reset_database(client, uri=URI, database=DATABASE):
    assert_test_instance(client, uri, database)
    client.drop_database(database)


def connect():
    from pymongo import MongoClient
    client = MongoClient(URI, serverSelectionTimeoutMS=5000)
    assert_test_instance(client)
    return client
