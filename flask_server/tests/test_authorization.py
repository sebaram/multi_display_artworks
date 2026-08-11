"""Regression tests for admin-only state changes and stream controls."""

import pytest

from metamuseum.core import streaming


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


@pytest.mark.parametrize("stream_id", ["..", ".", "camera/other", "camera\\other", "camera name"])
def test_core_streaming_rejects_unsafe_stream_ids(stream_id):
    with pytest.raises(ValueError, match="Invalid stream_id"):
        streaming.save_mediarecorder_chunk(stream_id, b"segment", 0)


def test_public_stream_read_routes_reject_unsafe_ids_and_allow_safe_ids(client, tmp_path, monkeypatch):
    from metamuseum.views import stream_views

    stream_dir = tmp_path / "streams"
    playlist_dir = stream_dir / "camera"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "playlist.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
    monkeypatch.setattr(stream_views, "STREAM_DIR", stream_dir)

    safe_response = client.get("/stream/playlist/camera")
    assert safe_response.status_code == 200
    assert safe_response.mimetype == "application/vnd.apple.mpegurl"
    assert safe_response.get_data(as_text=True) == "#EXTM3U\n"

    unsafe_response = client.get("/stream/playlist/bad%20name")
    assert unsafe_response.status_code == 400
    assert unsafe_response.get_json() == {"error": "Invalid stream_id"}
