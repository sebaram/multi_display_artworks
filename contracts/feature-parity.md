# Migration feature parity contract

Captured 2026-10-29 from the registered legacy Flask app on the approved migration branch. `legacy-routes.json` contains **155 final HTTP rules**, including generated Flask-Admin routes; **105 GET, 70 POST, 2 PUT, 2 DELETE, 1 PATCH method registrations** (HEAD/OPTIONS listed separately). The contract stores exact source locations, extracted input/response expressions, explicit status codes, auth policy and actual anonymous response statuses/shapes. Source expressions describe conditional behavior, not a claim every branch was executed. The infinite gesture SSE response was deliberately not consumed during HTTP capture.

`socket-events.json` contains **27 final Socket.IO handlers** for namespace `/`, their actual source, input expressions and emission payload/routing expressions. Connect/disconnect are the final position-sync handlers registered after AR; disconnect explicitly cleans AR and presence. Counting decorators would incorrectly duplicate these events. Gesture registration happens once per process. Fresh processes are required when recapturing registration.

| Surface | Contract / required preservation |
| --- | --- |
| Catalog, room, wall, artwork | `/`, `/room?room_id=`, `/wall?wall_id=`, `/element?wall_element_id=&type=`; preserve QR/deep links and `ar`, `preset`, `debug=sync`, `user=new`, `refresh`, `display_type`, `avatar` behavior. |
| Health and visitor capability | `/health` Mongo status; POST `/visitor-capability` returns201 `{visitorId,capability}`. Signed salt `metamuseum.visitor-capability.v1`, max age86400s. Guests do not create users. |
| Legacy camera fallback | POST `/camera-data` accepts userId/position/rotation and optional hand fields; GET `/get-cameras` returns records updated within5s. Keep this distinct from capability-based presence. |
| Authentication | GET/POST signin, logout, protected, confirm token (3600s), closed registration redirect. Existing bcrypt hashes remain valid; new admin sessions require one login. |
| Admin | Exactly Room, Wall, Image, GaussianSplat, GLTFmodel, Webpage, LocationPreset, RoomEffect, Marker, LLMConfig, WhisperConfig. User CRUD is absent. Anonymous/nonadmin HTML denies by302 signin; JSON mutations deny403. |
| Editing | PATCH `/element/<id>/<type>` transforms/cutout; location preset CRUD/default spawn; room boundary; wall/room refs and ordered artwork lists. Numeric transforms and vector strings remain distinct. |
| Media | `/stream/push`, start-rtsp, stop, list, playlist and segment. Existing static paths and stored URLs survive. Admin-only writes. Actual MP4/HLS decoding must be checked in browser later. |
| AI and STT | `/api/auto-layout`, apply-layout, auto-effect, clear-effects, transcribe, whisper-config. Public DTOs omit password/api_key; provider endpoints use local fixtures during CI. Legacy whisper-config GET is admin-only403 to visitors, recorded as an existing deficiency. |
| AR | Marker CRUD/config/by-value, companion page/status, device join/leave/marker/sync events. AR device sockets must not gain visitor or shared-wall authority. |
| Gesture | Test page, finite HTTP state/touchpoint/gesture, SSE stream, gesture_mark events. Preserve existing device profile and bounded queues/cleanup. |
| Realtime | Signed tab capability, actual room membership/SID authority, profile normalization, hand pose, expression, duplicate displacement, reconnection, WebRTC voice targets and admin toggle. Max20Hz pose,1s stationary heartbeat,100ms interpolation,8samples. |
| New shared wall | Durable presets/bindings/assets; snapshot/revision rules; same-room authoritative interactions and admin playback play/pause/seek. These events are new and absent from legacy capture; approved design is their contract. YouTube uses a separate synchronized2D player. |

## BSON and fixture invariants

`legacy-bson.json` is canonical Extended JSON generated from **13 real MongoEngine schemas and18 synthetic documents**. Collections are `room`, `wall`, `image`, `gaussian_splat`, **`g_l_t_fmodel`**, `webpage`, `location_preset`, `marker`, `room_effect`, `users`, `llm_configs`, `whisper_configs`, `online_user`. Do not normalize the unusual GLTF collection name. Inherited artwork `_cls` and ObjectId reference/list encoding come from `to_mongo`; no fabricated DBRef representation is substituted. Field metadata captures db_field, required, unique, null, reference model/dbref flag; documents capture defaults and ordering.

Fixtures include two rooms for room-isolation tests; rotated wall, floor and ceiling; all four artwork types; frame-allowed and frame-blocked webpages; bidirectional Room↔Wall↔artwork refs; default spawn; Hiro marker linked to spawn; a typed effect with expiry; OnlineUser hand/camera data; admin/nonadmin with real synthetic bcrypt hashes; sentinel-only local service keys. No production dump, user identity, account hash or real key was used. Synthetic credentials are deliberately public and limited to the isolated fixture DB.

`backend/tests/fixtures/isolated_db.py` refuses reset/seed unless the URI is exactly the dedicated direct connection, selected database is `metamuseum_test`, actual server is127.0.0.1:27028 and the exact instance marker exists in **`metamuseum_migration_guard.instance`**, outside the dropped database. Legacy pytest runs through `run_legacy.py`, which checks the marker before each test. Do not invoke the old destructive seed script as fixture setup; the unchanged legacy seed regression itself runs only under this guard.

## Known baseline deficiencies (not successful migration features)

Executed baseline suites have no failures: Python50pass, JS125pass. That does not establish complete parity. The approved design separately identifies inspector selection, drag coordinates/lifecycle cleanup, Wall.image_url rendering, HLS segment routing, recorder MIME negotiation, cross-wall AI reverse refs, effect typing/initialization/expiry and visitor STT status as required fixes. Source inspection confirms splat cutout is explicitly disabled and Webpage renders a placeholder in3D. Legacy signin does not call form validation and request_loader logs form data; these must be corrected in the migration, not copied as desired contracts. No live provider, physical XR/AR device, iframe composition, browser playback, clipping or GPU performance success is claimed here.
