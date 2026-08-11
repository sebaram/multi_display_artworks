"""Integration coverage for browser-scoped visitor profiles."""

from contextlib import contextmanager

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
