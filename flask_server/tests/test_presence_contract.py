"""Characterization tests for the public room-presence Socket.IO contract."""

from metamuseum.core.presence_service import PresenceService
from metamuseum.core.visitor_profile import DEFAULT_PROFILE
from itsdangerous import URLSafeTimedSerializer


FIRST_PROFILE = {
    "displayName": "Alice Visitor",
    "avatarId": "robot",
    "color": "#123456",
}
SECOND_PROFILE = {
    "displayName": "Bobby Visitor",
    "avatarId": "rigged-simple",
    "color": "#654321",
}


def _socket_for(app, visitor_id, client=None):
    from metamuseum.core.position_sync import socketio_instance

    client = client or app.test_client()
    capability = URLSafeTimedSerializer(
        app.secret_key, salt="metamuseum.visitor-capability.v1"
    ).dumps({"visitorId": visitor_id})
    return socketio_instance.test_client(
        app,
        flask_test_client=client,
        auth={"visitorCapability": capability},
    )


def _event_payloads(socket, event_name):
    return [
        event["args"][0]
        for event in socket.get_received()
        if event["name"] == event_name
    ]


def _only_event_payload(socket, event_name):
    payloads = _event_payloads(socket, event_name)
    assert len(payloads) == 1
    return payloads[0]


def test_presence_update_uses_the_joined_identity_not_payload_identity():
    service = PresenceService()
    service.join(
        "room", "sid", "visitor", DEFAULT_PROFILE, "0 1.6 0", "0 0 0"
    )

    event = service.update_position(
        "room", "sid", {"userId": "spoof", "position": "1 2 3"}
    )

    assert event["userId"] == "visitor"
    assert event["position"] == "1 2 3"


def test_presence_events_keep_capability_identity_and_public_payloads(app, room_id):
    first = _socket_for(app, "visitor-a")
    second = _socket_for(app, "visitor-b")
    try:
        first.emit("join_position_room", {
            "room_id": room_id,
            "userId": "spoofed-visitor",
            "profile": FIRST_PROFILE,
        })
        first_state = _only_event_payload(first, "room_state")
        assert first_state == {"users": [], "room_id": room_id}

        second.emit("join_position_room", {
            "room_id": room_id,
            "profile": SECOND_PROFILE,
        })
        second_state = _only_event_payload(second, "room_state")
        assert second_state["room_id"] == room_id
        assert len(second_state["users"]) == 1
        assert second_state["users"][0] == {
            "userId": "visitor-a",
            **FIRST_PROFILE,
            "position": "0 1.6 0",
            "rotation": "0 0 0",
            "leftHand": None,
            "rightHand": None,
            "handTracking": False,
        }
        assert "sid" not in second_state["users"][0]

        joined = _only_event_payload(first, "user_joined")
        assert joined == {
            "userId": "visitor-b",
            **SECOND_PROFILE,
            "room_id": room_id,
        }
        assert "sid" not in joined

        first.emit("position_update", {
            "room_id": room_id,
            "userId": "spoofed-visitor",
            "displayName": "Spoofed Visitor",
            "avatarId": "none",
            "color": "#000000",
            "position": "1 2 3",
            "rotation": "0 90 0",
            "leftHand": {"position": "4 5 6"},
            "rightHand": {"position": "7 8 9"},
            "handTracking": True,
        })
        position_update = _only_event_payload(second, "position_update")
        assert position_update == {
            "userId": "visitor-a",
            **FIRST_PROFILE,
            "position": "1 2 3",
            "rotation": "0 90 0",
            "leftHand": {"position": "4 5 6"},
            "rightHand": {"position": "7 8 9"},
            "handTracking": True,
            "room_id": room_id,
        }
        assert "sid" not in position_update

        first.emit("profile_update", {
            "room_id": room_id,
            "userId": "spoofed-visitor",
            "profile": {
                "displayName": "Alice Updated",
                "avatarId": "shiba",
                "color": "#ABCDEF",
            },
        })
        profile_updated = _only_event_payload(second, "profile_updated")
        assert profile_updated == {
            "userId": "visitor-a",
            "displayName": "Alice Updated",
            "avatarId": "shiba",
            "color": "#ABCDEF",
            "room_id": room_id,
        }
        assert "sid" not in profile_updated

        first.disconnect()
        user_left = _only_event_payload(second, "user_left")
        assert user_left == {"userId": "visitor-a", "room_id": room_id}
        assert "sid" not in user_left
    finally:
        if first.is_connected():
            first.disconnect()
        if second.is_connected():
            second.disconnect()


def test_voice_mute_relay_preserves_the_public_payload(app, room_id):
    first = _socket_for(app, "voice-visitor-a")
    second = _socket_for(app, "voice-visitor-b")
    voice_payload = {
        "room_id": room_id,
        "userId": "voice-visitor-a",
        "muted": True,
    }
    try:
        first.emit("join_position_room", {
            "room_id": voice_payload["room_id"],
            "profile": FIRST_PROFILE,
        })
        _only_event_payload(first, "room_state")

        second.emit("join_position_room", {
            "room_id": voice_payload["room_id"],
            "profile": SECOND_PROFILE,
        })
        _only_event_payload(second, "room_state")
        _only_event_payload(first, "user_joined")

        first.emit("voice.mute", voice_payload)
        assert _only_event_payload(second, "voice.mute") == voice_payload
        assert _event_payloads(first, "voice.mute") == []
    finally:
        if first.is_connected():
            first.disconnect()
        if second.is_connected():
            second.disconnect()


def test_duplicate_tabs_replace_the_old_socket_without_a_false_leave(app, room_id):
    observer = _socket_for(app, "observer")
    first_tab = _socket_for(app, "same-browser")
    second_tab = _socket_for(app, "same-browser")
    try:
        observer.emit("join_position_room", {"room_id": room_id, "profile": {}})
        _only_event_payload(observer, "room_state")

        first_tab.emit("join_position_room", {"room_id": room_id, "profile": FIRST_PROFILE})
        _only_event_payload(first_tab, "room_state")
        _only_event_payload(observer, "user_joined")
        first_tab.emit("position_update", {
            "room_id": room_id,
            "position": "9 9 9",
        })
        assert _only_event_payload(observer, "position_update")["position"] == "9 9 9"

        second_tab.emit("join_position_room", {"room_id": room_id, "profile": SECOND_PROFILE})
        second_state = _only_event_payload(second_tab, "room_state")
        assert [user["userId"] for user in second_state["users"]] == ["observer"]
        replacement_events = observer.get_received()
        assert [event["name"] for event in replacement_events] == [
            "voice.leave",
            "user_joined",
            "position_update",
        ]
        assert replacement_events[0]["args"][0] == {
            "room_id": room_id,
            "userId": "same-browser",
        }
        replacement_position = replacement_events[2]["args"][0]
        assert replacement_position["userId"] == "same-browser"
        assert replacement_position["position"] == "0 1.6 0"
        assert _only_event_payload(first_tab, "voice.displaced") == {
            "room_id": room_id,
        }

        first_tab.disconnect()
        assert _event_payloads(observer, "user_left") == []

        second_tab.emit("position_update", {
            "room_id": room_id,
            "position": "1 2 3",
        })
        assert _only_event_payload(observer, "position_update")["userId"] == "same-browser"

        second_tab.disconnect()
        assert _only_event_payload(observer, "user_left") == {
            "userId": "same-browser",
            "room_id": room_id,
        }
    finally:
        if first_tab.is_connected():
            first_tab.disconnect()
        if second_tab.is_connected():
            second_tab.disconnect()
        if observer.is_connected():
            observer.disconnect()


def test_voice_relays_require_membership_and_use_server_identity(app, room_id):
    sender = _socket_for(app, "real-sender")
    receiver = _socket_for(app, "real-receiver")
    outsider = _socket_for(app, "outsider")
    try:
        sender.emit("join_position_room", {"room_id": room_id, "profile": FIRST_PROFILE})
        _only_event_payload(sender, "room_state")
        receiver.emit("join_position_room", {"room_id": room_id, "profile": SECOND_PROFILE})
        _only_event_payload(receiver, "room_state")
        _only_event_payload(sender, "user_joined")

        targeted_relays = [
            ("voice.offer", {"sdp": "offer-sdp", "type": "offer"}),
            ("voice.answer", {"sdp": "answer-sdp", "type": "answer"}),
            ("voice.ice", {"candidate": {"candidate": "ice-candidate"}}),
        ]
        for event_name, event_fields in targeted_relays:
            sender.emit(event_name, {
                "room_id": room_id,
                "from": "spoofed-sender",
                "userId": "spoofed-sender",
                "target": "real-receiver",
                **event_fields,
            })
            assert _only_event_payload(receiver, event_name) == {
                "room_id": room_id,
                "from": "real-sender",
                "target": "real-receiver",
                **event_fields,
            }

        broadcast_relays = [
            ("voice.join", {}, {}),
            ("voice.leave", {}, {}),
            ("voice.mute", {"muted": True}, {"muted": True}),
            (
                "voice.transcript",
                {"text": "hello", "language": "en"},
                {"text": "hello", "language": "en"},
            ),
        ]
        for event_name, event_fields, expected_fields in broadcast_relays:
            sender.emit(event_name, {
                "room_id": room_id,
                "from": "spoofed-sender",
                "userId": "spoofed-sender",
                **event_fields,
            })
            assert _only_event_payload(receiver, event_name) == {
                "room_id": room_id,
                "userId": "real-sender",
                **expected_fields,
            }

        outsider.emit("voice.mute", {
            "room_id": room_id,
            "userId": "real-sender",
            "muted": False,
        })
        assert _event_payloads(receiver, "voice.mute") == []

        sender.emit("voice.offer", {
            "room_id": room_id,
            "target": "not-in-room",
            "sdp": "ignored",
            "type": "offer",
        })
        assert _event_payloads(receiver, "voice.offer") == []
    finally:
        for socket in (sender, receiver, outsider):
            if socket.is_connected():
                socket.disconnect()


def test_voice_admin_toggle_requires_an_admin_member(
    app, room_id, admin_client, user_client
):
    from metamuseum.core.position_sync import room_voice_enabled

    visitor = _socket_for(app, "visitor")
    signed_in_socket = _socket_for(app, "signed-in-visitor", user_client)
    admin_socket = _socket_for(app, "admin-visitor", admin_client)
    try:
        visitor.emit("join_position_room", {"room_id": room_id, "profile": {}})
        _only_event_payload(visitor, "room_state")

        visitor.emit("voice.admin_toggle", {"room_id": room_id, "enabled": True})
        assert room_voice_enabled.get(room_id, False) is False
        assert _event_payloads(visitor, "voice_admin_toggle") == []

        signed_in_socket.emit(
            "join_position_room", {"room_id": room_id, "profile": {}}
        )
        _only_event_payload(signed_in_socket, "room_state")
        _only_event_payload(visitor, "user_joined")
        signed_in_socket.emit(
            "voice.admin_toggle", {"room_id": room_id, "enabled": True}
        )
        assert room_voice_enabled.get(room_id, False) is False
        assert _event_payloads(visitor, "voice_admin_toggle") == []

        admin_socket.emit("voice.admin_toggle", {"room_id": room_id, "enabled": True})
        assert room_voice_enabled.get(room_id, False) is False

        admin_socket.emit("join_position_room", {"room_id": room_id, "profile": {}})
        _only_event_payload(admin_socket, "room_state")
        _only_event_payload(visitor, "user_joined")
        admin_socket.emit("voice.admin_toggle", {"room_id": room_id, "enabled": True})
        assert room_voice_enabled[room_id] is True
        assert _only_event_payload(visitor, "voice_admin_toggle") == {
            "enabled": True,
            "room_id": room_id,
        }
    finally:
        if visitor.is_connected():
            visitor.disconnect()
        if signed_in_socket.is_connected():
            signed_in_socket.disconnect()
        if admin_socket.is_connected():
            admin_socket.disconnect()


def test_voice_state_is_returned_after_room_state_acknowledges_membership(app, room_id):
    from metamuseum.core.position_sync import room_voice_enabled

    room_voice_enabled[room_id] = True
    socket = _socket_for(app, "visitor")
    try:
        socket.emit("join_position_room", {"room_id": room_id, "profile": {}})
        _only_event_payload(socket, "room_state")

        socket.emit("voice.get_state", {"room_id": room_id})

        assert _only_event_payload(socket, "voice_admin_toggle") == {
            "enabled": True,
            "room_id": room_id,
        }
    finally:
        socket.disconnect()


def test_nonexistent_room_join_is_rejected_without_allocating_presence(app):
    from bson import ObjectId
    from metamuseum.core.position_sync import presence_service

    missing_room_id = str(ObjectId())
    socket = _socket_for(app, "visitor")
    try:
        socket.emit("join_position_room", {"room_id": missing_room_id, "profile": {}})
        assert missing_room_id not in presence_service.rooms
        assert _event_payloads(socket, "room_state") == []
    finally:
        socket.disconnect()


def test_presence_service_deletes_a_room_when_its_last_socket_leaves():
    service = PresenceService()
    service.join("room", "sid", "visitor", DEFAULT_PROFILE, "0 1.6 0", "0 0 0")

    service.leave("room", "sid")

    assert "room" not in service.rooms
