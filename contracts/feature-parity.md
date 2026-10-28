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

## Task 2 HTTP mapping

These mappings cover gallery/admin HTTP behavior, not all 155 captured rules. Socket.IO, camera fallback, streaming, AI/STT, companion and gesture services belong to later tasks.

| Captured surface | Migration behavior / verification |
| --- | --- |
| `/`, `/room?room_id=`, `/wall?wall_id=`, `/element?wall_element_id=&type=` | Serve built React `index.html` when configured; preserve the requested path and all query flags. Missing/malformed IDs return400; absent documents404. Test `test_all_legacy_routes_have_mapped_behavior`. |
| Room/wall/artwork bootstrap | `/api/v1/rooms`, `/api/v1/rooms/{id}/scene`, `/api/v1/walls/{id}`, `/api/v1/elements/{type}/{id}` return typed JSON without scene HTML. Public movement controls remain enabled outside AR. |
| Wall refresh | `/wall` returns content-derived ETag including persisted wall/artwork state; matching `If-None-Match` returns304. Test `test_wall_refresh_etag_tracks_element_mutations`. |
| `/kwanri[/<resource>[/new|edit|details]]` | Same visible links serve React. Anonymous/nonadmin HTML redirects302 to signin. Marker resource retains captured `mm_marker_admin` alias. Tests exercise all11 aliases. |
| Admin CRUD | Explicit11-resource registry under `/api/v1/admin`; no User or arbitrary collection CRUD. Flat DTO IDs; provider keys masked, including admin reads. All11 create/read/patch/delete paths tested with real Mongo. |
| Admin new/edit/delete/action/ajax-update POST | Compatibility adapters accept JSON or URL-encoded data, retain admin/origin/CSRF enforcement, update relationships and reject referenced parent deletion. Bulk delete prevalidates selected documents. `action=delete` is supported; other actions fail400. |
| Generated admin export/file/ajax-lookup | Retired with410 after admin authorization. Default Flask-Admin internals are replaced by metadata/reference controls; no exact unused internal-protocol parity is claimed. Old `/kwanri/static` assets are no longer required by React. |
| PATCH `/element/{id}/{type}` | Existing success wrapper `{status,element_id}` retained; validated transform/cutout fields go through the same persistence service as canonical CRUD. |
| `/room/{id}/presets`, POST `/room/{id}/preset`, DELETE `/preset/{id}` | Existing array/create/delete wrappers retained; default spawn uniqueness and referenced-preset deletion checks enforced. |
| `/room/{id}/boundary` | Existing public boundary object retained; editing uses canonical room CRUD with finite, ordered bounds. |
| `/marker/room/{id}/markers`, `/marker/{id}/config`, `/marker/by-value/{type}/{value}`, PUT/DELETE `/marker/{id}` | Existing marker DTO/wrappers retained; mutation authorization and preset room consistency enforced. |
| `/signin`, `/logout` | GET serves React UI; logout GET does not change authentication. Signin form submits CSRF JSON to `/api/v1/auth/signin`; old POST `/signin` form protocol is migrated, not duplicated. Signout remains CSRF POST. |
| Existing stored media URLs | No URL rewriting in DTOs. Configured `media_root` serves `/static`; configured frontend build assets/vendor files are served independently. Unknown `/api/` never falls through to SPA. |

Before a React build exists, recognized HTML routes return an explicit UI-unavailable page. Browser functionality is verified separately after the real build; the fallback is not a gallery UI acceptance claim.
