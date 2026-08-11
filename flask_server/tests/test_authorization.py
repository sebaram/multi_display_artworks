"""Regression tests for admin-only state changes and stream controls."""


def test_anonymous_client_cannot_update_element(client, sample_image):
    response = client.patch(
        f"/element/{sample_image.id}/image", json={"position_x": 1}
    )
    assert response.status_code == 403
    assert response.get_json() == {"error": "Admin required"}


def test_admin_can_update_element(admin_client, sample_image):
    response = admin_client.patch(
        f"/element/{sample_image.id}/image", json={"position_x": 1}
    )
    assert response.status_code == 200


def test_authenticated_non_admin_cannot_update_element(user_client, sample_image):
    response = user_client.patch(
        f"/element/{sample_image.id}/image", json={"position_x": 1}
    )
    assert response.status_code == 403
    assert response.get_json() == {"error": "Admin required"}


def test_anonymous_client_cannot_control_stream(client):
    assert client.post("/stream/stop/camera").status_code == 403


def test_authenticated_non_admin_cannot_control_stream(user_client):
    response = user_client.post("/stream/stop/camera")
    assert response.status_code == 403
    assert response.get_json() == {"error": "Admin required"}


def test_invalid_stream_id_is_rejected(admin_client):
    response = admin_client.post(
        "/stream/start-rtsp",
        json={"stream_id": "../bad", "rtsp_url": "rtsp://example.test/cam"},
    )
    assert response.status_code == 400
