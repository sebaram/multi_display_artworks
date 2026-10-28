# Migration validation and release notes

Branch: `codex/fastapi-react-interactive-walls`. Historical baseline: `974bbfd74ecd9a1330a03d7dd2a19994209ec8f5`.

## Data compatibility

The13 original MongoEngine document schemas, collection names, ObjectIds, inheritance tags, references, ordering, bcrypt hashes and signed confirmation/visitor formats are preserved. A local Whisper endpoint may now omit its API key; nonlocal providers still validate a key. Existing documents round-trip unchanged in the synthetic18-document compatibility fixture.

New raw collections are `wall_design_presets`, `wall_design_bindings` and `wall_design_assets`. Applied snapshots remain independent of later preset edits/deletion. Binding removals retain monotonic revision tombstones. Uploaded media is persistent filesystem content with Mongo metadata and reference checks; do not back up one side alone.

## Before production migration

1. Back up the existing MongoDB and all original media mounts plus `wall_media`. Retain the current container image by immutable image ID/tag.
2. Restore the dump into an isolated staging database. Configure staging with its own secrets/origin, media copies and exactly one Uvicorn worker. Never point fixture reset tools at that database.
3. Compare IDs, collections, inheritance tags, ordered forward/reverse refs, indexes, password login and representative original media URLs. Import the44 defaults and test a saved/applied/uploaded design in staging.
4. Exercise room/wall/artwork/admin/Socket.IO and late join/playback. Stop the new image and start the previous image against a second restored copy to rehearse rollback. New additive collections may remain; the previous application ignores them. Restore media and Mongo from a paired backup when rolling back data.
5. Ensure HTTPS, WebSocket proxying, explicit `ALLOWED_ORIGINS`, writable uid1000 wall-media/stream directories and the unchanged51736 loopback proxy. A new session cookie requires one re-login.

Production snapshot access was not supplied, so this production-data rehearsal has not run. No production database, media or deployment was modified.

## Evidence ledger

Independent task reviews and exact test commands were recorded during implementation. The final verification matrix is completed after integration; a source inspection or generated fixture alone is not a browser/device pass.

| Surface | Current evidence |
| --- | --- |
| Historical baseline | Python50 / JavaScript125 passed before migration;18 BSON documents and155 registered HTTP rules captured. |
| Backend auth/gallery/storage/realtime | Real guarded Mongo and Socket.IO suites; individual task reviews and regression fixes. Final full rerun pending integration. |
| Source renderer | All44 presets render;12 built-in source images match pinned original at fixed time; actual A-Frame canvas texture, rich text/logo/video/brightness and cleanup exercised. |
| React gallery | Actual HTTP/admin/auth, visitor/presence, AR/gesture relay,512-point splat clipping, MP4, wall image and iframe allowed/blocked fallback browser tests passed. |
| Voice | Two actual WebRTC peer connections with synthetic microphones, live receiver tracks, mute/unmute, navigation cleanup/re-entry and administrator disable passed. |
| RTSP/HLS | Controlled RTSP H264/AAC source → managed FFmpeg → HLS; every generated TS decoded and process/directory cleanup passed. Browser integration pending. |
| Wall editor / shared playback | Integration browser acceptance in progress. |
| Physical devices and external services | Physical XR/AR, microphones/cameras, mobile GPU FPS, TURN/network reachability and paid provider inference not exercised. Local synthetic inputs and upstream fixtures are explicitly distinguished. |
| CI | Existing remote master run40257231769 succeeded; self-hosted runner online/idle at inspection. New branch workflow runs validation only; proposed production job requires separate authorization. |

Automatic approval review rejected activating the rewritten production deployment job because production authorization was not explicit. The active workflow performs tests and builds only; the proposed job is a text artifact, not an executable workflow.
