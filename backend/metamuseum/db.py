"""Synchronous MongoEngine access runs in the HTTP threadpool."""
from mongoengine import connect, disconnect

from .config import Settings


def connect_database(settings: Settings):
    uri = settings.mongodb_uri.strip()
    address = {"host": uri} if uri else {"host": settings.mongodb_host, "port": settings.mongodb_port}
    client = connect(db=settings.mongodb_db, **address,
                     serverSelectionTimeoutMS=5000, uuidRepresentation="standard")
    try:
        client.admin.command("ping")
    except Exception:
        disconnect()
        raise
    return client


def disconnect_database():
    disconnect()
