# Gallery rendering and resource policy

The optimization branch uses A-Frame 1.8.0 (super-three r184) and Spark 2.4.0. Spark imports the A-Frame-owned Three namespace; it does not add another Three runtime to the gallery. The independent wall-source renderer retains its existing isolated canvas/Three boundary. Sources, local patches, licenses and byte hashes are recorded in `frontend/public/vendor/provenance.json`.

## Shared state and visible work

`gallery-render-work` runs inside A-Frame's animation loop, including immersive XR. Wall sources render only while their conservative bounding sphere intersects either eye's view. Paused unchanged sources and unchanged composed media skip drawing and texture uploads. Shared pointer/config/playback events continue to apply while hidden; canonical clocks restore the current image on return. Local audio preference is independent of camera direction.

The compact minimap paints at most 10 times per second; opening/resizing it paints immediately. The cursor raycaster checks at 50 ms intervals. Full wall occlusion behind arbitrary architecture is not implemented; basic view rejection remains conservative.

A-Frame 1.8 removed Three's legacy lighting multiplier. The owned ambient light uses `1.5 * Math.PI` to retain the previous room brightness; output color space, exposure and tone mapping remain unchanged. Four sampled native-Chrome wall/floor pixels matched the old room after compensation. This is not a guarantee that every PBR material is pixel-identical across Three versions.

## Artwork residency and image detail

Artwork roots, metadata, transforms, selection handlers and cutout entities remain mounted. Heavy sources load in the expanded view or a small nearest-first prefetch set within 8 m. Visible/selected/dragged artworks are retained. Sources remain resident for a 4-second grace period after leaving the view. Residency is reevaluated every 250 ms and invalidated by source/transform changes, selection and teleport.

Image display textures use quantized 128/256/512/1024/2048 sizes based on projected coverage, with hysteresis. The default cap is 2048 on desktop and 1024 on mobile/XR; selection requests the cap. Original source URLs are preserved. Same URL and size share one image/display texture. A downsampled display canvas releases its original decoded image reference. After the final consumer releases it, a successful downsampled display may enter a scene-owned inactive LRU with a 32 MiB estimated canvas-plus-RGBA-mip-chain budget. Active displays are excluded from that budget. Pending, failed, original-image and oversized entries dispose immediately. Reacquiring an inactive display avoids another download/resize/upload; room teardown flushes the entire cache. Actual browser/driver overhead is additional. Transparent flat image planes use one rendering pass for both sides, avoiding a redundant back/front pass. A detail change can briefly show the selectable placeholder while its replacement loads.

glTF scenes use dedicated generation-owned managers and GPU resources. Internal URL fragments isolate Three's in-flight/cache entries without changing the HTTP resource. Eviction and failures abort requests, dispose owned graphs and clear owned cache keys; stale completion cannot reattach a model. Existing Draco/Meshopt/KTX2 decoder settings are retained. Unknown or singular bounds fail open. Models use their existing mesh geometry; automatic mesh decimation is not included.

## Splat detail and lifetime

One Spark renderer handles every resident splat artwork in the scene. Existing `.splat` sources are fetched abortably, decoded and turned into hierarchical LOD in workers. Valid legacy 32-byte records establish conservative bounds directly from all source centers/scales before worker transfer, with 4% padding for Spark's logarithmic scale rounding. Other formats, count mismatches and malformed values use decoded all-source bounds. Negative or extreme scales keep unknown bounds if decoded extents become nonfinite. Original full-resolution arrays are then released. Legacy source axes, box cutouts and nonuniform artwork scales are preserved. Stationary scenes do not repeatedly sort or traverse unchanged LOD trees.

The normal aggregate budgets are 1.5 M on desktop, 500 K on mobile and 350 K in XR. These are initial policy values, not measured device capacity. LOD hierarchies, accumulators and sorting/readback buffers have memory overhead; lower CPU usage does not guarantee lower RAM/VRAM for a small splat scene. Existing `.splat` downloads still load a whole artwork before LOD construction; server-side LOD conversion and paged `.rad` delivery are not part of this change.

Final mesh removal releases owned shader/material/edit textures, the shared renderer and its sorting/LOD workers; idle decoder workers are released after the last consumer. Canceled decode completion is guarded and disposed.

## Quality adaptation

The controller starts at level 0 and checks approximately one-second windows. Three slow windows above 1.2 times the frame target lower quality; ten windows with headroom restore it slowly. Transitions have cooldowns. Hidden tabs and long suspension gaps do not lower quality.

Desktop/mobile levels adjust drawing-buffer pixel ratio, wall source resolution and splat budget. XR uses its reported session frame rate (72 Hz fallback), stereo visibility, reduced wall/splat budgets and supported foveation changes; the policy does not resize an active XR framebuffer. Rendering quality never changes Mongo configurations or shared playback state. Runtime diagnostics are on `scene.galleryPerformance`; `setFixedQuality(0)` disables adaptation for comparisons while retaining LOD and residency.

## Verification and limits

The comparison report preserves baseline `52ee0b4` separately and measures the actual optimized build through the same FastAPI app and synthetic fixtures. Fixed comparisons hold the main drawing buffer equal, but LOD/residency are part of the change and are not an assertion of pixel-identical quality. CPU/RAM observations also include browser-side sampling and trace-return work; image observation volume differs by implementation, so these are instrumented browser measurements rather than pure app CPU costs. Automatic quality runs disclose their actual buffers and wall-source sizes.

Physical phone and Quest 3 performance, thermals, stereo quality and frame cadence remain unmeasured. Desktop mobile CPU throttling does not emulate the phone GPU, workers or memory system. Actual-device acceptance remains required before setting production device budgets.
