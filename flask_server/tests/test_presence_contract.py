"""Characterization tests for the public room-presence Socket.IO contract."""


ROOM_ID = "presence-contract-room"
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


def _socket_for(app, visitor_id):
    from metamuseum.core.position_sync import socketio_instance

    client = app.test_client()
    with client.session_transaction() as session:
        session["visitor_id"] = visitor_id
    return socketio_instance.test_client(app, flask_test_client=client)


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


def test_presence_events_keep_session_identity_and_public_payloads(app):
    first = _socket_for(app, "visitor-a")
    second = _socket_for(app, "visitor-b")
    try:
        first.emit("join_position_room", {
            "room_id": ROOM_ID,
            "userId": "spoofed-visitor",
            "profile": FIRST_PROFILE,
        })
        first_state = _only_event_payload(first, "room_state")
        assert first_state == {"users": [], "room_id": ROOM_ID}

        second.emit("join_position_room", {
            "room_id": ROOM_ID,
            "profile": SECOND_PROFILE,
        })
        second_state = _only_event_payload(second, "room_state")
        assert second_state["room_id"] == ROOM_ID
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
            "room_id": ROOM_ID,
        }
        assert "sid" not in joined

        first.emit("position_update", {
            "room_id": ROOM_ID,
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
            "room_id": ROOM_ID,
        }
        assert "sid" not in position_update

        first.emit("profile_update", {
            "room_id": ROOM_ID,
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
            "room_id": ROOM_ID,
        }
        assert "sid" not in profile_updated

        first.disconnect()
        user_left = _only_event_payload(second, "user_left")
        assert user_left == {"userId": "visitor-a", "room_id": ROOM_ID}
        assert "sid" not in user_left
    finally:
        if first.is_connected():
            first.disconnect()
        if second.is_connected():
            second.disconnect()


def test_voice_mute_relay_preserves_the_public_payload(app):
    first = _socket_for(app, "voice-visitor-a")
    second = _socket_for(app, "voice-visitor-b")
    voice_payload = {
        "room_id": "voice-contract-room",
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
