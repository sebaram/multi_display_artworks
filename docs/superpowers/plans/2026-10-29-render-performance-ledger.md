# Render performance execution ledger

- Baseline: 52ee0b4. Feature branch codex/render-performance-lod.
- User approved the recommended sequence and earlier requested subagents. Proceed without another approval round.
- Ruling: reuse the current checkout on a separate feature branch — existing dependencies, benchmark fixtures and authorized branch workflow — avoids copying the large local fixture store; no main/production edits.
- Baseline restricted-environment test attempt hit Windows temporary-file rename EPERM before executing tests. Retrying the same test suite outside that restriction; not a product test failure.
- Official registry audit: A-Frame 1.8.0 uses super-three r184; Spark 2.4.0 requires Three >=180. Shared-runtime integration is feasible; validate before switching production gallery runtime.

## Implemented checkpoints

- b38797e: dirty wall composition, clock-only media synchronization, visibility/residency/quality policy primitives, 10 Hz minimap.
- 8fecac6: stable artwork roots and bounded sources, shared image textures, owned glTF cancellation/cache cleanup, A-Frame1.8/Spark2.4 single-namespace adapter and aggregate LOD, XR-aware scheduling, selection pinning and adaptive settings.
- 8848d7b: failed model generation cleanup and release of decoded originals after image downsampling.
- 6a9b7c3: remove hidden image/model proxies from matrix traversal, keep splat proxies attached for picking, register mesh-owner cursor targets and batch their refresh.
- 6c54704: forceSinglePass for transparent 2D image planes. A real Chrome static view retained exact RGB pixels while draw calls changed197→101.
- ed8d556: legacy binary splat bounds scan before transfer avoids decoded per-point/quaternion traversal on reacquisition. Ordinary scales have conservative 4% padding; format/count/malformed values fall back. Scoped review caught decoded NaN/Infinity on negative/extreme raw scales; two failing regressions established the fix, then all25 adapter tests passed and the reviewer approved.
- d9317cb: final screenshot review revealed darker lit geometry after Three removed legacy lighting. Embedded old/new shader light setup confirmed the missing PI factor; compensating only the owned ambient1.5×PI restored all4 sampled native-Chrome wall/floor RGB values. No exposure/tone changes. All298 frontend tests/build passed again, E2E9 passed in41.1s. Remeasure all24 optimized trials after this fix rather than retain the earlier selective source reuse.
- a941868: image-only mobile regression exposed the missing inactive display reuse from Task2. Immediate final-consumer disposal caused downloads/resizing on every return after4s grace. Added scene-owned ready/downsampled-only LRU,32MiB estimated canvas+RGBA mip bytes, active excluded; pending/failed/original/oversized entries dispose immediately. Focused31 ownership tests and independent review approved; full121Vitest+109legacy+76wall=306 and build passed. Native mobileimage300 recovered≈36→55FPS and mixed300≈27→48FPS in two repeats. These are development-to-final diagnostics, not the original baseline comparison.

Ruling: Tasks2–4 share mountRoom interfaces and were integrated in one commit after their separately scoped agents/tests — avoids artificial partial runtime states — each path has focused and browser verification.

## Review and verification

- Independent wall review found XR eye world-matrix recomputation and late wall resolution issues; both reproduced and fixed with regressions.
- Independent resource review found device-cap hysteresis and singular model bounds; both reproduced and fixed.
- Whole-change review found active failed glTF parses retained private caches; failure and late-dependency tests reproduced it, cleanup fixed and scoped re-review approved.
- Proxy review caught splats losing pick geometry; preserved their attached hidden proxy and verified real canvas clicks for image/glTF/splat/webpage plus stable DOM roots. Scoped review approved.
- Final frontend suite after a941868:121 Vitest +109 legacy +76 wall/source =306 tests; typecheck/build passed. Existing build chunk-size warnings remain.
- Final browser regression suite after a941868:9 passed in40.2s, including actual source replacement/GL deletion/worker teardown, shared pointer and play/pause/seek, late join/reconnect, presence, AR event relay, room lifecycle and saved location. Actual canvas picking of4 artwork types passed again.
- Server gallery/shared-wall compatibility:49 passed on the marker-guarded synthetic database. Only existing datetime deprecation warnings.
- Actual-device collector regression now excludes Spark internal passes from FPS and chooses mock XR/window loops correctly (2 tests); this does not constitute a physical-device test.

## Measurements and reporting

- Preserved original52ee0b4 production bundle before any rebuild under ignored output/playwright/render-optimization/baseline-dist. Test app8101 serves it;8102 serves the frozen final build; assets8767 use retained perf Mongo DB. Separate browser fixture API8000/assets8766 use guarded metamuseum_test.
- Final source-product revision is a941868d85045db9a61537d18fdd0ade2e8eddb3. All24 optimized trials are remeasured after the light-compatibility and inactive image cache corrections; all22 baseline trials remain unchanged. Packager requires this one final optimized source revision. Documentation/tool commits do not change source revision; runner audits clean product paths.
- Final matrix:46 selected trials, two repeats: desktop6 workloads×baseline/fixed; stationary splat×baseline/fixed; PC mobile stress4workloads×baseline/adaptive; desktop adaptive4livewalls. Earlier implementation revisions are preserved and excluded in full, never selected by performance.
- One local image request returned ERR_NO_BUFFER_SPACE. Its trial remains invalid in raw evidence and was rerun unchanged. No global memory exhaustion was found; exact transient network cause was not isolated.
- Reporting scope: fixed buffers still enable image/splatLOD and residency; rotated paths include actual load/eviction work. Record endpoint pending assets. CPU/RAM observation includes browser measurement/trace-return work and cannot be treated as pure application CPU. GPU usage is an owned-process post-screenshot snapshot; actual phones/Quest remain unmeasured.
- Native NVIDIA Chrome measurements ran sequentially:139 recorded attempts,46 selected,93 superseded/invalid excluded (one invalid). All24 selected optimized rows use a941868. Independent audit recomputed headline medians/worst-repeat p95 and verified all7 evidence hashes and25 screenshot hashes.
- Final self-contained report is docs/reports/render-optimization.html (7,481,567bytes). Actual Chrome QA passed:23 grouped conditions/46 trials,25 decoded images, profile/search/detail filters, zoom/Escape,390px no document overflow, actual JSON download/content validation, no page errors and no external resource requests. Artifact/validation JSON records final file hashes.
- Final tradeoffs remain visible: unique-image GPU snapshot1936→534MiB; stationary splat instrumented CPU328.2→25.4core%; live-wall fixed FPS45.5→43.4 versus adaptive51.0; PC-mobile image56.4→55.1 and mixed47.8→47.8, with mixed p95worst33.9→39.9ms. Fixed/adaptive quality and splat/cache memory costs remain disclosed; these do not certify phones/Quest3.
