# Desktop controls and Gaussian preview — 2026-11-02

Production inventory [41396847951](https://github.com/sebaram/multi_display_artworks/actions/runs/41396847951) succeeded. The application is running version 2.0.0 from `2778ee4f5eaf5cc516f3dd54a78fc81f8bf97406`, image `sha256:99beed6d37df09cadc8fa2f75a70d6302445dc2edcfa7b1cc120991b5d288298`. No release stacks remain. Master was `6634c56268174d7551e46099c6636afa87fc92ee`; its latest push CI passed, but it was not deployed. This investigation did not change production.

## Reproduced failures and fixes

- On the public room, clicking Expression leaves button focus. A-Frame's WASD handler accepts only body focus, so W is ignored and the camera remains at `[0, 1.6, 5]`. The room now restores movement on unmodified WASD from buttons, links and map canvases. Inputs, selects, editable content and open dialogs retain focus; disposal removes the listener.
- Public `/tools/gaussian-avatar` requests a deliberately disabled asset status endpoint, receives 404 and displays both a missing-package error and an indefinite loading message. Status now returns a normal unavailable/locked/ready result. The preview stops loading, disables unavailable model controls and retains the procedural gaze experiment.
- With the actual local model enabled, Vite adds `?import` to a dynamic public-module URL and returns 500. Both native-avatar entry points now import the absolute same-origin vendor URL, preserving the public module without Vite transformation.
- Optional temporary preview access is enforced by the server for manifest, rig and PLY, including HEAD. Unlock requires CSRF, has per-client/global attempt limits and grants a 30-minute signed session. Password rotation, expiry and Lock preview block subsequent access. Remote delivery remains off by default; no model or password is committed.

## Focused verification

- Backend: `pytest backend/tests/test_gaussian_dev.py` — 8 passed, including default denial, file allowlist, host restrictions, wrong credentials, CSRF, expiry, rotation, logout and limits across fresh sessions. These tests use an isolated ASGI app and temporary files, without MongoDB.
- Frontend: scene mount, native preview status and Gaussian adapter tests — 17 passed. Production TypeScript/Vite build passed.
- Real desktop browser, local renderer harness: W after a toolbar click moved Z from 5 to approximately -2.19; typing W in an open dialog populated the input without movement keys; D after dialog closure restored movement. This harness uses the actual mountRoom/A-Frame code but not live room persistence or Socket.IO.
- Real desktop browser, actual local sample: temporary-password unlock loaded 89,021 Gaussians and 5,143 FLAME vertices with pose updates; Lock preview removed the canvas and returned to password-required status. Zero console errors after the import fix. The existing multiple-Three.js warning remains non-fatal. No devices were woken.

## Remaining scope

No production deployment, full regression/performance matrix, mobile or physical Quest verification was performed. The public site continues to run the earlier deployed image until these changes are integrated and released. The local package uses original FLAME 2023; authentication does not grant permission to distribute it. The user's choice of authorized external assets is pending. Rendering in a recipient's browser transfers model data; locking cannot recall it.
