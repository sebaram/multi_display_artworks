# Managed GSMV wall renderer

The engine preserves the source renderer at commit `b247fd238fe6cb2c8c860c77d13488b28b8a0290`. Original Three.js meshes never cross into A-Frame: consumers upload the output canvas as their own CanvasTexture.

```ts
import { createWallRenderer, normalizeWallLook, pointerFromUV } from './wall-engine/index.js';
const look = normalizeWallLook(sourceState);
const renderer = createWallRenderer({
  canvas,
  config: look,
  assetResolver: id => `/api/wall-assets/${id}/content`,
  onError: error => console.error(error.code, error.message),
});
renderer.resize(960, 540);
renderer.setInteraction(pointerFromUV({ u: .5, v: .5 }));
// The adapter calculates both clocks from canonical server state. No accumulated RAF delta.
renderer.render(animationSeconds, { positionSeconds: canonicalMediaSeconds, playing: true, rate: 1 });
renderer.dispose();
```

`render(animationSeconds)` takes the **already evaluated source animation timeline**, including configured offset/speed/pause. It does not read local wall clocks, URL, localStorage, window dimensions or schedule RAF. The optional second argument is a separately evaluated canonical media clock. Video layer motionSpeed/motionAnchor/motionOffset and looping are mapped from that clock. Drift above 0.5 seconds is corrected; paused seeks are applied exactly. Hidden video layers release their decoders. `assetResolver` accepts a persistent `videoLayers[].assetId` and returns a URL or Blob, synchronously or asynchronously. Engine-created Blob URLs are revoked; caller-owned Blob URLs remain caller-owned. A persistent saved look must use `assetId`, rather than a browser Blob URL.

`WallLookV1` is `{schema_version:1,source_commit,logical_screen,seed,state}`. `state` retains original source variant numbers and authored stable IDs. Plain source state is accepted by `normalizeWallLook` at import boundaries. The selected logical screen is cropped with the exact source panorama/camera rules. Canvas width/height belong to the adapter; there is no devicePixelRatio multiplication. Use identical config, pointer, time and dimensions for editor/display/room parity. Initial texture recommendations are 960×540 desktop and 480×270 small/mobile; actual GPU profiling must determine the final update rate and dimensions.

`getElements()` returns serializable source metadata, including stable IDs, semantic names, type, group/parent/root IDs, resolved transforms, base transforms, text/MV/animated flags, and original independent motion clock settings. It appends the original `media:<layer-id>` video IDs. `pick(x,y)` accepts top-left-origin normalized canvas coordinates and respects grouped source objects; text and video overlays take precedence over objects. The editor owns dragging, selection, history and draft state. The original pure `patchElement/addElement/removeElement/copyElement/pasteElement/authoringHistory` and appearance/video helpers are exported. Object deletion/grouping/part edits continue to use `state.authored[state.variant]` and original IDs. Edit videos through `state.videoLayers`, not `patchElement`.

`getYouTubeLayers()` returns read-only clones with original source metadata, placement, last canonical playback clock and `composited:false`. The canvas draws a clear separate-player control placeholder. The scene/React adapter owns the user-approved synchronized iframe player. No iframe pixels or cross-origin screenshots are represented as canvas-composited video.

`getStats()` exposes lifecycle, last supplied time, animated-object count and current visible media readiness/failure/autoplay state. `dispose()` is idempotent and releases DOM layout trees, media sources, owned font faces/Blob URLs, geometries/materials/textures/environment target, renderer caches and WebGL context. Context loss is reported and the original environment regenerated on restoration. Font/logo/asset/seek/autoplay failures use structured `onError` events.

`public/wall-presets/manifest.json` indexes all 12 built-ins + 16 Astra + 16 Meaning looks, with pinned provenance. The imported states are editable copies; source definitions and source keys stay stable. `wall-reference/provenance.json` records copied files and source hashes. Upstream catalog clip URLs are metadata only; no upstream research video binaries are included. The fixture MP4 is repository test material, unrelated to the upstream catalog.

The compositor uses browser typography/layout only when configuration, dimensions or fonts change. It caches a transparent text/logo canvas, then composes original WebGL + atmosphere + canonical uploaded-video frames + text/logo + whole-frame brightness. Styled text, wrapping, alignment, fonts, emphasis, list markers, underline/strikeout, scaling and planar rotation use original sanitized markup. Source operator-only framing/calibration guides are not part of the artwork texture; tile grids are included.
