"""The sync debug overlay flag reaches the client through bootstrap data."""


def _room_html(app, query):
    from metamuseum.elements.basic import Room

    room = Room(name="debug-room", description="debug").save()
    with app.test_client() as client:
        response = client.get(f"/room?room_id={room._id}{query}")
        assert response.status_code == 200
        return response.get_data(as_text=True)


def test_debug_flag_defaults_off(app):
    assert '"syncDebugEnabled": false' in _room_html(app, "")


def test_debug_sync_enables_the_overlay(app):
    assert '"syncDebugEnabled": true' in _room_html(app, "&debug=sync")


def test_other_debug_values_do_not_enable_the_overlay(app):
    assert '"syncDebugEnabled": false' in _room_html(app, "&debug=other")
