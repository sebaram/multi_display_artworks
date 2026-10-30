# Gaussian avatar gaze implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent engine task, then integrate inline. Track each stage below. AGENTS.md and the user's brief-validation preference override broad review loops.

**Goal:** Implement and debug a configurable procedural gaze experiment while establishing an honest native GaussianAvatars asset path.

**Architecture:** A pure deterministic attention controller feeds room pose metadata and a React lab. The existing Mongo profile stores configuration; the existing bounded relay carries angles. Native Gaussian rendering is a separate asset-dependent stage.

**Tech stack:** Existing TypeScript/React/A-Frame, FastAPI/Pydantic and MongoDB. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-gaussian-avatar-gaze-design.md`

## Global constraints

- 60 degree total forward cone, -Z forward, radians in packets, no sensor gaze claims.
- Keep the 392-byte binary pose and existing owner/revision/rate/size controls.
- No native-model substitution, unlicensed distribution or device work.

## Review focus

- Invalid/nonfinite targets/config cannot poison output.
- Head rotation and +yaw sign match the displayed diagnostic.
- Occluded/deleted targets release even during dwell.
- Eye-only updates count as changed poses; absent metadata returns neutral.
- Recording/config changes are reproducible and bounded.

### Stage 1: attention controller

Files: `frontend/src/avatar/gaze.ts`, `frontend/tests/unit/avatar-gaze.test.ts`.

Interface: export `GazeConfig`, `GazeTarget`, `GazeFrame`, `GazeSnapshot`, `DEFAULT_GAZE_CONFIG`, `normalizeGazeConfig(input, strict?)`, and `createGazeController(config?)` with `configure`, `reset`, `step(frame)`.

- [x] Write/run focused failing algorithm tests.
- [x] Implement controller: finite head-local eligibility, weighted stable selection, seed-based exploration, dwell/margin, bounded smoothing, diagnostic scores.
- [x] Pass focused tests; inspect the implementation inline.

### Stage 2: profile, relay and room application

Files: avatar types/appearance/pose codec, backend avatar schemas, room realtime and target sampling, avatar resources, editor controls.

- [x] Add validated optional configuration and solved-angle metadata, defaulting old clients to neutral.
- [x] Sample bounded scene targets on the owner; apply eyes and publish through existing relay.
- [x] Focused packet/profile tests, including malformed and eye-only changes.

### Stage 3: interactive lab and native readiness

Files: React gaze lab/controls, tools route, native setup documentation.

- [x] Add visual adjustable lab, ablation presets, JSON config import/export and bounded explicit recording.
- [x] Document exact native assets, binding/deformation route, license prerequisites and unresolved blockers in `docs/gaussian-avatar-gaze.md`.
- [x] Native model evaluation and browser rendering: original/mask ZIPs received; actual 306 package, CPU FLAME, bound Gaussian shader and browser proof completed.
- [x] Build and short browser smoke. Record observed results and remaining native/model-dependent work.

## Execution decisions

- Kept the existing isolated checkout and created `codex/gaussian-avatar-gaze`; no duplicate worktree/dependency installation.
- Applied user-requested brief verification instead of broad review loops; engine and lab implementation were delegated separately and integration inspected inline.
- Room line-of-sight currently checks simple wall boxes and at most 16 shortlisted candidates. This explicit limit keeps per-frame work bounded; arbitrary mesh occlusion is deferred.
- Recorded every filter frame (maximum 1200) instead of only 10 Hz selection samples, so variable frame-time filtering can be reproduced.
- After the masks arrived, implemented native FLAME export/evaluation and GPU binding in separate subagents. Kept data in the ignored local folder and allowed only three files on an opt-in loopback development route.
- Added an explicit local research bust preset following the common head anchor; ordinary humanoids keep their full body. Low detail uses a proxy instead of invalid static Gaussian merging.
- Actual FLAME is Y-up/Z-front. Replaced the inherited static-splat X flip with a Y rotation, and pinned the gaze sign mapping with a focused test.
- Verified actual WebGL portrait/gaze and a two-browser native room flow; no broad performance matrix or device work.
