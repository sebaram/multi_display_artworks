# SMPL / SMPL-X compatibility

The user approved proceeding with the recommended integration order and confirmed that no SMPL model files are available. This implementation delivers working motion compatibility and saved shape parameters on the existing avatars. Native SMPL meshes, learned shape/pose corrective deformation, and SMPL-X finger/face rendering require licensed model assets and remain explicitly unavailable. No licensed package/model download or license acceptance is authorized by this task.

Keep the existing React, A-Frame Three r184, MongoDB profiles and Socket.IO core22 pose contract. No additional Three, Python ML runtime, new transport, mesh streaming or per-frame database writes. No device tests: the user stopped Quest work for battery reasons. Follow AGENTS.md: focused tests and one short two-browser smoke, not a full regression/performance/review cycle. Keep codex/avatar-customization; no push/merge/deploy.

## Usable behavior

- A visitor can load a local SMPL or SMPL-X motion JSON, see a private preview, apply it to their humanoid, and play/pause/stop. Other visitors see the resulting core22 poses through the current relay. Stop restores normal input/IK. Cancel/invalid import leaves the current profile and live motion untouched.
- Provide one small self-authored synthetic example so the feature works without downloaded models. Label it as compatible parameter data, not a licensed SMPL mesh or captured human movement.
- Root translation from a file never moves the user's camera. This release plays body poses anchored to the visitor; clearly label that file trajectories are not applied. Immersive XR entry stops imported playback and uses actual tracking. Room leave/disposal, visitor/owner switch and incompatible preset selection clear playback. Reload does not restart an imported clip.
- Shape betas are saved alongside the appearance as optional `parametric` metadata. The UI states that the current mesh does not visually apply those values. No fake body-shape sliders or claim of native SMPL-X hands/face support. Unsupported channels in the source must be disclosed.

## Import and retargeting

Use a documented JSON envelope with model (`smpl`/`smplx`), fps, units (`m`), coordinateSystem (`y-up`/`z-up`), optional betas and frames. Each frame has axis-angle global_orient and body_pose (69 SMPL,63 SMPL-X floats). SMPL-X may carry full45-float left/right hand pose, jaw/eyes and expression values; PCA-compressed hand inputs are unsupported and rejected with an actionable error. They are not silently advertised as rendered. Do not upload the file or accept pickles/code/remote URLs.

Check file size before JSON.parse (8 MiB), at most1800 frames, fps1–120, exact vector lengths, finite real numbers (not booleans), bounded metadata and supported coordinate/unit declarations. Bound source angles/translations and beta count; support up to300 finite beta values with a safe documented magnitude/serialized-size limit. Preserve source data needed for compatibility warnings. Never mutate an imported source while sampling it.

Use proper axis-angle conversion, coordinate-basis conversion, source hierarchy and target bind-pose retargeting. SMPL neutral arms are T-pose while the current target binds arms downward: copying local quaternion indices is insufficient. Test neutral T-pose, a bent elbow under a rotated parent, root rotation once, q/-q interpolation, finite zero rotations, SMPL vs SMPL-X body layouts and z-up conversion. The source joint facts are documented at https://github.com/vchoutas/smplx/blob/main/smplx/joint_names.py and body_models.py; do not copy licensed implementation code.

Map pelvis/spine1/spine2/spine3/neck/head, collars/shoulders/elbows/wrists, hips/knees/ankles/feet to the current core22 names. Metadata and source channels have a clear boundary so a future licensed native renderer can consume them without coupling the parser to Socket.IO. This release does not widen the392-byte live pose packet or incoming binary limits.

## Persistence and safety

`AvatarAppearanceV2.parametric? = {model: 'smpl'|'smplx', betas: number[]}` is optional and omitted for old profiles. Frontend and server normalizers preserve and validate it consistently. Unknown nested fields, invalid model, nonfinite/bool coefficients, oversized arrays/serialized metadata are rejected at the write boundary. Existing account/anonymous owner isolation, revision conflict, CSRF, catalog allowlist and legacy rendering remain intact. Stored parameters do not imply that native geometry is loaded. Motion frames stay in the current tab only.

## Completion evidence

Focused parser/retarget/playback lifecycle tests and affected appearance/profile schema tests; typecheck/build once for the changed bundle. One actual two-page browser check: load example, preview/cancel privacy, apply/save/reload parameters, observer receives changing joints, pause and stop restore input. No full suites or device/performance matrix. Add a concise usage document and short HTML feature note with screenshots and exact native-model limitations. Preserve the prior evaluation as a historical measured-build artifact; do not relabel it as new-build performance.
