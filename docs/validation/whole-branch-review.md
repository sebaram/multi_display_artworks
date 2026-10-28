# Final whole-branch review record

Final status: **APPROVED**. Both Important findings below were fixed in `eb369bc` and `bd83165`; the independent focused closure found no remaining Critical/Important issue. Final root verification: backend181 +5 subtests, frontend231, development browser30, production-build browser29, clean-image smoke and media persistence passed.

## Original findings (resolved)

# Independent whole-branch review

**Verdict: CHANGES_REQUIRED**

What this change does: It replaces the Flask runtime and gallery UI with FastAPI and React, preserves the existing Mongo models and media paths, and adds durable wall designs with shared room interaction and playback. The review found two concrete artwork-editor regressions at the integration boundary.

## Scope and evidence

- Exact reviewed range: `974bbfd74ecd9a1330a03d7dd2a19994209ec8f5..bf4fe33cac992630e92189dd721ec004163947e9` on `codex/fastapi-react-interactive-walls`.
- Read the approved design and implementation plan, feature-parity/UI/wall-design contracts, previous frontend findings and closure evidence, and connected implementation. Focused tracing covered app/session routing, Room and scene mounting/updating, realtime membership/design/playback ordering, gallery relationship persistence, preset/binding/asset references, runtime packaging, production media mounts, and CI commands.
- Expected operation is the documented single Uvicorn worker, multiple room visitors, and administrators editing existing artwork and wall designs. The intentional CI-only workflow and unactivated production workflow proposal are not defects.
- Independently executed two pure, database-free Node/jsdom checks below. No database, browser, reset, deployment, product-file edit, staging, or commit was performed. Existing reported suite results are contextual evidence; this review does not claim to have rerun them.
- The implementation-plan file already had an unrelated modification when review began; it was not changed by this reviewer.

## Must fix — Important

### 1. [P2] Accept the relative media paths already stored in legacy artwork

**Location:** `frontend/src/features/room/Room.tsx:754-762`, especially `type="url"` at line 760.

**Failure:** The artwork inspector puts the stored media source into a native URL input. Existing supported sources such as `/static/image/dance_i.jpg` and `static/splat/hail.splat` are relative paths, so the browser marks the input invalid and prevents the form's submit event. An administrator opening one of these artworks cannot save even an unrelated position/name edit without first rewriting its media URL. The renderer explicitly supports relative sources through `safeMediaUrl`, the DTO preserves the stored string, and the production compose file documents these legacy asset paths. The synthetic E2E fixture instead uses absolute `http://127.0.0.1:8766/...` sources, which do not expose this problem.

**Independent reproduction:** In the installed jsdom, create `<form><input type=url></form>` and assign each stored source. `/static/image/dance_i.jpg` and `static/splat/hail.splat` both return `input.checkValidity() === false`, `validity.typeMismatch === true`, and `form.checkValidity() === false`; the absolute fixture URL returns true. This reproduces the native validation gate before React's save handler or any backend call.

**Smallest fix:** Use an input that accepts the application's supported relative paths, with validation against the same supported HTTP(S)/relative-source rules as the renderer. Preserve the existing stored path instead of requiring an absolute rewrite.

**Regression:** Render an artwork inspector with a root-relative image URL and a path-relative splat URL, edit a transform, and submit through the normal form control. Assert the form is valid and the PATCH is issued with the original source unchanged. Include an absolute URL case and reject unsupported schemes.

**If skipped:** Editing legacy media-backed artwork through the new room inspector remains blocked despite successful fixture-based admin tests.

### 2. [P2] Reload the owned splat component when its source changes

**Location:** `frontend/src/scene/mountRoom.ts:703-722` (the update path handles image and GLTF sources only); connected caller `frontend/src/features/room/Room.tsx:754-762` and save completion at `:678`.

**Failure:** The inspector exposes `splat_url` editing and calls `instance.update` for both draft changes and successful saves. That adapter changes transforms, image sources, and GLTF sources, but never changes/reloads the `gaussian_splatting` component. Change an existing splat from an absolute `old.splat` source to `new.splat` and save: Mongo and the inspector now contain the new URL, while the visible artwork continues to show the old splat until a full scene reload. This violates the selected-artwork source editing flow and makes the saved result differ from the current preview. Since artwork saves now correctly preserve the mounted room, a scene remount no longer incidentally masks this omission.

**Independent reproduction:** Transpiled and executed the actual `mountRoom.ts`, lifetime, coordinates, and clocks in Node/jsdom, with only unavailable A-Frame/renderer externals stubbed and no backend. Mounted a `gaussian_splat` whose source is `http://example.test/old.splat`, then called `instance.update` with `http://example.test/new.splat`. The actual element's `gaussian_splatting` attribute remained `src: http://example.test/old.splat` before and after the update.

**Smallest fix:** On an effective splat source change, replace/reinitialize only that artwork's splat component, preserving its clipping configuration and transform. The vendored component loads the source in `init/start` and has no `update` hook, so assigning a new attribute alone is insufficient; use its existing removal cleanup or implement a lifecycle-safe source reload. Keep the rest of the room, socket, camera, and voice session mounted.

**Regression:** Change a selected splat source and verify the new source is loaded in the same room instance; revert it and verify the old source is restored. Assert old worker/reader/GPU resources are disposed and the clipping reference survives. A focused real-browser media case should verify the rendered replacement in addition to the adapter test.

**If skipped:** A successful splat source save leaves administrators approving and viewing the old asset, with the replacement appearing only after navigation or reload.

## Remaining review limits

No additional Critical/Important finding was confirmed in the inspected integration paths. This is a focused whole-branch integration review layered on the completed task reviews, not a re-review of every vendored or generated line. Consolidated browser tests and final image rebuild belong to the root task and were deliberately not disturbed. Physical XR/mobile GPU, paid/live provider coverage, and an actual production-data restore retain the explicitly documented validation limits.

Verdict: fix 1 and 2 before approval.


## Independent fix verification

# Independent whole-branch fix review

**Verdict: APPROVED**

What this change does: It restores normal artwork saves for supported relative media paths and reloads a changed Gaussian splat within its existing scene. It also clears a removed YouTube selection so reapplying a design does not reopen an old player.

## Exact scope

- Reviewed fix range `bf4fe33cac992630e92189dd721ec004163947e9..bd83165233e850dfffd86c102c6e32353b7b4838`.
- This is the requested focused closure of the two Important findings in `whole-branch-review.md`, plus inspection for regressions introduced by those fixes and the YouTube selection correction. The prior review's broader scope and explicit device/provider/production-data limits remain applicable.
- Read the actual runtime changes, connected adapter/component lifecycle, regression tests, browser acceptance changes, fixture helper changes, and `whole-splat-fix-report.md`. No product edits, DB access/reset, browser execution, deployment, staging, or commit were performed by this reviewer.

## Finding closures

1. **Relative media form validation — closed.** The inspector now uses a text input with URL keyboard hints and native custom validity based on the actual renderer's `safeMediaUrl`. Root-relative, path-relative and absolute HTTP(S) values remain valid without rewriting stored strings; unsupported schemes remain invalid. The tests import the real URL helper, use the normal submit control, and verify the PATCH retains the original media source. The real-browser test also checks both relative forms, persistence, and the existing scene identity.

2. **Splat source update — closed.** The adapter compares normalized effective sources before merging the patch, then removes/reinitializes only the affected `gaussian_splatting` component. This invokes the vendor's existing cleanup and init paths while keeping the artwork entity, clipping selector/object, transform, camera, and room lifetime. Transform-only updates and unchanged effective sources avoid a reload. The focused regression verifies replacement, revert, clipping and identity preservation; the reported real-browser evidence checks the actual 512→343→512 source loads, rendered pixels, persisted sources, and old worker/reader/GPU disposal. Source inspection is consistent with that evidence.

3. **YouTube selection sanity — passed.** Removing the selected live layer now clears its stored selection as well as unmounting the player. Reapplying a design therefore leaves the player closed until an explicit selection. The existing source-change behavior remains intact, and the focused unit test verifies remove/reapply does not mount another player.

## Independent verification

Executed from `frontend`, with `TEMP`/`TMP` pointing at the existing local `.tmp` directory:

```text
node node_modules/vitest/vitest.mjs run tests/unit/room-review.test.tsx tests/unit/scene-mount.test.ts
Test Files: 2 passed
Tests: 14 passed
Duration: 3.16s
Exit: 0
```

Also executed `git diff --check bf4fe33..bd83165`; exit 0, no output.

Inspected the shared-pointer test correction: it now waits for both clients to observe the same authoritative binding/runtime/sequence/pointer instead of making an immediate cross-client timing assertion. It retains the convergence assertion and introduces no production pointer change. The FFmpeg fixture helpers now honor `FFMPEG_PATH`, then PATH, with the existing bundled fallback; no runtime dependency or backend schema is changed.

## Outcome

No outstanding Critical/Important finding remains from this review, and no new Important regression was confirmed within the requested fix scope. Final consolidated browser execution and final image validation remain with the root task; this approval does not claim those pending runs were independently rerun here.

Verdict: Ship after the root task's remaining final verification completes.
