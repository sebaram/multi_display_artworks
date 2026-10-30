# SMPL Compatibility Implementation Plan

> **For agentic workers:** Use the supplied task brief and focused development validation in AGENTS.md. User approval to proceed and the no-model constraint are recorded in the spec; no new approval round is needed.

**Goal:** Import and play SMPL/SMPL-X body motion on the current humanoids and retain source shape parameters without requiring licensed model files.

**Architecture:** A pure bounded parser/retargeter feeds a scene-owned playback controller. Owner-generated core22 poses use the existing transport; shape metadata uses the existing revisioned appearance save. The private editor preview remains separate from live playback.

**Tech Stack:** Existing TypeScript/React/A-Frame/Socket.IO/FastAPI/MongoEngine. No new runtime dependencies.

**Spec:** ../specs/2026-10-30-smpl-compatibility-design.md

## Global Constraints

- No licensed models/packages downloaded or terms accepted. Native mesh/learned deformation/finger-face rendering is unavailable until licensed assets exist.
- Current392-byte pose protocol, server input bounds and client-only pose generation remain unchanged.
- File trajectories never drive the camera; XR entry clears imported playback.
- Optional parametric metadata preserves legacy/owner/revision/CSRF behavior; motion frames never go to MongoDB.
- No Quest/device work, exhaustive suites, performance matrices, broad review gate, push, merge or deployment.

### Task 1: Motion compatibility, owner playback and saved source parameters

**Files:** Create focused parser/retarget/playback modules under frontend/src/avatar/, a small import/control component under frontend/src/features/avatar/, self-authored example JSON under frontend/public/avatars/, focused unit tests, a schema regression test, and docs/smpl-compatibility.md. Modify avatar/types.ts, appearance.ts, AvatarEditor.tsx, AvatarPreview.tsx, scene/realtime.ts, the necessary profile controls/lifecycle, backend/metamuseum/schemas_avatar.py and only connected serialization/types call sites that need the optional field.

**Interfaces:** Pure parser takes JSON data/text and produces a bounded immutable motion clip with explicit model/fps/basis/betas and supported/unsupported channels. Retarget sampling produces current AvatarPoseV2 from the clip and a caller-supplied visitor anchor/time; no transport import. A scene-owned controller handles play/pause/stop/dispose. The existing appearance gains optional parametric metadata `{model,betas}`. Choose and document minimal concrete exported names before implementing, and use those names consistently.

- [x] Add focused failing tests for malformed/oversized frames and metadata, SMPL/SMPL-X layout, neutral T-pose bind correction, rotated-parent elbow, root/basis conversion and playback pause/stop/XR/lifecycle isolation.
- [x] Implement parser, retargeter, a small self-authored example and scene-owned playback; preserve the current transport and default IK behavior.
- [x] Add private import preview and live playback controls, clear unsupported-feature/root-trajectory messages, and optional parameter persistence through existing owner-scoped Apply. Cancel and rejected saves do not affect active playback.
- [x] Validate optional metadata on frontend/server; test legacy absence, valid roundtrip and invalid model/bool/nonfinite/size/unknown fields. Inspect connected serializers so the field is not silently dropped.
- [x] Run only affected tests plus typecheck/build. Use isolated test DB if a targeted API check needs it; do not reset perf/prod DB or resume device work.
- [x] One short real two-page browser smoke of preview/apply/sync/pause/stop/reload. Write concise usage and a small HTML feature note with screenshots/limitations, commit, and report exact checks and remaining asset-dependent work.

Native SMPL/SMPL-X mesh deformation and finger/face channels are asset-dependent follow-up, not a claim made by this compatibility delivery.

