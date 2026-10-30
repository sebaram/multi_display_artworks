# GaussianAvatars and procedural gaze

The user selected native GaussianAvatars heads and a configurable procedural gaze experiment. Eye tracking is deferred. Perceived naturalness and whether observers notice are hypotheses requiring a later participant study.

## Deliverables and sequence

1. A deterministic, client-side attention engine and a visible gaze lab: forward, nearest, and weighted conditions; independent attention weights; editable cone, dwell, switching, filtering and speed limits. Local recording is explicit and exportable with its configuration and algorithm version.
2. Apply the engine to room targets and transmit solved eye angles through the existing bounded latest-pose relay. Persist configuration through the existing owner-scoped Mongo avatar profile. Existing profiles and 392-byte joint payloads remain valid. The current humanoid can demonstrate the experiment but is never described as GaussianAvatars.
3. Native GaussianAvatars requires the actual subject checkpoint, FLAME assets, triangle bindings and deformation. Verify availability and rights before loading/exporting models. A static PLY or generic mesh is not an acceptable substitute. Missing model assets are an explicit blocker, not a completed integration.

## Builder choices

- Coordinates: meters, Y up, head-forward -Z, quaternion XYZW. Gaze angles are radians; positive yaw looks toward head-local +X and positive pitch toward +Y.
- Default cone is **60 degrees total (±30 degrees)**; editable 10–160. Max distance 15 m; max candidates 128. Selection 10 Hz; filtering runs on render frames. Signals absent from the scene contribute zero.
- Inputs: target ID, position, visible, kind (person/artwork/marker), speaking, interaction, motion and salience. Scores include center, proximity, person, speaking, interaction, motion, salience and novelty. Target selection has a minimum fixation, score margin and release grace. Never select behind the head or through an explicit visibility veto.
- Defaults: minimum fixation 600 ms, maximum fixation 4000 ms, switch margin 0.15, lost hold 200 ms, filter time constant 150 ms, maximum speed 120 degrees/s, yaw limit 25 degrees and pitch limit 15 degrees. These are prototype settings, not physiological claims.
- Frame-independent exponential smoothing plus angular velocity cap. Reset on teleport, backward clock or long pause; no stale gaze jump after tab resume.
- Optional pose metadata `gaze={version:1,source:'procedural',yaw,pitch}` carries the cyclopean solved direction; both eyes share direction for now (no convergence claim). Keep target IDs, attention scores and research logs local. Metadata is validated and bounded at both endpoints.
- Store `appearance.gaze` as an optional canonical configuration. Existing revisions, owner scope, CSRF and conflict behavior continue to apply. No extra database collection or high-frequency persistence.
- Room targets are remote heads and artwork roots, with existing voice indicator and pointer interaction signals. Bounded, distance/cone-filtered ray tests prevent selecting occluded targets. No microphone/camera activation.
- Lab recording is a bounded local buffer (1200 records), explicit start/stop, exports configuration changes, monotonic times, selected targets, scores and solved gaze. Import configuration is validated; no silent coercion of malformed experimental inputs.
- Keep AFRAME.THREE as the only room Three runtime. Native model assets stay out of Git/public folders until rights are established. Device testing remains stopped for battery.

## Validation

Focused algorithm tests (cone/head rotation, signal weighting, dwell/hysteresis, target loss, speed and pause reset, deterministic seed and malformed input), pose/profile trust-boundary checks, production build, and one browser smoke of the lab. Follow AGENTS.md: no broad regression/performance suite or hardware checks during this iteration.
