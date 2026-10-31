# Migration baseline — 2026-10-29

Task0 completed against the unchanged legacy app. This captures a comparison baseline, not final migration acceptance.

| Check | Result | Evidence |
| --- | --- | --- |
| Python3.12.14, actual isolated MongoDB7 | **50 passed**,101warnings,2.73s | `2026-10-29-legacy-python.log` |
| Existing Node suite | **125 passed**,0failed | `2026-10-29-legacy-js.log` |
| Destructive fixture guard | Expected red before helper existed; **3passed** after implementation | `2026-10-29-fixture-guard-red.log`, `2026-10-29-fixtures.log` |
| Legacy model/BSON/password checks | **3passed**,18docs round-trip BSON and real model serialization; real bcrypt and LLM secret omission | `2026-10-29-golden-bson.log` |
| Real MongoDB synthetic seed | **18documents matched exactly**,ordered bidirectional refs preserved,external marker survived reset | `backend/tests/fixtures/verify_seed.py`; executed2026-10-29 |
| HTTP capture and authentication | **154 finite registered rules** probed anonymously; no500responses; real admin/nonadmin bcrypt login verified | `contracts/legacy-routes.json` observed statuses/shapes and synthetic_login_observations |
| Generated browser media | **10files** served,frame policies/range206 verified; MP4+HLS fully decoded | `2026-10-29-media.log`, `frontend/tests/fixtures/media-manifest.json` |

The command used for the legacy integration baseline was:

```powershell
.venv_legacy/Scripts/python.exe backend/tests/fixtures/run_legacy.py -q
```

The wrapper fixes Mongo URI/database to the dedicated direct connection and checks its external instance marker before every test. Tests run with real PyMongo; no mongomock substitution. The legacy suite includes its original seed regression under this guard. New runtime fixture setup instead inserts the synthetic golden documents and never calls legacy destructive seed scripts.

The initial non-escalated Mongo connection failed with Windows10013 sandbox network denial; rerunning with approved local-network escalation passed. Docker startup used the previously unused loopback27028 and isolated project/container `metamuseum-migration` / `metamuseum-migration-mongo`. The guard marker is in `metamuseum_migration_guard.instance`, outside `metamuseum_test`. The container remains available for following migration tasks; no production DB/network/container was modified. Resolved legacy Python versions are recorded in `2026-10-29-legacy-requirements.txt`; no compatibility pin or legacy app change was needed. MongoEngine UUID/UTC defaults and eventlet deprecation account for baseline warnings.

Reproduce checks:

```powershell
# Start only this isolated project after confirming27028 is free.
docker compose -f docker-compose.migration.yml -p metamuseum-migration up -d --wait
.venv_legacy/Scripts/python.exe backend/tests/fixtures/run_legacy.py -q
Push-Location flask_server
node --test tests/js/*.test.mjs
Pop-Location
.venv/Scripts/python.exe -m pytest backend/tests/fixtures/test_fixture_guard.py -q
.venv_legacy/Scripts/python.exe backend/tests/fixtures/legacy_golden_check.py
# These explicit commands reset metamuseum_test; coordinate with all integration runners.
.venv_legacy/Scripts/python.exe backend/tests/fixtures/verify_seed.py
.venv_legacy/Scripts/python.exe backend/tests/fixtures/capture_contracts.py
.venv_legacy/Scripts/python.exe backend/tests/fixtures/capture_http_observations.py
.venv_legacy/Scripts/python.exe frontend/tests/fixtures/generate_media.py
.venv_legacy/Scripts/python.exe frontend/tests/fixtures/verify_media.py
```

`legacy_golden_check.py` deliberately has no `test_` prefix: legacy Flask and new FastAPI both use the `metamuseum` module name and must never be imported into one pytest interpreter. It is run explicitly using `.venv_legacy`; ordinary backend discovery includes only the framework-independent guard tests from this fixture directory. New-backend golden tests belong in that backend's own suite.

Read `contracts/feature-parity.md` for exact coverage and required fixes. Current suites have zero failures, while known app deficiencies are recorded rather than hidden behind passing tests: disabled splat cutout, placeholder Webpage3D rendering, legacy login form validation/form logging, visitor403STT configuration, and remaining approved media/layout/effect/lifecycle repairs. This baseline did not test real browsers, actual providers, physical AR/XR devices, frame composition, clipping visuals or GPU performance. Local HTTP/FFmpeg media checks do not establish those later acceptance criteria.
