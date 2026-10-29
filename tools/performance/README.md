# Local performance evaluation

The report is [performance-evaluation.html](../../docs/reports/performance-evaluation.html). All graphs, data and screenshots are embedded. [performance-results.json](../../docs/reports/performance-results.json) retains trial frame intervals, CPU counter bases, measurement-window system snapshots, and grouped values. These tools do not alter product code or production data.

## What is measured

The real FastAPI-served production bundle and actual gallery renderer are used. Fixtures include 10/30/100 m virtual rooms, shared images up to 3,000 elements, distinct 1024px textures, 10,224-triangle GLTF instances, 100,000-point splats, webpage placeholders, live designs, 1080p/4K videos and mixed content. Every image/model/splat/video and bound design must be ready before warmup. A full yaw warms initially offscreen texture uploads. Default tests warm for 5 seconds and measure for 10 seconds, twice in opposite case orders.

Desktop uses 1440×900/DPR1; QHD uses the same PC at 2560×1440/DPR1. `mobile` means that PC at 390×844/DPR2 with a 4× **main thread** slowdown. The GPU, splat worker CPU, bandwidth, video decoder and thermal behavior remain those of the PC. It is not a phone or Quest test. Splats change the actual renderer DPR to1; the actual drawing buffer is recorded. No physical phone or Quest3 was available.

Render FPS counts actual main `renderer.render` calls; p95/p99 and 1% lows use the adjacent Window RAF intervals. They are not immersive XR frame times. CPU1core=100%; multi-process Chrome may exceed100%. `ThreadTime` is actual main-thread CPU while `TaskDuration` includes occupied wall time and throttling pauses. CPU endpoints use their enclosing CDP timestamp interval.

Windows sums owned Chrome process working sets (shared-page double counting is possible); private commit is a separate measure and is not resident RAM. VRAM is an OS GPU-process dedicated-usage snapshot after each trial, not a pure texture budget or an in-window peak. NVIDIA utilization, memory, power, temperature and decoder load cover the entire adapter. The optional disjoint GPU timer covers the main scene's renderer call, not the independent source-wall renderers/Canvas2D or all decoder/presentation work. Submission/scheduling gaps can affect elapsed queries. Earlier optional timer records are conservatively excluded; actual OS GPU counters remain valid. Validated timer policy is `discard_all_pending_v2`; any disjoint flag excludes that trial's GPU timing.

Screenshot capture occurs after timing. Process VRAM snapshots follow it, so compositor/capture caching can remain. The host display pacing varies; the approximately57FPS empty-room observation is not a fixed57Hz hardware claim. Normal trial FPS/CPU/load/VRAM are medians of valid repeats; p95/p99, main GPU p95 and RAM peaks use the worse repeat. Repeat values are retained rather than pooled into a false confidence interval.

## Reproduce on this Windows workstation

Run sequentially; multiple browsers, video encoders, provider tests or other load generators would contaminate the measurements. Use the existing guarded Mongo instance on127.0.0.1:27028. `generate_workloads.py` checks its external marker and restricts writes to the named synthetic DB. It never drops a database. Full `--seed` replaces owned fixture records, so prepare design panels afterward. `--append-mixed --seed` inserts only new mixed fixtures and preserves existing records.

```powershell
.venv_legacy/Scripts/python.exe tools/performance/generate_workloads.py --seed
.venv_legacy/Scripts/python.exe tools/performance/generate_workloads.py --append-mixed --seed
```

Start the app with its own local settings in one terminal:

```powershell
$env:SECRET_KEY='performance-local-session-secret'
$env:SECURITY_PASSWORD_SALT='performance-local-password-salt'
$env:MONGODB_URI='mongodb://127.0.0.1:27028/metamuseum_perf_20261029?directConnection=true'
$env:MONGODB_DB='metamuseum_perf_20261029'
$env:ENVIRONMENT='test'
$env:SESSION_COOKIE='metamuseum_performance_session'
$env:ALLOWED_ORIGINS='["http://127.0.0.1:8101","http://localhost:8101"]'
$env:FRONTEND_ROOT=(Resolve-Path frontend/dist).Path
$env:MEDIA_ROOT=(Resolve-Path backend/metamuseum/static).Path
$env:WALL_MEDIA_ROOT="$PWD/output/playwright/performance/wall_media"
$env:STREAM_ROOT="$PWD/output/playwright/performance/streams"
.venv/Scripts/python.exe -m uvicorn metamuseum.asgi:app --app-dir backend --host 127.0.0.1 --port 8101 --log-level warning --no-access-log
```

These are synthetic local secrets. Start `serve_fixtures.py` in a second terminal. The generator requires the project's FFmpeg binary or an available FFmpeg for the controlled H264 fixtures.

```powershell
.venv/Scripts/python.exe tools/performance/serve_fixtures.py
# Separate terminal after fixtures/app are ready:
npx --yes --package @playwright/cli playwright-cli -s=perf open about:blank --browser=chrome --headed
node tools/performance/prepare_bindings.mjs
node tools/performance/run_benchmarks.mjs desktop
node tools/performance/run_benchmarks.mjs mobile
node tools/performance/run_benchmarks.mjs qhd
node tools/performance/run_benchmarks.mjs soak
node tools/performance/run_extras.mjs
node tools/performance/instrumentation_check.mjs
```

The runner uses cached playwright-cli through `npx --offline`; the first `open` prepares that cache. It resumes completed IDs. Set `PERF_FORCE=1` only when intentionally replacing a completed measurement. Raw data and screenshots go under the ignored `output/playwright/performance/`, never into production collections.

The separate `monitor_windows.py --targets .../monitor-targets.json --output .../system-samples.jsonl` process uses NVIDIA1Hz counters and read-only Windows process APIs. Its target JSON must contain the benchmark Chrome `browser_root_pid` from CDP SystemInfo plus `server_pids` and the current case name; descendants are discovered dynamically. Store hardware snapshots in `host-hardware.json` and `browser-hardware.json` before generating the report. Run API/lifecycle extras only after rendering measurements are finished.

```powershell
.venv/Scripts/python.exe tools/performance/build_report.py
python -m http.server 8099 --bind 127.0.0.1 --directory docs/reports
```

The report preview is `http://127.0.0.1:8099/performance-evaluation.html`. All generators, monitors and servers are local helpers.

## Actual phone / Quest follow-up

No performance values are fabricated for missing hardware. With a developer-authorized USB device, `adb reverse tcp:8101 tcp:8101` and `adb reverse tcp:8767 tcp:8767` make the local app/assets available to its browser. Open the manifest's room URL using `http://localhost:8101`; localhost also provides the secure-context exception required for WebXR. Inspect that actual device page remotely. iOS requires its own Safari/device tooling.

Paste `device_probe.js` into the inspected actual page. For Quest, enter immersive VR first; the collector uses `XRSession.requestAnimationFrame` rather than Window RAF. It keeps the actual refresh-rate/drawing-buffer data and exports JSON, leaving unsupported total-RAM/CPU/GPU fields null. Capture browser process memory/CPU with ADB and Quest OVR Metrics alongside it; browser JS alone cannot supply equivalent device OS counters. Check live-wall animation during immersive VR because its product update loop currently uses Window RAF. Verify splat quality with its default XR framebuffer scale0.5.

This report does not certify device thermals, battery life, immersive stereo cadence, mobile Safari/Android hardware, WAN/TURN, many simultaneous visitors, authoring-studio editing, active voice/camera or paid AI providers. The primary workload is a visitor entering and looking around real exhibition rooms.
