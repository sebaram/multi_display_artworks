# MetaMuseum

Interactive 3D galleries with FastAPI, React, A-Frame, Socket.IO and MongoDB.

Each room, wall and artwork keeps its own URL. Administrators can edit the gallery, design animated walls, save presets and apply them to a wall. Everyone in the same room shares pointer reactions and the canonical video play/pause/seek state. YouTube uses a separate synchronized player.

## Run locally

Requirements: Python3.12+, Node22.12+ (Node24 recommended), MongoDB7 and FFmpeg on PATH.

```sh
python -m venv .venv
# Activate .venv, then:
pip install --require-hashes -r backend/requirements-dev.lock
pip install --no-deps -e backend
npm --prefix frontend ci
cp .env.example .env
# Edit secrets and MongoDB connection in .env.
npm --prefix frontend run build
uvicorn metamuseum.asgi:app --app-dir backend --env-file .env --host 127.0.0.1 --port 8000
```

For live frontend editing, also run `npm --prefix frontend run dev` and open http://127.0.0.1:5173. The Vite proxy forwards API, media and Socket.IO traffic to8000. FFmpeg can instead be configured with `FFMPEG_PATH`.

Alternatively, set the two secrets in `.env` and use `docker compose up -d --build`; this starts a separate development MongoDB and the app on5000. Existing production accounts remain valid. The session cookie changed, so users sign in again once.

Screenshots from the final container: [catalog](docs/validation/catalog.png) · [wall editor](docs/validation/wall-editor.png).

## Wall designs

Open a wall's design action while signed in as an administrator, or visit `/wall-editor?wall_id=<id>`. The standalone designer is at `/wall-editor`.

The editor supports the source's44 presets, layers and original group hierarchy, text, shapes, motion, video uploads, undo/redo and JSON import/export. Saving a preset preserves a reusable design; applying takes an independent snapshot for the selected wall. Removing it restores the wall's stored legacy background. Existing artwork stays on the wall.

Import the pinned44 defaults once into a configured database (safe to repeat):

```sh
# Export the same environment as the app before running this command.
python scripts/import_wall_presets.py
```

Preset metadata, configuration, bindings and playback clocks live in MongoDB. Uploaded media lives under `WALL_MEDIA_ROOT` and must be backed up with MongoDB. The renderer uses a seeded common clock; clients converge on the same state rather than claiming identical GPU frames. Browser autoplay still requires a local sound gesture.

## Tests

The destructive integration fixtures refuse every database except the marker-guarded local instance on127.0.0.1:27028. Never point them at production.

```sh
docker compose -f docker-compose.migration.yml up -d --wait
python -m pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run build
```

For browser tests, seed the dedicated instance, import defaults, generate procedural media, then start the API with that test database and the media server on8766:

```sh
python backend/tests/fixtures/seed.py
python scripts/import_wall_presets.py
python frontend/tests/fixtures/generate_media.py
python frontend/tests/fixtures/server.py
# Separate terminal: uvicorn as above with isolated Mongo URI and allowed5173 origin.
npm --prefix frontend run test:e2e
```

Run database reset suites and browser acceptance sequentially. See [fixture setup](frontend/tests/fixtures/README.md), [API contract](contracts/ui-api-shape.md), [wall protocol](contracts/wall-design-api.md) and [migration validation](docs/migration-validation.md).

## Deployment

The root Dockerfile builds React and installs the hashed Python runtime with FFmpeg. It runs exactly one Uvicorn worker because room caches and pointer coalescers have one owner.

`docker-compose.prod.yml` preserves the existing external Mongo network `tlx-mongo_default`, loopback port51736, and host image/splat/GLTF mounts. It adds `/var/www/metamuseum/data/wall_media`. Production must use HTTPS and an explicit `ALLOWED_ORIGINS` list.

Branch/PR CI runs integration, unit, browser and clean-image checks. Automatic production deployment is not enabled in the migration workflow; a proposed master-only job is saved for review in [the deployment proposal](docs/superpowers/plans/proposed-production-workflow.yml.txt). No production migration or deployment has been executed.

## Layout

- `backend/metamuseum`: ASGI APIs, preserved MongoEngine models, room services and local static media.
- `frontend/src`: React UI, managed A-Frame scenes and extracted wall engine.
- `frontend/public`: pinned runtimes, source presets, fonts and provenance.
- `contracts`: historical BSON/route/event evidence and current API contracts.
- `backend/tests`, `frontend/tests`: isolated integration and browser suites.

Original Flask runtime and dependency manifests are retired; historical behavior remains reproducible from Git. [Third-party notices](THIRD_PARTY_NOTICES.md) include the pinned wall source and renderer assets.
