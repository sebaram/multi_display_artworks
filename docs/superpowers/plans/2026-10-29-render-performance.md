# Gallery Render Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce unnecessary CPU/GPU/memory cost while preserving shared gallery behavior.

**Architecture:** Use scene-owned XR-aware scheduling and conservative view visibility, bounded artwork residency, one shared modern splat renderer, and hysteretic quality defaults. Preserve canonical server clocks and Mongo persistence contracts.

**Tech Stack:** React/TypeScript, A-Frame 1.8.0/shared super-three r184, Spark 2.4.0, existing wall engine, Vitest/node tests, actual Chrome browser and existing performance fixtures.

**Spec:** ../specs/2026-10-29-render-performance-design.md

## Global Constraints

- Branch codex/render-performance-lod based on 52ee0b4; no production deployment, push/merge or database migration.
- Retain existing saved URLs, cutouts, transforms, admin selection and canonical multiplayer clocks.
- Physical phone and Quest 3 measurements are unavailable; emulation remains labelled.
- One shared Three runtime for A-Frame and Spark; retain source/license provenance.
- Treat unknown bounds conservatively and stereo visibility as the union of both eye views.

## Review Focus

- Hidden wall receives seek/pause/pointer/config updates and returns at current shared state.
- Teleport, nonuniform scale, nested transforms and edge-of-frustum objects must not disappear incorrectly.
- Late image/model/splat load completion after eviction or room disposal must not reattach GPU resources.
- Repeated assets must not be disposed while still used elsewhere.
- Adaptive quality must recover slowly and must not change logical playback or thrash resources.

### Task 1: Visible/dirty wall scheduling and redundant work

**Files:** scene/mountRoom.ts, new scene/render-policy.ts, wall-engine/renderer.js and compositor.js/types.ts, scene/legacy/minimap.js, corresponding frontend unit tests.

**Interfaces:** `createViewVisibility(THREE, scene).update()` / `.intersects(object)`; wall `render(time, playback)` returns whether output changed; clock-only `syncPlayback(playback)` preserves media/YouTube state during skipped drawing.

- [x] Add failing tests for stereo visibility, unknown bounds, dirty static render, hidden shared clocks and canceled scheduler.
- [x] Implement conservative visibility and an owned A-Frame tick component; skip hidden wall source render/upload while keeping shared events active.
- [x] Reduce minimap refresh to 10 Hz and raycaster interval to 50 ms, keeping immediate user-triggered updates.
- [x] Run affected tests then full frontend suite; review diff and commit independently.

### Task 2: Bounded asset residency

**Files:** new scene/artwork-resources.ts and scene/artwork-residency.ts, mountRoom.ts integration, focused tests.

**Interfaces:** artwork resource controller `{load, unload, update, dispose}` with generation guards; residency selection takes view state/time and returns active resources without replacing artwork roots. Exact helper interfaces recorded in execution ledger after source audit.

- [x] Add failing lifecycle tests for late load, shared URL release, grace periods, source changes and admin moves.
- [x] Implement controlled image/model resource ownership and residency; use splat component removal for eviction. Avoid relying on A-Frame gltf-model.remove for disposal.
- [x] Integrate visible/nearby prefetch, short eviction grace and bounded inactive cache; preserve artwork identity and interaction metadata.
- [x] Run tests and actual browser navigation/teleport/disposal checks; review and commit.

### Task 3: Shared Spark LOD renderer

**Files:** vendor A-Frame/Spark assets, gaussian-splatting adapter, provenance/licenses, loadAFrame/mountRoom integration, splat tests.

**Interfaces:** Preserve `gaussian_splatting` attributes and `splat-error`; adapter exposes readiness/point counts and scene-level LOD controls to policy. Spark's external Three import resolves to AFRAME.THREE.

- [x] Prove minimal official-package compatibility under real Chrome; add adapter lifecycle/contract failures before implementation.
- [x] Upgrade pinned A-Frame, install locally vendored Spark with shared Three bridge and required worker/WASM assets. Implement shared LOD renderer, cutout and nonuniform-transform behavior with conservative fallback if needed.
- [x] Verify overlap/depth/scale/cutout/source replacement and disposal in real gallery; regression-test avatars/controllers/AR initialization.
- [x] Run suite/build, review third-party provenance and commit.

### Task 4: Device defaults and adaptive quality

**Files:** scene/render-policy.ts, mountRoom.ts, splat adapter integration, unit tests.

**Interfaces:** pure quality controller consumes frame samples/visibility/XR target interval, returns a discrete quality level with hysteresis; scene applies pixel ratio, splat budget and wall source resolution on transitions only.

- [x] Add failing tests for overload, headroom recovery, hidden/long-gap samples, XR refresh and resize limits.
- [x] Apply conservative mobile/desktop/XR defaults and bounded hysteresis; never rewrite shared state or stored geometry/configuration.
- [x] Test adaptive/fixed quality separately and check predictable restoration after XR exit.
- [x] Review and commit.

### Task 5: Comparative evidence and final review

**Files:** tools/performance comparison additions, new docs/reports/render-optimization.html and supporting measurements/validation, README links.

- [x] Run real Chrome comparisons on old/new builds sequentially at fixed quality and identical view trajectories; separately show adaptive default tradeoffs. Include live walls, splat stationary/turning, unique images, model and repeated room lifecycle.
- [x] Run full frontend suite/build and relevant backend contract checks; verify report browser filtering/embedded resources and screenshots.
- [x] Request independent whole-change review, resolve findings and record remaining actual-device limitations.
- [x] Commit reproducible report; leave branch reviewable without deployment.
