"""Integration coverage for browser-scoped visitor profiles."""

from contextlib import contextmanager

import mongoengine
import pytest
from bson import json_util
from flask import template_rendered


@contextmanager
def captured_templates(app):
    recorded = []

    def record(sender, template, context, **extra):
        recorded.append((template, context))

    template_rendered.connect(record, app)
    try:
        yield recorded
    finally:
        template_rendered.disconnect(record, app)


@pytest.fixture(autouse=True)
def clear_position_rooms():
    from metamuseum.core.position_sync import room_users

    room_users.clear()
    yield
    room_users.clear()


def socket_client(app, client, visitor_id=None):
    from metamuseum.core.position_sync import socketio_instance

    if visitor_id is not None:
        with client.session_transaction() as browser_session:
            browser_session["visitor_id"] = visitor_id
    return socketio_instance.test_client(app, flask_test_client=client)


def events_named(socket, event_name):
    return [
        event["args"][0]
        for event in socket.get_received()
        if event["name"] == event_name
    ]


def database_snapshot(database):
    """Capture every collection's complete content in a stable form."""
    return {
        name: sorted(
            json_util.dumps(document, sort_keys=True)
            for document in database[name].find()
        )
        for name in sorted(database.list_collection_names())
    }


def test_room_assigns_one_visitor_id_per_browser_session(client, sample_image):
    from metamuseum.core.visitor_profile import AVATAR_IDS

    room_id = str(sample_image.wall.room._id)
    with captured_templates(client.application) as templates:
        first = client.get(f"/room?room_id={room_id}&avatar=robot")
        second = client.get(f"/room?room_id={room_id}&avatar=none")

    with client.session_transaction() as browser_session:
        visitor_id = browser_session["visitor_id"]

    first_context = templates[0][1]
    second_context = templates[1][1]
    assert first.status_code == second.status_code == 200
    assert visitor_id == first_context["visitor_id"] == second_context["visitor_id"]
    assert first_context["avatar_catalog"] == sorted(AVATAR_IDS)
    assert first_context["avatar"] == second_context["avatar"] == "shiba"


def test_normalize_profile_rejects_unknown_avatar_and_bad_color():
    from metamuseum.core.visitor_profile import normalize_profile

    assert normalize_profile({
        "displayName": "x",
        "avatarId": "remote-url",
        "color": "blue",
    }) == {
        "displayName": "Visitor",
        "avatarId": "shiba",
        "color": "#4CAF50",
    }


def test_normalize_profile_safely_handles_non_mapping_payload():
    from metamuseum.core.visitor_profile import DEFAULT_PROFILE, normalize_profile

    assert normalize_profile(["not", "a", "mapping"]) == DEFAULT_PROFILE


def test_normalize_profile_accepts_mapping_like_payload():
    from metamuseum.core.visitor_profile import normalize_profile

    class MappingLikePayload:
        def get(self, key, default=None):
            return {
                "displayName": "Valid Name",
                "avatarId": "robot",
                "color": "#112233",
            }.get(key, default)

    assert normalize_profile(MappingLikePayload()) == {
        "displayName": "Valid Name",
        "avatarId": "robot",
        "color": "#112233",
    }


def test_socket_uses_signed_session_identity_and_ignores_spoofed_user_id(app, client):
    from metamuseum.core.position_sync import room_users

    socket = socket_client(app, client, "server-owned-id")
    socket.emit("join_position_room", {
        "room_id": "room-a",
        "userId": "attacker-id",
        "profile": {
            "displayName": "Valid Name",
            "avatarId": "robot",
            "color": "#112233",
        },
    })

    presence = next(iter(room_users["room-a"].values()))
    assert presence["userId"] == "server-owned-id"
    assert presence["displayName"] == "Valid Name"
    assert presence["avatarId"] == "robot"
    assert presence["color"] == "#112233"
    socket.disconnect()


def test_socket_without_signed_visitor_id_does_not_join(app, client):
    from metamuseum.core.position_sync import room_users

    socket = socket_client(app, client)
    socket.emit("join_position_room", {
        "room_id": "room-without-session",
        "userId": "client-owned-id",
        "profile": {},
    })

    assert not room_users["room-without-session"]
    socket.disconnect()


def test_room_state_contains_public_profiles_without_socket_sid(app):
    first_client = app.test_client()
    first_socket = socket_client(app, first_client, "visitor-one")
    first_socket.emit("join_position_room", {
        "room_id": "shared-room",
        "profile": {
            "displayName": "First Visitor",
            "avatarId": "robot",
            "color": "#123ABC",
        },
    })
    first_socket.get_received()

    second_client = app.test_client()
    second_socket = socket_client(app, second_client, "visitor-two")
    second_socket.emit("join_position_room", {
        "room_id": "shared-room",
        "profile": {
            "displayName": "Second Visitor",
            "avatarId": "shiba",
            "color": "#456DEF",
        },
    })

    room_state = events_named(second_socket, "room_state")[0]
    assert room_state["users"] == [{
        "userId": "visitor-one",
        "displayName": "First Visitor",
        "avatarId": "robot",
        "color": "#123ABC",
        "position": "0 1.6 0",
        "rotation": "0 0 0",
        "leftHand": None,
        "rightHand": None,
        "handTracking": False,
    }]
    assert "sid" not in room_state["users"][0]
    first_socket.disconnect()
    second_socket.disconnect()


def test_legacy_position_rooms_contains_only_public_presence_data(app):
    from metamuseum.core.position_sync import get_position_rooms

    first_client = app.test_client()
    first_socket = socket_client(app, first_client, "visitor-one")
    first_socket.emit("join_position_room", {
        "room_id": "legacy-http-room",
        "profile": {
            "displayName": "First Visitor",
            "avatarId": "robot",
            "color": "#123ABC",
        },
    })

    second_client = app.test_client()
    second_socket = socket_client(app, second_client, "visitor-two")
    second_socket.emit("join_position_room", {
        "room_id": "legacy-http-room",
        "profile": {
            "displayName": "Second Visitor",
            "avatarId": "shiba",
            "color": "#456DEF",
        },
    })

    assert get_position_rooms() == {
        "legacy-http-room": [{
            "userId": "visitor-one",
            "displayName": "First Visitor",
            "avatarId": "robot",
            "color": "#123ABC",
            "position": "0 1.6 0",
            "rotation": "0 0 0",
            "leftHand": None,
            "rightHand": None,
            "handTracking": False,
        }, {
            "userId": "visitor-two",
            "displayName": "Second Visitor",
            "avatarId": "shiba",
            "color": "#456DEF",
            "position": "0 1.6 0",
            "rotation": "0 0 0",
            "leftHand": None,
            "rightHand": None,
            "handTracking": False,
        }]
    }
    first_socket.disconnect()
    second_socket.disconnect()


def test_profile_update_normalizes_only_the_connected_presence(app):
    from metamuseum.core.position_sync import room_users

    first_client = app.test_client()
    first_socket = socket_client(app, first_client, "visitor-one")
    first_socket.emit("join_position_room", {
        "room_id": "profile-room",
        "profile": {
            "displayName": "First Visitor",
            "avatarId": "robot",
            "color": "#123456",
        },
    })
    first_socket.get_received()

    second_client = app.test_client()
    second_socket = socket_client(app, second_client, "visitor-two")
    second_socket.emit("join_position_room", {
        "room_id": "profile-room",
        "profile": {
            "displayName": "Second Visitor",
            "avatarId": "shiba",
            "color": "#654321",
        },
    })
    first_socket.get_received()
    second_socket.get_received()

    first_socket.emit("profile_update", {
        "room_id": "profile-room",
        "userId": "visitor-two",
        "profile": {
            "displayName": "x",
            "avatarId": "https://attacker.invalid/avatar.glb",
            "color": "blue",
        },
        "position": "99 99 99",
    })

    presences = {presence["userId"]: presence for presence in room_users["profile-room"].values()}
    assert presences["visitor-one"] == {
        "userId": "visitor-one",
        "displayName": "Visitor",
        "avatarId": "shiba",
        "color": "#4CAF50",
        "position": "0 1.6 0",
        "rotation": "0 0 0",
        "leftHand": None,
        "rightHand": None,
        "handTracking": False,
    }
    assert presences["visitor-two"]["displayName"] == "Second Visitor"
    assert events_named(second_socket, "profile_updated") == [{
        "userId": "visitor-one",
        "displayName": "Visitor",
        "avatarId": "shiba",
        "color": "#4CAF50",
        "room_id": "profile-room",
    }]
    first_socket.disconnect()
    second_socket.disconnect()


def test_position_update_cannot_overwrite_identity_or_profile(app):
    from metamuseum.core.position_sync import room_users

    first_client = app.test_client()
    first_socket = socket_client(app, first_client, "visitor-one")
    first_socket.emit("join_position_room", {
        "room_id": "position-room",
        "profile": {
            "displayName": "First Visitor",
            "avatarId": "robot",
            "color": "#123456",
        },
    })

    second_client = app.test_client()
    second_socket = socket_client(app, second_client, "visitor-two")
    second_socket.emit("join_position_room", {
        "room_id": "position-room",
        "profile": {},
    })
    first_socket.get_received()
    second_socket.get_received()

    first_socket.emit("position_update", {
        "room_id": "position-room",
        "userId": "visitor-two",
        "displayName": "Impersonated Visitor",
        "avatarId": "none",
        "color": "#000000",
        "profile": {
            "displayName": "Also Impersonated",
            "avatarId": "none",
            "color": "#000000",
        },
        "position": "1 2 3",
        "rotation": "4 5 6",
        "leftHand": {"position": "7 8 9"},
        "rightHand": {"position": "10 11 12"},
        "handTracking": True,
    })

    first_presence = next(
        presence for presence in room_users["position-room"].values()
        if presence["userId"] == "visitor-one"
    )
    assert first_presence["userId"] == "visitor-one"
    assert first_presence["displayName"] == "First Visitor"
    assert first_presence["avatarId"] == "robot"
    assert first_presence["color"] == "#123456"
    assert first_presence["position"] == "1 2 3"
    assert events_named(second_socket, "position_update") == [{
        "userId": "visitor-one",
        "displayName": "First Visitor",
        "avatarId": "robot",
        "color": "#123456",
        "position": "1 2 3",
        "rotation": "4 5 6",
        "leftHand": {"position": "7 8 9"},
        "rightHand": {"position": "10 11 12"},
        "handTracking": True,
        "room_id": "position-room",
    }]
    first_socket.disconnect()
    second_socket.disconnect()


def test_guest_socket_presence_does_not_write_to_mongodb(app, client):
    database = mongoengine.connection.get_db()
    database["presence_snapshot"].insert_one({
        "marker": "must-not-change",
        "nested": {"version": 1},
    })
    before = database_snapshot(database)
    socket = socket_client(app, client, "mongo-free-visitor")

    socket.emit("join_position_room", {
        "room_id": "mongo-free-room",
        "profile": {
            "displayName": "Mongo Free",
            "avatarId": "robot",
            "color": "#ABCDEF",
        },
    })
    socket.emit("profile_update", {
        "room_id": "mongo-free-room",
        "profile": {
            "displayName": "Still Mongo Free",
            "avatarId": "shiba",
            "color": "#FEDCBA",
        },
    })
    socket.emit("position_update", {
        "room_id": "mongo-free-room",
        "position": "1 2 3",
    })

    after = database_snapshot(database)
    assert after == before
    socket.disconnect()
