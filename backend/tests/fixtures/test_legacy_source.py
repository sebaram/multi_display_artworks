"""Historical archive location must not change captured source identifiers."""
import pytest


@pytest.mark.parametrize('folder', ['external-archive', 'nested/scratch/archive'])
def test_historical_source_paths_are_archive_independent(tmp_path, monkeypatch, folder):
    from legacy_source import source_path
    archive = tmp_path / folder
    package = archive / 'app/metamuseum'
    package.mkdir(parents=True)
    (package / '__init__.py').write_text('')
    source = package / 'views/example.py'
    monkeypatch.setenv('LEGACY_ROOT', str(archive))
    assert source_path(source) == 'flask_server/app/metamuseum/views/example.py'
