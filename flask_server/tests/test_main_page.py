"""Main index page integration tests against real MongoDB."""


def _index_html(app):
    with app.test_client() as client:
        response = client.get("/")
        assert response.status_code == 200
        return response.get_data(as_text=True)


def test_quick_links_point_at_an_existing_room(app):
    from metamuseum.elements.basic import Room

    room = Room(name="gallery", description="test gallery").save()
    html = _index_html(app)

    assert f"/room?room_id={room._id}" in html
    assert f"/room?room_id={room._id}&amp;ar=marker" in html


def test_quick_links_degrade_without_rooms(app):
    html = _index_html(app)

    assert "/room?room_id=" not in html
    assert "No rooms yet" in html
