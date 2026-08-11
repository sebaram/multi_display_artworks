"""Shared integration fixtures backed by a real MongoDB server."""

import os
import sys

import mongoengine
import pytest


APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app"))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)


def _mongodb_uri() -> str:
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        pytest.fail("MONGODB_URI is required for integration tests")
    return uri


@pytest.fixture(scope="session")
def app():
    uri = _mongodb_uri()
    db_name = os.environ.get("MONGODB_DB", "metamuseum_test")
    if db_name != "metamuseum_test":
        pytest.fail("integration tests require MONGODB_DB=metamuseum_test")

    os.environ["MONGODB_URI"] = uri
    os.environ["MONGODB_DB"] = db_name

    from metamuseum import create_app

    return create_app()


@pytest.fixture(autouse=True)
def clean_database(app):
    """Keep every test isolated while exercising the same real database."""
    connection = mongoengine.connection.get_connection()
    connection.drop_database("metamuseum_test")
    yield
    connection.drop_database("metamuseum_test")


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def admin_client(app):
    from metamuseum.models import User

    admin = User(
        email="admin@test.invalid",
        name="Test Admin",
        password="unused-test-password-hash",
        user_type=["admin"],
        email_verified=True,
    ).save()
    client = app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = admin.get_id()
        session["_fresh"] = True
    return client


@pytest.fixture
def sample_image():
    from metamuseum.elements.basic import Image, Room, Wall

    room = Room(name="test-room", description="Integration test room").save()
    wall = Wall(
        name="test-wall",
        description="Integration test wall",
        room=room,
        position="0 0 0",
        rotation="0 0 0",
        width=4,
        height=3,
        depth=0.2,
    ).save()
    image = Image(
        name="test-image",
        description="Integration test image",
        wall=wall,
        position="0 0 0",
        position_x=0,
        position_y=0,
        image_url="https://example.test/image.png",
        width=1,
        height=1,
    ).save()
    wall.images = [image]
    wall.save()
    room.walls = [wall]
    room.save()
    return image
