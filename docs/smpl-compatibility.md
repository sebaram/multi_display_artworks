# SMPL / SMPL-X motion compatibility

In a room, open **Visitor → Customize**, choose a humanoid preset, then load a local JSON file or **Load synthetic example**. The editor previews privately. **Apply** saves appearance/shape metadata and starts body playback after the revisioned save succeeds. Cancel, invalid files, and rejected saves do not replace live motion. The room toolbar offers **Pause motion**, **Play motion** (resume), and **Stop motion** (clear the clip and restore normal input/IK). A new import starts a new loop.

Files remain in the current tab's memory. Only solved core22 poses use the existing relay; the 392-byte packet is unchanged. File translation never moves the camera or avatar anchor. Entering immersive XR clears imported playback so tracking takes over. Room disposal, visitor replacement, successful owner switch, incompatible preset selection, and reload clear playback. Loading another owner's saved appearance in the private editor does not publish it; Apply remains the commit boundary.

The included [synthetic example](../frontend/public/avatars/smpl-synthetic-example.json) is self-authored compatible parameter data. It contains an elbow wave and an ignored translation, not captured human motion or a licensed model.

## JSON envelope

```json
{
  "model": "smpl",
  "fps": 30,
  "units": "m",
  "coordinateSystem": "y-up",
  "label": "Optional description",
  "betas": [0, 0.5, -0.25],
  "frames": [
    {"global_orient": [0, 0, 0], "body_pose": ["replace with exactly 69 numbers"], "transl": [0, 0, 0]}
  ]
}
```

The body_pose placeholder above must be replaced with numeric axis-angle values in radians. SMPL uses 69 floats (23 joints); SMPL-X uses 63 floats (21 body joints). The root orientation is separate. The importer reads the documented fields only; unknown fields are rejected. Export arrays from your own trusted tooling; do not upload pickles, code, model files, or URLs.

Limits: 8 MiB UTF-8 JSON, checked before parsing (local File.size also checked before reading); 1–1800 frames; fps 1–120; label at most 120 characters; each axis-angle component within ±4π; translation components within ±10000 m. Vectors must have exact lengths and finite real numbers (booleans/strings rejected). Optional betas have 0–300 finite coefficients within ±10 and the `{model,betas}` serialization must fit 8192 bytes. Appearance writes reject invalid/unknown nested metadata; untrusted read/relay normalization drops invalid metadata.

Source coordinates use SMPL's left +X and forward +Z. `y-up` uses +Y up. A `z-up` export is that source basis rotated +90° about X (+Z up, forward −Y). Axis-angle vectors must be expressed in the declared basis. The importer converts to the current rig's left −X, up +Y, forward −Z. Convert exporters with different conventions before importing.

SMPL-X may include frame fields `left_hand_pose`/`right_hand_pose` (45 floats each, full axis-angle), `jaw_pose`/`leye_pose`/`reye_pose` (3 floats each), and `expression` (1–100 coefficients within ±10). These channels are retained immutably and disclosed as **not rendered**. PCA-compressed hands are rejected with instructions to export full axis-angle poses. SMPL's last two terminal hand joints are also retained but not rendered. Source files are not modified by sampling.

## What this release renders

Body rotations drive the existing common humanoid, with a source hierarchy, coordinate conversion, and global bind correction from SMPL's T-pose to the target's downward-arm bind. Pelvis/spines/neck/head, collars/shoulders/elbows/wrists, hips/knees/ankles/feet map to core22. Shortest-arc quaternion interpolation loops the clip; source root orientation is applied once at the hips under the visitor anchor.

`AvatarAppearanceV2.parametric? = {model: 'smpl'|'smplx', betas: number[]}` is saved through the existing owner-scoped revision/CSRF-checked Mongo appearance API. The editor can remove metadata before Apply. Old profiles omit this field. Betas **do not change the current mesh**, and an imported clip is never restored from a saved profile.

Native SMPL/SMPL-X mesh geometry, learned shape/pose correctives, fingers, and face are unavailable without separately supplied licensed model assets and an appropriate renderer. No model/package was downloaded, no license accepted, and no licensed implementation copied. Joint naming and layout facts were checked against the official [joint_names.py](https://github.com/vchoutas/smplx/blob/main/smplx/joint_names.py) and [body_models.py](https://github.com/vchoutas/smplx/blob/main/smplx/body_models.py).

## Code boundaries

- `parseSmplMotion(text): SmplMotionClip` validates and freezes the source envelope and warnings.
- `sampleSmplMotion(clip, preset, seconds, anchor, sampleTime): AvatarPoseV2` is independent of sockets and browser state.
- `SmplPlayback` owns play/pause/stop timing, owner reset, XR clear, sampling and disposal. One controller belongs to one room owner.
- `SmplImport` stages editor data; `AvatarPreview` samples a separate private pose; the realtime owner uses imported poses in place of IK until stopped. The existing transport assigns the monotonically increasing sequence number across clip loops, pauses and stop/resume transitions.

Development verification is deliberately focused: parser/retarget/lifecycle/editor and schema regressions, TypeScript/production build, and a short two-page desktop browser smoke. No device, exhaustive regression, or performance matrix was run. The earlier avatar evaluation remains a historical measured-build artifact.
