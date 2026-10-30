# Development validation

- During development, use short, focused checks for the behavior being changed. Prefer a brief browser or real-device smoke check for the affected user flow.
- Reserve exhaustive performance matrices, full regression suites, and whole-branch reviews for release/deployment readiness or an explicit user request. Do not repeat broad verification on each iteration.
- For a reproduced failure or a high-risk change, run the focused regression needed to establish the fix; broaden only when the evidence calls for it.
- Report observed failures and untested scope plainly. Keep emulation/mock XR results separate from actual device checks.

This follows the user's validation preference stated on 2026-10-30.
