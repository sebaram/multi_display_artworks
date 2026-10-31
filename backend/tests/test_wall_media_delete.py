"""Deletion recovery without the shared application or MongoDB fixtures."""
import errno
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pymongo.errors import AutoReconnect

from metamuseum.api.wall_media import router
from metamuseum.auth import require_admin
from metamuseum.services import wall_media


@pytest.fixture
def isolated_media(tmp_path, monkeypatch):
    identifier = ObjectId('1234567890abcdef12345678')
    content = b'\x00\x00\x00\x18ftypisomvideo'
    target = tmp_path / str(identifier)
    target.write_bytes(content)
    docs = {identifier: {'_id': identifier, 'name': 'video.mp4',
                        'content_type': 'video/mp4', 'size': len(content),
                        'created_at': datetime(2026, 10, 31, tzinfo=timezone.utc)}}
    assets = Mock()
    assets.find_one.side_effect = lambda query: docs.get(query['_id'])
    assets.delete_one.side_effect = lambda query: docs.pop(query['_id'], None)
    presets, bindings = Mock(), Mock()
    presets.find_one.return_value = bindings.find_one.return_value = None
    collections = {'assets': assets, 'presets': presets, 'bindings': bindings}
    monkeypatch.setattr(wall_media, 'collection', collections.__getitem__)
    app = FastAPI()
    app.state.settings = SimpleNamespace(wall_media_root=tmp_path)
    app.dependency_overrides[require_admin] = lambda: None
    app.include_router(router)
    with TestClient(app, raise_server_exceptions=False) as http:
        yield SimpleNamespace(identifier=identifier, target=target, content=content,
                              docs=docs, assets=assets, presets=presets,
                              bindings=bindings, http=http,
                              url=f'/api/v1/wall-assets/{identifier}')


@pytest.mark.parametrize('failure', ['permission', 'busy', 'sharing', 'locking'])
def test_locked_content_preserves_asset_until_delete_retry(isolated_media, monkeypatch, failure):
    media = isolated_media
    if failure == 'permission':
        error = PermissionError('content is open')
    elif failure == 'busy':
        error = OSError(errno.EBUSY, 'content is open')
    else:
        error = OSError('content is open')
        error.winerror = 32 if failure == 'sharing' else 33
    unlink = Path.unlink

    def locked_unlink(target, *args, **kwargs):
        if target == media.target:
            raise error
        return unlink(target, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'unlink', locked_unlink)
        response = media.http.delete(media.url)

    assert response.status_code == 409
    assert response.json() == {'detail': 'asset_content_in_use'}
    assert media.identifier in media.docs
    assert media.http.get(media.url + '/content').content == media.content
    response = media.http.delete(media.url)
    assert response.status_code == 204
    assert not response.content
    assert media.identifier not in media.docs
    assert not media.target.exists()


@pytest.mark.parametrize('reference', ['presets', 'bindings'])
def test_referenced_content_is_preserved(isolated_media, reference):
    media = isolated_media
    getattr(media, reference).find_one.return_value = {'asset_ids': [str(media.identifier).upper()]}

    response = media.http.delete(media.url)

    assert response.status_code == 409
    assert response.json() == {'detail': 'asset_is_referenced'}
    assert media.identifier in media.docs
    assert media.target.read_bytes() == media.content


def test_delete_can_retry_metadata_removal_after_database_failure(isolated_media):
    media = isolated_media
    media.assets.delete_one.side_effect = AutoReconnect('database unavailable')

    response = media.http.delete(media.url)

    assert response.status_code == 500
    assert media.identifier in media.docs
    assert not media.target.exists()
    media.assets.delete_one.side_effect = lambda query: media.docs.pop(query['_id'], None)
    assert media.http.delete(media.url).status_code == 204
    assert media.identifier not in media.docs


def test_unexpected_filesystem_error_preserves_asset(isolated_media, monkeypatch):
    media = isolated_media
    unlink = Path.unlink

    def broken_unlink(target, *args, **kwargs):
        if target == media.target:
            raise OSError(errno.EIO, 'storage failure')
        return unlink(target, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, 'unlink', broken_unlink)
        response = media.http.delete(media.url)

    assert response.status_code == 500
    assert media.identifier in media.docs
    assert media.target.read_bytes() == media.content
