# Local LAM generation and browser preview

**Goal:** Generate a real LAM avatar on this PC and load it in a local browser with the existing procedural gaze output. The user approved LAM first, MeshLAM as a future alternative, and LHM++ for later full-body work.

**Architecture:** Keep generation outside the FastAPI runtime in an ignored, pinned upstream checkout and isolated WSL environment under `FLAME/lam`. Generate from an official example first, without uploading photos to third-party services. Store generated files privately and expose only the explicitly configured preview package through authenticated/local development routes. Retain the existing room avatars, IK and Socket.IO transport.

**Scope:** Local generation and a separate lab preview, not production deployment, full room/WebXR replacement, model training or full regression. Use this PC's RTX PRO 5000 Blackwell 48 GB; do not wake mobile/Quest devices. The current branch is `codex/lam-avatar-generation`, based on `0625ece`. Upstream code and weights retain their separate license conditions. The original subject-306 and Open packages remain intact.

## Tasks

- [x] Pin LAM and inspect generation/export entry points. Build an isolated Python/CUDA environment compatible with Blackwell; verify one small CUDA operation and required extension imports. Record versions and deviations from upstream's older pins.
- [x] Download pinned weights/assets into ignored storage. Use existing user FLAME files as needed for local research, without treating LAM as proof of Open-model compatibility. Generate one official example and export a real browser package. Record time, peak VRAM and any missing dependencies or failures.
- [x] Add the smallest reproducible CLI/config needed to repeat generation without the upstream Gradio/hosted service. Keep photos/model data/passwords out of Git and out of the main backend dependency lock.
- [x] Connect the generated package to a separate local lab preview. Reuse the attention controller, map its yaw/pitch to supported eye controls with explicit ranges, and preserve the existing GaussianAvatars lab. Add focused tests for the adapter/lifecycle and any new asset boundary.
- [x] Run one brief actual browser smoke: load, gaze, teardown, and console errors. Compile the frontend and document observed results. Do one focused fresh review of the change, then commit the implementation. No whole-branch audit or performance matrix.

## Current evidence

- Windows: RTX PRO 5000 Blackwell, driver 582.16, 48 GB VRAM; Ryzen 5950X; 128 GB RAM; approximately 260 GB free on C:.
- Existing Ubuntu-24.04 WSL2 sees the GPU and has Python 3.12, git and curl; compiler/CUDA toolkit/uv are absent from PATH. Docker daemon is stopped. The runtime is isolated under `/root/.local/share/metamuseum-lam` in WSL, without changing system CUDA or the application environment. Ruling: Linux headers have case-distinct filenames that collide on the Windows mount, so runtime/cache files must use WSL ext4. Source/assets/results remain in ignored `FLAME/lam`.
- MeshLAM's official code link still points to LAM; Avat3r code is marked coming soon. Neither replaces the selected executable baseline at this stage.

## Completion evidence

See [focused validation](../../validation/2026-11-02-lam.md) for the fresh 78.293 s photo run, measured VRAM, browser smoke, focused checks, restart recovery and remaining limits. One focused fresh review completed; its SDK-readiness finding was fixed with failing-then-passing regression tests. Implementation and focused validation are complete. Commit on the task branch; no merge, push or deployment is part of this step.
