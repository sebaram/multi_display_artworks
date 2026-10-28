# Local browser fixture setup

From the repository root, with MongoDB7 running through `docker compose -f docker-compose.migration.yml -p metamuseum-migration up -d --wait`:

```powershell
python frontend/tests/fixtures/generate_media.py
python frontend/tests/fixtures/verify_media.py
python backend/tests/fixtures/verify_seed.py
python frontend/tests/fixtures/server.py
```

Media is served at `http://127.0.0.1:8766`. Check this port is unused before starting; the server fails binding if occupied. Generated binary media under `media/` is gitignored; the generator and observed SHA256/size manifest are committed. All media is original procedural test data. Generation requires FFmpeg (PATH binary or imageio-ffmpeg bundle); the manifest documents the exact observed encoder output, while cross-platform encoders can differ.

Seeded room: `000000000000000000000001`; other room: `000000000000000000000002`. Admin `admin@migration.invalid`; nonadmin `visitor@migration.invalid`; both passwords `Migration-local-123!`. They are real bcrypt accounts with verified email, suitable for a browser form login rather than a session bypass. `verify_seed.py` resets only the guarded dedicated test DB; coordinate access with other integration tests. The marker lives outside that DB so subsequent resets remain guarded. Runtime seed never calls legacy seed_data.py/seed_and_serve.py.

Fixtures: 128px four-quadrant PNG for UV orientation; valid620byte GLB triangle; 512 colored32byte Gaussian splats spanning the clipping volume; six-second160×90/24fps H264+AAC MP4 with synthetic motion/tone; three2second HLS transport-stream segments with relative URLs; interactive allowed HTML; blocked HTML using actual `X-Frame-Options: DENY` and `frame-ancestors 'none'` headers. HTTP supports CORS and MP4 byte ranges. Provider stubs exist only for POST `/v1/chat/completions` and `/v1/audio/transcriptions`; they do not replace application APIs or Socket.IO. Extend stub response scenarios when implementing AI layout tests.

Use the current backend environment with FFmpeg on PATH. An optional imageio-ffmpeg bundle is only a fallback for local generation, never an application runtime dependency. Before importing presets or starting the test API, explicitly set `MONGODB_URI=mongodb://127.0.0.1:27028/metamuseum_test?directConnection=true`, `MONGODB_DB=metamuseum_test`, local test secrets and the allowed5173 origin. Do not inherit production settings for browser setup.

Fixture generation verifies format and decoding. Actual browser/app evidence is recorded separately in [migration validation](../../../docs/migration-validation.md); generation alone is never a browser acceptance result.
