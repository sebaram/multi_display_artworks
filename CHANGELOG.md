# Changelog

## 2.0.0 — 2026-11-01

The FastAPI/React release uses version 2.0.0 and is deployed from `2778ee4`. Actual image/source identities and recovery evidence are tracked in the [release execution record](docs/releases/v2.0-execution.md).

### Changes

- Replace the Flask runtime and Flask-Admin UI with FastAPI and React while retaining existing MongoDB documents, account hashes, gallery IDs and media URLs.
- Add persistent wall authoring with 44 source presets, layers/groups, text, shapes, motion, undo/redo, JSON import/export and uploaded video. Applied walls retain independent snapshots of saved presets.
- Share same-room pointers and canonical MP4 play/pause/seek state, including late join and reconnect. Permanent wall URLs provide passive displays without creating room visitors.
- Add four original humanoid presets, customizable appearance, owner-side motion/IK and relayed final joints; preserve legacy avatar choices. Untracked legs use estimated motion.
- Add desktop and mobile input, tab-local visitor presence, eleven resource editors, CSRF protection, reference validation and masked provider secrets.
- Retain image, GLTF and Gaussian splat galleries, managed RTSP/HLS, separate webpage/YouTube players, WebRTC voice and configured AR/gesture/AI/STT integrations.
- Preserve ordered room/wall membership from parent lists even when old child reverse links are missing or stale; keep explicit moves, deletes, layout context and inspector ownership consistent with those lists.

### Compatibility and operations

- Existing users must sign in again because the session cookie changes. The React signin submits CSRF-protected JSON; the old POST `/signin` form protocol is retired. GET `/logout` displays the UI without signing out; signout uses CSRF-protected POST.
- Generated Flask-Admin export/file/ajax-lookup protocols return `410` after administrator authorization. React resource editors replace those internals. See the [compatibility contract](contracts/feature-parity.md).
- Product version 2.0 does not rename `/api/v1`, MongoDB schemas or realtime protocol versions.
- Run one application worker and one replica while room state remains in process. FFmpeg, production HTTPS, allowed origins, existing media mounts and writable wall-media/stream directories are required.
- Back up and restore MongoDB and media together before cutover. Startup removes uploaded files absent from the connected database; an empty or staging database must never use the live wall-media directory. Production-copy staging and rollback rehearsal remain release gates.
- Preserve the verified Flask recovery source on `legacy-flask` and retain the actual running image/configuration separately. See the [cutover plan](docs/releases/v2.0-readiness.md).

### Experimental features and validation limits

- Procedural gaze is optional and off by default. It estimates gaze direction; perceptual naturalness and human attention have not been validated.
- GaussianAvatars subject 306 is a local research head/bust. Licensed FLAME/model/subject assets are excluded from the repository and production image; production blocks the asset API and preset. Dynamic Gaussian LOD and full-body support are not implemented; large-room native-avatar performance remains unmeasured.
- Actual LG V35 coverage is limited to WebGL, appearance save/reload, touch movement and desktop-observer updates. Phone FPS, thermal and resource-use claims are not established. Actual Quest 3 VR/controller/hand acceptance is incomplete; mock XR coverage is separate evidence.
- YouTube CI accepts either observed playback/pause/seek or a documented bot-login refusal with a visible error and original-video link. An `external_blocked` result is not successful playback. Controlled-player checks separately exercise application HTTP and Socket.IO synchronization.
- Voice CI uses real WebRTC with a synthetic microphone. Physical microphones/cameras, external networks, TURN and external providers need operational checks. Autoplay, buffering and network delivery still affect local playback timing.
- Review [third-party notices](THIRD_PARTY_NOTICES.md) and document upstream wall-source, marks and research-media release rights before public distribution.

The final merged source at `2778ee4` passed [CI 41214657998](https://github.com/sebaram/multi_display_artworks/actions/runs/41214657998), including all 49 browser cases, backend/frontend checks and a clean runtime against real MongoDB. Production-copy and private acceptance passed before promotion; public HTTPS/WSS, the original TV GLTF and all three room artworks were then checked. Historical reports retain their original capture dates and scope.
