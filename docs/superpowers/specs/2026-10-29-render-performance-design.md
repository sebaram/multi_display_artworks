# Gallery rendering performance improvements

User approval: implement the previously recommended order on a separate branch, retaining all gallery, authoring, multiplayer, shared interaction/playback and AR/XR behavior. No physical phone or Quest 3 is available.

## Intended behavior

1. Render live wall sources only when a wall is in either eye's view. Static/paused unchanged content does not need another texture upload. Continue accepting shared state while hidden; derive animation and playback from canonical time when visible again. Audio follows the local audio preference, not camera direction. Use the A-Frame tick driven by its XR-aware animation loop.
2. Keep artwork identity, placement, selection and metadata mounted, but load heavy image/model/splat resources near the view. Retain a small prefetch margin and eviction grace; bound inactive retention. Release owned GPU resources, abort/ignore late loads, and never dispose a shared resource still in use. Admin edits and teleports reevaluate residency. Unknown bounds fail open until measured.
3. Replace the older per-instance splat implementation with Spark 2.4.0 through a single shared Three runtime. A-Frame 1.8.0 includes compatible super-three r184. Keep existing gaussian_splatting component contract, source URLs, cutouts and transforms; support shared renderer, hierarchical LOD and per-device aggregate budget. Pin sources/licenses/hashes. Do not silently drop non-uniform scale or cutouts. Verify ordinary mesh depth composition and lifecycle.
4. Apply conservative device defaults and hysteretic quality adaptation. Device heuristics are starting settings, not physical-device measurements. Preserve user playback state and all logical geometry. Reduce render resolution/LOD budget/wall source resolution when sustained frame cost is high; recover slowly without oscillation. Keep splats from unilaterally changing scene-wide resolution.

## Scope and constraints

- Branch codex/render-performance-lod based on 52ee0b4; work in the current user-approved feature checkout.
- No production database changes, deployment, push or merge.
- Existing saved records/config/schema remain valid. Do not rewrite Mongo assets.
- CPU work for maps and selection can be throttled without disabling interaction.
- Frustum rejection is conservative and stereo-aware. Occlusion behind arbitrary walls is deferred until evidence justifies a separate spatial/occlusion system.
- Images can use bounded display textures while original URLs remain available for inspection; explicit quality limitations must be reported.
- A-frame upgrade must pass controls/avatar/AR/XR regression checks; device-only validation remains outstanding.

## Validation

Meaningful tests cover hidden-visible transitions with canonical clocks, paused dirty redraw, stereo union, grace/eviction and shared resource release, canceled asynchronous loads, source replacement, splat LOD/cutout/transforms, quality hysteresis and teardown. Run frontend suite/build and targeted backend unchanged-contract checks. Browser-test real rooms with images, models, splats and live designs; compare the previous synthetic scenes at the same buffer size plus default adaptive behavior separately. Preserve the original performance report and write a new comparison HTML with measurement scope and unresolved limits.
