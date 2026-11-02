# Local LAM avatar generation

[Focused validation and measured run](validation/2026-11-02-lam.md).

LAM is an optional offline photo-to-head experiment. It does not replace room
avatars, IK, Socket.IO, or the existing GaussianAvatars lab. The web server never
runs inference and does not accept model checkpoints or photo uploads.

## Setup on this Windows PC

The measured environment is Ubuntu 24.04 under WSL2, RTX PRO 5000 Blackwell 48 GB,
driver 582.16, Python 3.10, PyTorch 2.7.1 / CUDA 12.8 and GCC 13. The CUDA extensions
are compiled for compute capability 12.0. Other GPUs require adapting that setting;
they have not been validated. The native WSL environment lives under
`~/.local/share/metamuseum-lam`; ignored source, assets and results live in
`FLAME/lam`. Linux packages must remain on WSL ext4 because case-distinct headers
collide on the Windows filesystem. No system CUDA, apt or backend dependencies
are changed.

From the repository directory in PowerShell, with the existing app `.venv` ready:

```powershell
wsl -d Ubuntu-24.04 -- bash tools/avatars/lam/setup.sh
wsl -d Ubuntu-24.04 -- bash tools/avatars/lam/run.sh python tools/avatars/lam/generate.py --image FLAME/lam/upstream/assets/sample_input/barbara.jpg --output FLAME/lam/runs/my-example
```

Replace `--image` with a local, consenting subject's photo after the official
example works. A new output directory avoids overwriting a completed package.
`--reuse-fit` resumes a completed fit only when the input hash and pinned source
revision match. Jobs are serialized because the upstream exporter uses shared
resources. Photos are processed locally; there is no hosted inference call.

The CLI records fit, model load/inference and total wall times, peak **allocated
PyTorch** VRAM, GPU/runtime versions, source revision and package SHA256. This is
not total system RAM/VRAM or browser FPS. Model loading and first-use compilation
affect timing. Setup/download/build time is separate.

## Preview

Set `LAM_AVATAR_ROOT` to the **absolute** path of the generated `preview` directory,
build the frontend, and restart the local backend with its normal settings.
Open `/tools/lam-avatar`. This separate page reuses the gaze lab's target selection,
filters and recording. Horizontal/vertical full-weight angles calibrate ARKit eye
weights; jaw opening is a manual diagnostic. The recorded display state includes
the package hash and applied controls. It is procedural gaze, not measured gaze.

Only `avatar.zip` and `manifest.json` are served. Input photos, fitting intermediates,
FBX files and source model pickles are outside the route allowlist. The renderer
loads in a separate iframe so its singleton, worker and WebGL state are reclaimed
when the preview closes. Its large dependency is not imported by room scenes.

By default, access requires a development server, loopback client and allowed local
hostname. Remote access uses the existing `GAUSSIAN_AVATAR_REMOTE_ENABLED`,
`GAUSSIAN_AVATAR_HOSTS` and `GAUSSIAN_AVATAR_ACCESS_PIN` settings. Both configured
labs share one short-lived server session, rate limit and lock operation. Keep
secrets outside Git. Remote assets are disabled unless explicitly configured.

## Sources and compatibility adjustments

- LAM source: `339573649dd93df4cba8093a964e85a80d1b61f3`.
- Model and asset revisions, byte counts and SHA256 values: `fetch_assets.py`.
- PyTorch3D, diff-gaussian-rasterization and nvdiffrast revisions: `setup.sh`.
- Browser SDK: `gaussian-splat-renderer-for-lam` **0.0.9-alpha.1**.
- Pinned detector checkpoints use the old trusted-checkpoint loader only inside
  the offline process. Arbitrary user checkpoint paths are not accepted.
- The original FLAME Chumpy/SciPy containers are materialized through the existing
  restricted numeric loader, preserving the original pickle. This is **not** a
  conversion to FLAME 2023 Open.
- FaceBoxes' removed `np.int` alias is restored only in the offline process.
- The full checkpoint must supply every learned weight, including DINO. The only
  allowed missing key is the deterministic subdivided joint-regressor buffer.
- diffusers 0.30.3's stock joint-attention processor ignores the checkpoint's Q/K
  norms and produces a corrupted face. The generator selects LAM's own
  `QKNormJointAttnProcessor2_0`; `check_attention.py` reproduces the 0/0 vs 1/1 norm
  calls on a small CPU input. This is a required compatibility adjustment.
- Compilation is disabled for inference; CUDA extensions remain compiled. The
  standalone image helper avoids importing unused mesh/video inference packages.
- Blender 4.4's `export_vertex_color` replaces the removed `export_colors` option.
  Script failures and missing output files are checked explicitly.
- The SDK's missing CommonJS entry is bypassed through its published ES module.
  Readiness requires complete splat loading, not just the SDK promise resolving;
  initialization, asynchronous errors and a bounded load timeout reach the UI.

## Licensing

[LAM source](https://github.com/aigc3d/LAM) is Apache-2.0, but its
[weight license](https://github.com/aigc3d/LAM/blob/master/LICENSE_WEIGHT) is
CC-BY-NC-4.0. FLAME, tracking dependencies, export templates and subject imagery
have separate terms. This local research pipeline does not establish public or
commercial redistribution rights. A PIN changes access, not licensing. Generated
packages and model files are excluded from Git and deployment images.
