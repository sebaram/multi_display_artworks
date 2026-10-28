"""Built SPA deep links must work without a Vite development fallback."""
from fastapi.testclient import TestClient


def test_new_spa_deep_links_and_missing_files(settings, tmp_path):
    from metamuseum.asgi import create_app, create_realtime_app
    (tmp_path / 'index.html').write_text('<div id="root">built application</div>')
    app = create_app(settings.model_copy(update={'frontend_root': tmp_path}))
    create_realtime_app(app)
    # No lifespan/database needed: all these requests serve a static shell.
    browser = TestClient(app)
    for path in ['/tools', '/tools/streams', '/ar-companion', '/gesture-mark',
                 '/gesture-mark/test', '/wall-editor?wall_id=00000000000000000000000b']:
        response = browser.get(path)
        assert response.status_code == 200, path
        assert 'built application' in response.text
    for path in ['/api/missing', '/static/missing', '/vendor/missing.js', '/unknown-page']:
        assert browser.get(path).status_code == 404, path
