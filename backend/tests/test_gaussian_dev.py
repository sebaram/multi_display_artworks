from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from metamuseum.api.gaussian_dev import research_root, asset


def request(*, environment='test', enabled=True, client='127.0.0.1', host='127.0.0.1'):
    settings = SimpleNamespace(environment=environment, gaussian_avatar_root=Path('FLAME/derived/web') if enabled else None)
    app = SimpleNamespace(state=SimpleNamespace(settings=settings))
    return Request(dict(type='http', method='GET', scheme='http', path='/', headers=[(b'host', host.encode())],
                        client=(client, 1234), server=(host, 8000), app=app))


def test_private_model_delivery_requires_explicit_local_development():
    assert research_root(request()).name == 'web'
    for req in [request(environment='production'), request(enabled=False), request(client='192.168.1.5'),
                request(host='evil.invalid'), request(client='testclient')]:
        with pytest.raises(HTTPException) as raised:
            research_root(req)
        assert raised.value.status_code == 404


def test_private_model_delivery_allowlist_excludes_licenses_and_source_models():
    for name in ['references.bin', 'references.json', 'flame2023.pkl', '../flame2023.pkl']:
        with pytest.raises(HTTPException) as raised:
            asset(name, request())
        assert raised.value.status_code == 404


def test_native_preset_requires_local_package_and_is_absent_in_production(monkeypatch, tmp_path):
    from metamuseum.avatar_catalog import avatar_catalog
    from metamuseum.schemas_avatar import AvatarAppearanceV2
    monkeypatch.setenv('GAUSSIAN_AVATAR_ROOT', str(tmp_path))
    monkeypatch.setenv('ENVIRONMENT', 'test')
    assert not any(p['id'] == 'gaussian-306' for p in avatar_catalog()['presets'])
    for name in ['manifest.json', 'rig.bin', 'point_cloud.ply']:
        (tmp_path / name).write_bytes(b'local-test-placeholder')
    preset = next(p for p in avatar_catalog()['presets'] if p['id'] == 'gaussian-306')
    assert not preset['capabilities']['fullBody'] and preset['nativeGaussian'] == 'subject-306'
    assert AvatarAppearanceV2.model_validate(preset['defaultAppearance']).presetId == 'gaussian-306'
    monkeypatch.setenv('ENVIRONMENT', 'production')
    assert not any(p['id'] == 'gaussian-306' for p in avatar_catalog()['presets'])
