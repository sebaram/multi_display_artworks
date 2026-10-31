# MetaMuseum

Interactive 3D galleries with FastAPI, React, A-Frame, Socket.IO and MongoDB.

Each room, wall and artwork keeps its own URL. Administrators can edit the gallery, design animated walls, save presets and apply them to a wall. Everyone in the same room shares pointer reactions and the canonical video play/pause/seek state. YouTube uses a separate synchronized player.

## Release status

The FastAPI/React generation **2.0.0** is deployed at [meta.juyounglee.net](https://meta.juyounglee.net) from `2778ee4` (2026-11-01, Asia/Seoul). Backend/frontend packages and OpenAPI use the same version. Verified image/source identities and recovery evidence are recorded in the [release execution record](docs/releases/v2.0-execution.md).

- The [final master validation](https://github.com/sebaram/multi_display_artworks/actions/runs/41214657998) at `2778ee4` passed backend, frontend, all 49 browser cases, clean-image and real-Mongo runtime checks. [Production-copy acceptance](https://github.com/sebaram/multi_display_artworks/actions/runs/41216233985), private acceptance and public HTTPS/WSS smoke passed. The existing TV wall's GLTF and the room's three artworks were checked in a real browser.
- Legacy baseline: `legacy-flask`, `974bbfd`, plus annotated tag `production-pre-v2-20261031`. All 81 running application code files matched that commit in the [production identity check](docs/releases/legacy-production-verification.json). The actual image/configuration and paired Mongo/media snapshots are preserved privately on the deployment host.
- Automatic production deployment remains disabled. Explicit manual preparation, acceptance and cutover operations are provided below; merging does not deploy the new application.

See the [changelog](CHANGELOG.md) for changes and compatibility limits, and the [2.0 release review and cutover plan](docs/releases/v2.0-readiness.md) for versioning, legacy preservation, data backup, release gates and rollback.

## Features and entry points

| Surface | Available behavior |
| --- | --- |
| Gallery | Catalog, rooms, images, GLTF and Gaussian splats; artwork transforms/cutouts, room boundaries and spawn presets. |
| Permanent URLs | `/room?room_id=<id>`, `/wall?wall_id=<id>` and `/element?wall_element_id=<id>&type=<type>`. Existing IDs and stored media paths are retained. |
| TV / wall display | A wall URL fits the wall to the viewport and receives design, pointer and playback updates without creating a room visitor. It is a passive display; interaction and administrator playback controls belong to the room. `refresh` uses the wall's ETag to detect updates. |
| Wall authoring | 44 source presets, layers/groups, text/shapes/motion, history, JSON import/export, uploaded video and thumbnails. MongoDB stores presets and independent applied snapshots. |
| Shared state | Same-room pointer reactions and canonical MP4 play/pause/seek, including late join and reconnect. Network delivery, buffering and local autoplay policies affect when each client displays a frame. |
| Avatars | Four original humanoid presets plus legacy choices, customizable appearance, owner-side motion/IK and relayed final joints. Untracked leg motion is estimated; finger articulation and arbitrary model uploads are outside this release. |
| Input and presence | Desktop movement/look, a floating nipplejs analog joystick on mobile, tab-local visitors and room presence. WebXR controller/hand behavior has mock-device coverage; device status is listed below. |
| Administration | Eleven resource editors, existing bcrypt accounts, CSRF-protected mutations, reference checks and masked provider secrets. |
| Media and services | MP4, managed RTSP/HLS, separate webpage/YouTube players, WebRTC voice, AR/gesture tools and configured AI/STT integrations. External providers and public-network voice require their own operational checks. |

YouTube remains an external service. Its live CI check verifies either actual playback/pause/seek or an explicitly observed bot-login refusal together with the visible error and original-video link. A green CI result alone does not establish successful real YouTube playback. The controlled-player test separately exercises the real application HTTP and Socket.IO play/pause/seek path.

## Run locally

Requirements: Python 3.12+, Node 22.12+ (Node 24 recommended), MongoDB 7 and FFmpeg on PATH.

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

For live frontend editing, also run `npm --prefix frontend run dev` and open http://127.0.0.1:5173. The Vite proxy forwards API, media and Socket.IO traffic to 8000. FFmpeg can instead be configured with `FFMPEG_PATH`.

Alternatively, set the two secrets in `.env` and use `docker compose up -d --build`; this starts a separate development MongoDB and the app on 5000. It does not connect to the production database.

When migrating existing data, preserve the signing secrets, MongoDB and media together. Existing account hashes are supported; the new session cookie requires users to sign in again. Generated Flask-Admin export/file/ajax-lookup protocols are retired with authenticated `410` responses; the React resource editors replace those internals. See the [compatibility contract](contracts/feature-parity.md).

Screenshots from the final container: [catalog](docs/validation/catalog.png) · [wall editor](docs/validation/wall-editor.png).

Feature-by-feature [before/after HTML report](docs/reports/migration-before-after.html) includes 19 screenshots and 8 embedded demonstration videos. See [capture conditions and report checks](docs/reports/README.md).

[Performance evaluation](docs/reports/performance-evaluation.html) compares 59 conditions across room sizes, content types, desktop rendering and desktop mobile stress profiles. Phone/Quest hardware was unavailable during that historical benchmark. A later LG V35 functional smoke checked WebGL, appearance save/reload, native touch movement and a desktop observer; it did not measure phone FPS, thermals or CPU/GPU/RAM consumption. Actual Quest 3 VR/controller/hand acceptance was not completed. [Benchmark methods and reproduction](tools/performance/README.md).

[Rendering optimization](docs/reports/render-optimization.html) compares the original runtime with visible-wall scheduling, bounded artwork residency, image LOD and a shared Spark 2.4 splat renderer. [Rendering policy and remaining limits](docs/rendering-performance.md).

The [avatar evaluation](docs/reports/avatar-evaluation.html) records partial performance coverage and the limited actual-phone check. The newer [mobile/desktop/TV comparison](docs/reports/mobile-desktop-tv-comparison.html) and [display fix verification](docs/reports/display-fix-verification.json) document permanent wall URLs, passive displays and subsequent fixes. Reports preserve their capture dates, commit IDs and historical CI results; use the release-status CI link above for the candidate's current gate.

## Wall designs

Open a wall's design action while signed in as an administrator, or visit `/wall-editor?wall_id=<id>`. The standalone designer is at `/wall-editor`.

The editor supports the source's 44 presets, layers and original group hierarchy, text, shapes, motion, video uploads, undo/redo and JSON import/export. Saving a preset preserves a reusable design; applying takes an independent snapshot for the selected wall. Removing it restores the wall's stored legacy background. Existing artwork stays on the wall.

Import the pinned 44 defaults once into the intended configured database (idempotent; changes that database):

```sh
# Export the same environment as the app before running this command.
python scripts/import_wall_presets.py
```

Preset metadata, configuration, bindings and playback clocks live in MongoDB. Uploaded media lives under `WALL_MEDIA_ROOT` and must be backed up with MongoDB. The renderer uses a seeded common clock; clients converge on the same state rather than claiming identical GPU frames. Browser autoplay still requires a local sound gesture.

## Research features

Procedural gaze is an optional, default-off research algorithm with configurable attention weights and filters. It estimates gaze direction; perceptual naturalness and human attention have not been validated.

The native GaussianAvatars subject-306 preset is a **local research head/bust**, not a production full-body avatar. Licensed FLAME/model/subject assets are not bundled. The asset API and preset are disabled in production, so deploying this branch will not publish the local model. Dynamic Gaussian LOD is not implemented; large-room native-avatar performance remains unmeasured. See [setup, scope and asset terms](docs/gaussian-avatar-gaze.md).

## Tests

During development, run the affected tests and a brief smoke check. Reserve full regression/performance/device matrices for release readiness or an explicit request. The commands below describe isolated integration/release validation, not a required loop for every edit.

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

Before cutover, preserve the actual running image/configuration and make a consistent Mongo/media backup; rehearse restore and rollback in isolated copies. Startup cleans uploaded files absent from the connected MongoDB, so never combine a staging/empty database with the live `wall_media` directory. Verify UID 1000 write access, every production media mount, HTTPS and WebSocket forwarding. Keep one worker and one application replica until realtime state has a shared owner.

Branch/PR CI runs integration, unit, browser, clean-image and host-free release-script checks. Push and merge events never deploy production. The manual `deploy.yml` workflow offers `inventory`, `prepare`, `accept-staging`, `hold`, `accept-private`, `promote` and `rollback`; `validate` runs the normal quality job. `gallery-regression` runs focused membership, edit and layout checks against an isolated Mongo instance without touching the deployment host; it does not replace the final push quality gate. Host operations share one queue and a host lock, run as UID/GID1000 with Docker access, and keep the existing runner-root checkout intact. Operations code is checked out at the workflow SHA in `.release-checkout`; the separately selected product SHA is checked out in `.candidate-checkout` for preparation and hold.

Use a new lowercase `release_id` for each preparation. Its private backup and evidence directory is `$HOME/.local/state/metamuseum/releases/<release_id>`. `candidate_sha` accepts a full lowercase 40-character SHA and defaults to the selected workflow ref's SHA. Preparation requires a successful **push** quality run for that exact candidate, verifies its clean checkout and matching package versions, and builds only that checkout. The immutable `metamuseum:<version>-<sha>` tag carries OCI revision/version/source labels; operations bind the resolved image ID. Preparation verifies the running legacy image against [the recorded source/image evidence](docs/releases/legacy-production-verification.json), briefly stops the app for a paired database/media snapshot, resumes production, and restores separate candidate and legacy staging copies on isolated internal Docker bridges with no host/public port publication; resource identities are recorded in each private staging `resources.json`.

For a candidate branch, replace `master` below with that branch for `prepare` and `accept-staging`. For cutover, prepare and accept a fresh image of the final current master SHA; `hold` and `promote` require dispatch from master, equality with current `origin/master`, and green push quality for that exact SHA.

```sh
gh workflow run deploy.yml --ref master -f operation=prepare -f release_id=v2-release-1 -f candidate_sha=<40-character-sha>
gh workflow run deploy.yml --ref master -f operation=accept-staging -f release_id=v2-release-1 -f candidate_sha=<40-character-sha>
gh workflow run deploy.yml --ref master -f operation=hold -f release_id=v2-release-1 -f candidate_sha=<40-character-sha>
# Copy the explicit cutover-... basename printed by hold into attempt_id:
gh workflow run deploy.yml --ref master -f operation=accept-private -f release_id=v2-release-1 -f candidate_sha=<40-character-sha> -f attempt_id=<cutover-basename>
gh workflow run deploy.yml --ref master -f operation=promote -f release_id=v2-release-1 -f candidate_sha=<40-character-sha> -f attempt_id=<cutover-basename>
# Recovery uses the captured attempt without requiring new CI or current-master equality:
gh workflow run deploy.yml --ref master -f operation=rollback -f release_id=v2-release-1 -f attempt_id=<cutover-basename>
```

Run these operations sequentially and inspect each result. After an RC rehearsal, close-staging validates both isolated stacks, removes their containers/networks, and retains all paired data and backups without retaining idle application or Mongo processes. Failed incomplete stacks use abandon-staging with the same exact candidate SHA and retain all paired data. Keep the final rehearsal stacks running until private acceptance has read the pristine legacy account digests. Selecting `hold` authorizes the final paired snapshot and moves the accepted candidate to private loopback51739, closing public port51736. After the final paired backup, hold idempotently imports the 44 packaged defaults without overwriting existing presets; private acceptance verifies their visible catalog. Staging acceptance creates and cleans owned fixtures only in copied data; private acceptance checks the live candidate and references that same image's staging evidence. Selecting `promote` publishes the explicitly identified accepted attempt on51736. Rollback restores that attempt's exact original image/configuration; restoring paired data is a separate decision. Only sanitized inventory is uploaded as an Actions artifact; backups, environment material and detailed acceptance evidence remain private on the host. See the [executable release plan](docs/releases/v2.0-readiness.md) for the remaining release gates.

Review [third-party notices](THIRD_PARTY_NOTICES.md) before public distribution: the pinned wall source has no root license, and its marks/research artwork need documented release rights. Private Gaussian/FLAME assets remain excluded from production. The [release review](docs/releases/v2.0-readiness.md) separates code readiness from these operational and asset-release decisions.

## Layout

- `backend/metamuseum`: ASGI APIs, preserved MongoEngine models, room services and local static media.
- `frontend/src`: React UI, managed A-Frame scenes and extracted wall engine.
- `frontend/public`: pinned runtimes, source presets, fonts and provenance.
- `contracts`: historical BSON/route/event evidence and current API contracts.
- `backend/tests`, `frontend/tests`: isolated integration and browser suites.

Original Flask runtime and dependency manifests are retired; historical behavior remains reproducible from Git. [Third-party notices](THIRD_PARTY_NOTICES.md) include the pinned wall source and renderer assets.
