# Local performance evaluation

## Avatar feature and performance evaluation

`avatar-evaluation.html` and `avatar-evaluation-results.json` are separate artifacts; the original migration, performance and render-optimization reports are unchanged. Frontend source is frozen at `341f60086fd7e284c084db936c1aaa14834b951f`; the final backend relay is `888ed7857f9003e00f0d2988c31abfb87af22c77`. Both revisions are recorded independently in every raw trial. Report-only commits may be newer. The runner refuses dirty frontend/backend product paths and records bundle, common GLB, harness and collector SHA256.

Use only the existing synthetic `metamuseum_perf_20261029` database and its retained workload manifest/assets. Start the same API settings described below on **8013**, changing ALLOWED_ORIGINS accordingly, plus `serve_fixtures.py` on8767. Do not run backend tests, builds, encoders or unrelated owned browsers during measurement. The API8000 guarded test database is only for functional media/regressions; never reset it while browser work is active.

```powershell
npx.cmd --offline --yes --package @playwright/cli playwright-cli -s=avatar-eval open about:blank --browser=chrome --headed
# Separate terminal, read-only monitor of the runner's owned browser/API targets:
.venv_legacy/Scripts/python.exe tools/performance/monitor_windows.py --targets output/playwright/avatar-evaluation/monitor-targets.json --output output/playwright/avatar-evaluation/system-samples.jsonl
$env:AVATAR_SERVER_PID='<actual uvicorn child PID on8013>'
node tools/performance/avatar-workloads.mjs selfcheck
node tools/performance/avatar-cleanup-check.mjs #65s N50+observer, actual close/empty/idle, then N1
node tools/performance/avatar-workloads.mjs active # ONE separately labelled 22-joint/head-active near10 diagnostic
node tools/performance/avatar-workloads.mjs render
node tools/performance/avatar-transport-evidence.mjs # between phases only
# Finish/close the unused browser before the relay-only experiment:
npx.cmd --offline --yes --package @playwright/cli playwright-cli -s=avatar-eval close
node tools/performance/avatar-workloads.mjs fanout
.venv_legacy/Scripts/python.exe tools/performance/build_avatar_report.py
```

The render runner covers74 cases twice, in opposite orders: N1/5/10/20/50 ×10/30/100m ×shared GLB/different colors or mixed catalog models ×desktop/390px4x PC stress, plus image/splat/mixed co-load at10/50 and same-build hidden/legacy-robot controls. N means remote synthetic Socket.IO producers; the observer adds one actual participant and one locally solved hidden owner. Mixed catalog models cycle humanoid, primitive robot, Shiba and RiggedSimple; legacy producers use v1 positions, humanoids send complete392-byte22-bone snapshots. Hidden controls configure N participants but draw no remote body. These are actual networked synthetic clients, not physical headsets, and render results include network decoding/relay costs.

The owner is initialized through the actual Visitor→Customize→Apply flow, creating only an anonymous profile in the dedicated synthetic database. Each trial verifies the real roster, loaded model/skin, expected artwork roots, and all resident artwork readiness before measurement; fallback/missing media makes a trial invalid. Camera is at0.45L; remote depth is0.35–0.45L and horizontal placement fits the portrait frustum. Two-second full-yaw warmup, one-second frontal settle, six-second static observation. The primary fixture rotates four limb joints while head/root remain static; owner animation/IK is desktop idle after the yaw warmup, with no tracked arms. The separate `active` diagnostic rotates all22 joints including the head at near10 and is not one of the148 selected matrix trials. Existing quality control is fixed at level0; device and distance/visibility policies remain enabled. Actual distances/full/low/hidden counts are retained; room size and distance LOD are deliberately coupled, not claimed as independent effects.

FPS counts only main scene render calls; frame p95 uses adjacent main render times. `scene.avatarPerformance.ownerMs` wraps local animation+IK; `poseMs` wraps only remote joint interpolation+application; `remoteMs` includes root interpolation/visibility/detail/expression overhead. All are synchronous **elapsed wall time**, not exact CPU cycles; CDP4x can include artificial delays. `poseActiveP95` uses frames that applied at least one remote pose, while `poseP95` includes skipped frames. OS Chrome process CPU1core and CDP ThreadTime are separate. The initial10-near-remote≤2ms target uses the synchronous elapsed proxy. Owner IK call independence is tested functionally, not inferred from equal timing under increasing load.

Memory scopes match the existing monitor: Chrome process-tree working sets may double-count shared pages; private commit is not resident RAM. Windows GPU-process dedicated usage is a snapshot **after** timing and screenshot capture, not an avatar-only allocation, an in-window peak, or an exact GPU execution timer. Node generator CPU/RSS/heap/external memory and server process CPU are retained. Host VSync/display pacing can cap FPS.390px4x is the same PC/GPU, not phone/Quest hardware. Physical devices remain NOT_RUN.

Relay-only cases use N1/5/10/20/50 actual Socket.IO sockets in one Node process, two-second warmup/eight-second window, opposite order repeats. Packet bytes count Engine.IO message data including Socket.IO envelopes/binary payload, excluding WebSocket/TCP/IP frame headers/TLS. Latency uses same-host wall clocks from producer sample to receiver callback; it excludes the visual100ms buffer. Every received latency is retained. Expected deliveries use actual Engine.IO packetCreate avatar headers×(N−1). Cohort delivery counts only poses emitted within that same window and received before its end; queued arrivals after the window are not packet loss. Attempted volatile emits are retained separately. Report generator CPU and receiver delivery ratio alongside server CPU; a single generator event loop can saturate before the server. The all-to-all `N(N−1)20×392` formula is uncompressed numeric-payload volume; compression can reduce actual wire bytes.

The installed Socket.IO parser defaults to10binary attachments per message, which rejected populated room snapshots above10humanoids. The production connection and synthetic clients use the same explicitly bounded64attachment Decoder with the existing4.2.7parser. This is **not** a universal64-person room capacity claim. More than64binary attachments in one incoming snapshot still fails closed; larger populated rooms need a future packed/chunked snapshot protocol. Source244a1ce first3render trials and the N20readiness failure are preserved under `superseded-244a1ce` and excluded from final performance conclusions. Visible teleport/new-generation transitions force exactly one coherent joint/hips update; cached teleport=true does not bypass throttling every frame. Hidden skeletons remain stopped and restore latest state on reappearance.

Observer traffic comes from CDP WebSocket frame payloads (binary base64 decoded for byte counts), while generator traffic comes from Engine.IO message data, one layer inside the transport. Both exclude WebSocket/TCP/IP headers, but the observer scope also includes Engine.IO packet-type bytes. Generator CPU/RSS refer to the single Node producer process; CLI subprocess CPU is not included. For render trials the Node CPU window encloses browser invocation, loading/warmup/capture, not only the six-second observation; start/end are explicit. Fanout uses its exact timed window. If Chrome's process set changes within a trial, aggregate Chrome CPU is unavailable rather than summing only surviving processes; frame and main-thread counters remain separately recorded.

The final relay bounds v2 live work: one owned writer per recipient, latest pending pose per active(room,user), and queue-drain backpressure before atomic binary batches. Shared immutable encoding is reused; same-generation teleport remains sticky for each slow recipient until delivered. Ordinary controls/ACKs and legacy v1 positions retain their reliable path. Source leave/profile/generation and target disconnect/shutdown purge pending work. These are bounded-work/lifecycle guarantees, not a promise to deliver every20Hz source pose to50 peers.

Earlier relay trials and40–45s transport/drain failures remain diagnostic evidence under `superseded-341f600-relay` and cleanup JSON files. A read-only in-memory probe independently reproduced pending-disconnect lock cycles and unbounded per-packet writer waiters; it did not establish that every observed live-load symptom had the same cause. The final source must pass the65-second coupled N50 soak, actual WebSocket closure, empty public roster, idle server and N1 follow-up before the primary matrix. Each case tears down the observer, stops producer timers, waits5s for graceful socket closure, records any bounded forced termination, and checks empty public roster plus server CPU below5% of one core over6s. Forced cleanup is explicitly recorded, never treated as proof of ordinary graceful shutdown.

Raw append-only trials/logs/media live in `output/playwright/avatar-evaluation/`. Completed successful render case IDs resume only for the same frontend, relay, model, bundle, harness and collector hashes. Dry/failing setup runs are not numeric baseline data; keep them for provenance. The builder requires exactly two selected successful repeats per condition and does not select by FPS. `avatar-report-template.html` is readable source; it embeds all report media/data. `avatar-decisions.json` archives the plan's implementation decisions. Feature capture helpers `avatar-capture-features.js` and `avatar-capture-xr.js` run through CLI `run-code --filename` before the numeric phase; simulated XR is explicitly labeled. Original before evidence hashes are checked before packaging. Video uses the already installed imageio_ffmpeg binary, without downloads. After generation serve reports on8099 and run `check-avatar-report.js` through the owned CLI session to check desktop/390px, filters, image decode/zoom, video playback, JSON download and no external requests.


## Optimization follow-up

`run_optimization.mjs` compares the preserved `52ee0b4` product build on8101 and frozen optimized production bundle on8102, using the same retained synthetic DB/fixture server. It writes separate `output/playwright/render-optimization/` results and never overwrites the original report. Start `monitor_windows.py` with that directory's `monitor-targets.json` and `system-samples.jsonl` before timing.

```powershell
node tools/performance/run_optimization.mjs dry
node tools/performance/run_optimization.mjs desktop
node tools/performance/run_optimization.mjs stationary
node tools/performance/run_optimization.mjs mobile
node tools/performance/run_optimization.mjs adaptive
# Stop the owned monitor after all modes finish so its evidence hash is stable.
python tools/performance/assemble_optimization_results.py
python tools/performance/build_optimization_report.py
```

The follow-up uses 1440×900 or390×844 at DPR1, 8-second full-yaw warmup and10-second observation windows. Stationary trials also settle5seconds after warmup. FPS counts only the main scene's render calls, excluding Spark's internal passes. Fixed mode disables quality adaptation at level0; image/splat LOD and residency stay enabled. CPU-limited mobile runs remain a PC stress test. GPU dedicated usage follows screenshot capture; RAM samples cover the observation and trace-return window. Do not run other browsers/load generators or rebuild the served bundle during timing. Full original `.splat` data and glTF loads can still transiently consume memory during initial bounds/LOD generation.

The packager audits the 46 selected repeats and preserves superseded development-iteration IDs separately. All 24 optimized trials use the final product revision, including the ambient-light compatibility correction; the 22 original baseline trials remain unchanged. The runner records the latest commit touching product paths, so documentation-only commits do not change the measured revision. Product working files must be clean. `node --test tools/performance/device_probe.test.mjs` checks that the actual-device collector uses the right loop and excludes Spark's internal passes from FPS; it is a synthetic collector test, not an actual headset measurement. `run_gallery_pick_checks.mjs` exercises real pointer clicks through Chrome and saves its four artwork-type results.

After assembly, serve `docs/reports` on port 8099 and run `node tools/performance/run_optimization_report_check.mjs` through the existing `perfopt` Chrome session. It checks embedded screenshot decoding, filters/detail/zoom, 390px layout and the actual JSON download, then records the report/data hashes in `render-optimization-validation.json`.

Current product details are in [rendering-performance.md](../../docs/rendering-performance.md); the original sections below describe the preserved baseline evaluation.

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

Paste `device_probe.js` into the inspected actual page. For Quest, enter immersive VR first; the collector uses `XRSession.requestAnimationFrame` rather than Window RAF. It keeps the actual refresh-rate/drawing-buffer data and exports JSON, leaving unsupported total-RAM/CPU/GPU fields null. Capture browser process memory/CPU with ADB and Quest OVR Metrics alongside it; browser JS alone cannot supply equivalent device OS counters. Verify stereo live-wall visibility, image/splat detail and actual framebuffer dimensions. The preserved baseline used a window-RAF wall loop and a splat-specific XR scale0.5; current rendering uses A-Frame's XR loop and centralized quality policy.

This report does not certify device thermals, battery life, immersive stereo cadence, mobile Safari/Android hardware, WAN/TURN, many simultaneous visitors, authoring-studio editing, active voice/camera or paid AI providers. The primary workload is a visitor entering and looking around real exhibition rooms.

In rendering raw rows, `botNetworkWindow.sent` is the count of **attempted** volatile emits; it does not prove each emit reached the transport. Never derive delivery loss from that field. Observer `poseHeaderLatencies` are same-host producer sampleTime to CDP callback ages; `poseServerArrivalAges` separately records authoritative serverTime to CDP callback. Both include scheduling and are not pure wire latency; neither includes the100ms render interpolation buffer. A short trial can retain50 rendered rigs yet display stale network poses. Report arrival age/rate with FPS. Application byte counters are after WebSocket decompression and exclude transport framing; the392-byte all-to-all formula is uncompressed numeric-payload volume, not a universal wire-bandwidth floor when compression is active.

Final rendering selection starts after the focused N50→N1 cleanup diagnostic. All11 earlier provisional successes and the failed intermediate-home request are archived together in `provisional-before-cleanup/` and excluded, without selecting by FPS. Every final case exits the observer to about:blank, stops producers, awaits each underlying WebSocket close event/CLOSED state, records `transport-cleanup.jsonl`, and verifies public empty roster plus6s server idle. The next first producer must receive an empty public room snapshot. The focused check also sampled6s idle: server CPU returned near idle and N1 had no prior roster, without restarting the server. This proves the checked cleanup behavior, not the cause of the earlier Chrome ERR_NO_BUFFER_SPACE.

`soak` runs65s with50 actual sockets, preserving one-second connected/sent/received/arrival-age history, disconnect reasons/WebSocket close codes, event-loop utilization/lag, server CPU and generator memory. `fanout` uses actual packetCreate header counts, and `receivedCohort` counts arrivals from the measured send cohort before the same window ends. A low cohort completion fraction can mean queueing, throttled/dropped emits or disconnects; it is not a pure network packet-loss rate. Transport header creation is not a TCP acknowledgment. All byte values are application payload, not on-wire compressed throughput.

Under N50 all-to-all load, Engine.IO could report closed while the underlying WebSocket remained CLOSING after5s. The owned load generator now records that grace timeout, explicitly terminates only its own lingering sockets, then waits for actual CLOSED/close events. This is harness cleanup, not evidence of healthy ordinary product shutdown. The separate empty-roster guard caught old server users still present6s after forced closure; a later public probe was empty by101.3s. Both failure histories remain in the report diagnostics. Those source-specific failures preceded the reviewed bounded relay and incoming assembly guard. All20 intervening6a relay trials and its soak remain under `superseded-6a5a8d4-relay`, superseded because the relay source changed, not because of FPS. No server restart is hidden between accepted final conditions.

## Further relay design follow-up

Observer30/15/5Hz LOD reduces joint/display work only; it does not reduce the current all-to-all20Hz publisher fanout. The reviewed relay already bounds v2 pending pose state, uses one recipient writer and preserves lifecycle/profile reliability and teleport/generation coherence. Its incoming guard also bounds avatar assembly to one392-byte attachment/header+payload<=4KiB and generic binary assembly to64attachments/existing Engine.IO aggregate limit. These bounds do not apply to legacy position_update/control delivery. Receiver interest/distance and lower far delivery rates can then be evaluated against a measured freshness budget; server distance filtering is not implemented by this task. Room membership/validated root state remain authoritative rather than blindly trusting arbitrary visibility hints. A future LiveKit adapter must retain the existing pose validation and owner/observer contract; no SDK has been installed. The64binary-attachment snapshot bound still requires a packed/chunked protocol before larger populated humanoid snapshots can be promised.

Windows Chrome process CPU under4x throttling also includes the artificial throttling-thread overhead, as documented in the preserved performance report. Do not compare whole-Chrome CPU between desktop and390px4x as if that difference were application CPU demand. Retain unadjusted values and separate CDP main-thread ThreadTime; no GPU timer is inferred from these CPU values.
