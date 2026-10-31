# Migration validation and release notes

This document preserves the original migration-stage evidence. Its suite counts and deployment observations are historical, not a measurement of the latest branch head. For current release scope and remaining production gates, see the [2.0 release review](releases/v2.0-readiness.md). Candidate `71f9a3b` passed [CI 41192279779](https://github.com/sebaram/multi_display_artworks/actions/runs/41192279779).

Original migration branch: `codex/fastapi-react-interactive-walls`. Historical baseline: `974bbfd74ecd9a1330a03d7dd2a19994209ec8f5`.

## Data compatibility

The13 original MongoEngine document schemas, collection names, ObjectIds, inheritance tags, references, ordering, bcrypt hashes and signed confirmation/visitor formats are preserved. A local Whisper endpoint may now omit its API key; nonlocal providers still validate a key. Existing documents round-trip unchanged in the synthetic18-document compatibility fixture.

New collections include `wall_design_presets`, `wall_design_bindings`, `wall_design_assets` and the later owner-scoped `avatar_profiles` collection. Applied snapshots remain independent of later preset edits/deletion. Binding removals retain monotonic revision tombstones. Uploaded media is persistent filesystem content with Mongo metadata and reference checks; do not back up one side alone.

## Before production migration

1. Back up the existing MongoDB and all original media mounts plus `wall_media`. Retain the current container image by immutable image ID/tag.
2. Restore the dump into an isolated staging database. Configure staging with its own secrets/origin, media copies and exactly one Uvicorn worker. Never point fixture reset tools at that database.
3. Compare IDs, collections, inheritance tags, ordered forward/reverse refs, indexes, password login and representative original media URLs. Import the44 defaults and test a saved/applied/uploaded design in staging.
4. Exercise room/wall/artwork/admin/Socket.IO and late join/playback. Stop the new image and start the previous image against a second restored copy to rehearse rollback. New additive collections may remain; the previous application ignores them. Restore media and Mongo from a paired backup when rolling back data.
5. Ensure HTTPS, WebSocket proxying, explicit `ALLOWED_ORIGINS`, writable uid1000 wall-media/stream directories and the unchanged51736 loopback proxy. A new session cookie requires one re-login.

Production snapshot access was not supplied, so this production-data rehearsal has not run. No production database, media or deployment was modified.

## Evidence ledger

Independent task reviews and exact test commands were recorded during implementation. All available integration gates passed after the independent reviews and regression fixes. Source inspection and generated fixtures remain distinct from browser/device evidence. Machine-readable results are in [results.json](validation/results.json), and the resolved final review is preserved in [the review record](validation/whole-branch-review.md).

| Surface | Current evidence |
| --- | --- |
| Historical baseline | Python50 / JavaScript125 passed before migration;18 BSON documents and155 registered HTTP rules captured. |
| Backend auth/gallery/storage/realtime | Full suite:181 passed plus5 subtests in103.09s, using real guarded Mongo, Socket.IO, FFmpeg/RTSP and loopback provider/TLS/SMTP fixtures.150 inherited UTC-naive datetime deprecation warnings remain. |
| Source renderer | All44 presets render;12 built-in source images match pinned original at fixed time; actual A-Frame canvas texture, rich text/logo/video/brightness and cleanup exercised. |
| React gallery | Actual HTTP/admin/auth, visitor/presence, AR/gesture relay,512-point splat clipping, MP4, wall image and iframe allowed/blocked fallback browser tests passed. |
| Voice | Two actual WebRTC peer connections with synthetic microphones, live receiver tracks, mute/unmute, navigation cleanup/re-entry and administrator disable passed. |
| RTSP/HLS | Controlled RTSP H264/AAC source → managed FFmpeg → HLS; every generated TS decoded and process/directory cleanup passed. Actual RTSP and synthetic phone MediaRecorder → real FFmpeg → HLS browser playback passed. All11 generated fixture files passed HTTP/range/format and full MP4/HLS decode checks. |
| Wall editor / shared playback | Actual Mongo save/upload/thumbnail/apply/reload and both409 conflicts passed. Two-context MP4 play/pause/seek converges below0.5s drift; pointer pixels, room isolation, late join/reconnect, live apply/removal and legacy media restoration passed. Public YouTube iframe API play/pause/seek7s also passed, separately from the controlled external-API fixture. |
| Final frontend checks |47 Vitest +108 legacy Node +76 renderer tests =231 passed; typecheck/build passed; npm audit0 vulnerabilities. Development browser suite30/30 and the actual FastAPI-served production bundle29/29 passed. One Vite-only engine-audio harness is covered in the development suite. |
| Clean image | Final multi-stage image built; HTTP/SPA/deep links/local assets/Socket.IO/44 stored presets/Range206 passed. A real uploaded MP4 retained identical SHA-256 through container restart and image replacement using the persistent volume. Flask/Flask-Admin/Flask-SocketIO/eventlet are absent; FFmpeg5.1.9 is present. |
| Physical devices and external services | Physical XR/AR, microphones/cameras, mobile GPU FPS, TURN/network reachability and paid provider inference not exercised. Local synthetic inputs and upstream fixtures are explicitly distinguished. |
| CI | Existing remote master run40257231769 succeeded; self-hosted runner online/idle at inspection. New branch workflow runs validation only; proposed production job requires separate authorization. |

Automatic approval review rejected activating the rewritten production deployment job because production authorization was not explicit. The active workflow performs tests and builds only; the proposed job is a text artifact, not an executable workflow.


## Reproduction

After the guarded Mongo instance and procedural fixtures are prepared, run these sequentially with the app settings from README. FFmpeg may use `FFMPEG_PATH`.

```sh
python -m pytest backend/tests -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high
# API8000, Vite5173, fixture8766 and controlled RTSP8554 must be running.
E2E_BASE_URL=http://127.0.0.1:5173 RTSP_FIXTURE_URL=rtsp://127.0.0.1:8554/fixture npm --prefix frontend run test:e2e
E2E_BASE_URL=http://127.0.0.1:8000 RTSP_FIXTURE_URL=rtsp://127.0.0.1:8554/fixture npm --prefix frontend run test:e2e -- --grep-invert 'uploaded engine video uses public local-audio API'
docker build -t metamuseum:migration-check .
```

The first browser suite exercises the development harness; the second runs the same product flows directly from the production React bundle served by FastAPI. Both use the actual backend and Mongo; only external AI/STT/email services are replaced by loopback fixtures. The public YouTube availability case additionally played the real external player. Test cleanup removes only owned temporary records; Python reset tools enforce the dedicated Mongo marker.

## Decisions made during implementation

| Decision | Cost if the assumption is wrong |
| --- | --- |
| Preserve original source group ungroup/restore and custom object order; no arbitrary cross-root group graph. | Arbitrary grouping needs a new schema and renderer/editor extension. |
| Allow an empty STT key only for the local provider; remote labels still validate a key. | Another keyless provider needs a scoped validation adjustment. |
| Retain MiniMax STT as the configured OpenAI-compatible gateway contract, without claiming native MiniMax inference. | A native service requires its own adapter and live acceptance. |
| Keep migration CI validation-only; save the production job as a proposal after automatic approval rejected activation. | Automatic deployment after merge requires explicit authorization and integration of the proposed job. |
