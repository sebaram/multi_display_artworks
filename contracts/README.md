# Historical contracts

`legacy-bson.json`, `legacy-routes.json` and the legacy portion of `socket-events.json` were captured from commit `974bbfd74ecd9a1330a03d7dd2a19994209ec8f5` using synthetic data. The original Flask runtime is no longer shipped. Current tests load the BSON directly through the migrated models; extractor regressions use the three exact historical function fixtures in `backend/tests/fixtures/legacy-contract-functions.json`.

To reproduce historical capture, extract that commit's `flask_server/` with `git archive` to a separate scratch directory, install its requirements in a separate environment, and set `LEGACY_ROOT` to the extracted `flask_server` directory. Historical capture scripts explicitly require that path. Use only the guarded migration MongoDB on127.0.0.1:27028; these capture scripts reset its fixture data.

The old runtime remains in Git history rather than the new image or Python dependency graph. Never run the historical seed or capture against an existing deployment.
