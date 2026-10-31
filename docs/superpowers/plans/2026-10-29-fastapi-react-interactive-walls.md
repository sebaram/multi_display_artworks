# FastAPI, React, Shared Interactive Walls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 갤러리와 데이터를 유지하면서 Flask를 FastAPI로 교체하고 React UI, MongoDB 프리셋, 방 전체가 공유하는 인터랙티브 월을 완성한다.

**Architecture:** FastAPI와 python-socketio를 하나의 ASGI 앱으로 실행하고 기존 MongoEngine 스키마를 보존한다. React 화면과 A-Frame 씬을 lifecycle adapter로 연결하고, 참고 엔진에서 추출한 canvas renderer를 기존 월 표면에 적용한다. 프리셋과 적용 snapshot은 MongoDB, 큰 미디어 파일은 영구 볼륨, 공유 포인터는 서버의 방별 runtime 상태로 관리한다.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, python-socketio, MongoEngine/PyMongo, MongoDB 7, React, TypeScript, Vite, A-Frame, reference Three.js renderer, pytest/httpx, node:test (기존 JS), Vitest (새 TS/UI), Playwright, Docker/FFmpeg. 아래 명령의 `python`은 전용 가상환경 Python을 뜻한다.

**Spec:** [설계 문서](../specs/2026-10-29-fastapi-react-interactive-walls-design.md). 사용자가 설계를 승인했고 YouTube 별도 플레이어와 영상 재생 위치/일시정지/탐색 공유도 확정했다.

## Final status

Tasks0–9 implementation and available validation are complete. Backend181+5subtests, frontend231, development browsers30, production-build browsers29, clean-image/persistent-media checks passed; independent whole-branch findings are closed. Physical GPU/device checks and actual production snapshot rehearsal remain unexecuted as explicitly listed below. Planned example filenames/test names may differ from the final files; authoritative commands and evidence are in [migration validation](../../migration-validation.md). The feature branch is preserved; no push, merge or production deployment was performed.

## Global Constraints

- 기준 branch는 `codex/fastapi-react-interactive-walls`, base는 `974bbfd74ecd9a1330a03d7dd2a19994209ec8f5`이다.
- 운영 DB/미디어를 테스트에 사용하지 않는다. destructive fixture는 `metamuseum_test`와 test-instance marker를 모두 검사한다.
- 기존 BSON ObjectId, collection 이름, `_cls`, references, 순서, 계정/bcrypt, public URLs/쿼리, static/stream 경로를 보존한다. 가입 폐쇄 유지.
- ASGI는 Uvicorn **1 worker**. sync Mongo 작업은 event loop 밖에서 실행한다.
- 최종 런타임은 Flask, Flask-Admin, Flask-SocketIO, eventlet을 사용하지 않는다.
- 같은 방의 모든 방문자에게 월 반응을 공유한다. capability/room membership을 확인하며 다른 방 입력을 거부한다.
- 월 입력/서버 broadcast는 최대 **20 Hz**, idle reset **3초**. animation은 seed/shared epoch 기준이다.
- 기존 pose는 최대 20 Hz, stationary heartbeat 1초, interpolation 100 ms, buffer 8개를 유지한다.
- preset schema_version=1; source commit은 `b247fd238fe6cb2c8c860c77d13488b28b8a0290`; 12 built-in + Astra 16 + Meaning 16을 import한다.
- preset/binding 수정은 expected revision을 요구하고 충돌은 409. 저장과 적용을 분리한다. 기존 LocationPreset은 카메라용으로 유지한다.
- reference 한도: 32 custom objects, 4096 edits, 8 screens, 8 videos. 단일 월은 선택한 logical screen 하나를 표시한다.
- 새 미디어 기본 한도: 파일 2 GiB, 전체 20 GiB. blob URL 저장 금지, 업로드와 참조/쿼터 검증 필수.
- 첫 compositor는 animated object/text/logo/uploaded video/brightness 전부를 검증한다. YouTube/외부 iframe 제약은 설계 문서의 예외대로 처리한다.
- 제품 UI는 우선 한국어. 사용자 콘텐츠와 원본 preset 이름은 보존한다.
- 브라우저 핵심 API/Socket.IO를 mocking해서 E2E를 통과시키지 않는다. 외부 provider만 로컬 fixture로 대체한다.
- 운영 배포는 이 계획의 자동 실행 대상이 아니다. branch CI와 격리 staging까지 구현·검증한 뒤 전환 결과물을 검토한다.

## Review Focus

1. 복제 탭/sessionStorage와 reconnect로 다른 사람을 밀어내거나 guest DB 레코드가 생성되지 않는가: Task 3/5/9.
2. 기존 DB의 ObjectId/_cls/관계/좌표와 미디어 경로가 부분적으로만 보존되지 않는가: Task 0/1/2/5/9.
3. stale revision/역순 이벤트/동시 입력/재시작/late join에도 같은 방의 wall state가 수렴하는가: Task 7/8/9.
4. DOM overlay/CORS/autoplay가 editor에서는 보이지만 room/XR 월에서는 사라지지 않는가: Task 4/6/9.
5. SPA 재진입/StrictMode/권한 거절/영상 업로드 실패 후 socket/context/track/파일이 남지 않는가: Task 4/5/6/7/9.

## 단계와 병렬 작업 경계

| 단계 | 작업 | 완료 산출물 |
|---|---|---|
| 0 | Task 0 | 기능/DB/이벤트 계약, 실제 baseline, 격리 테스트 인프라 |
| 1 | Task 1 + Task 6의 초기 renderer 검증 | FastAPI 인증/데이터 수직 절편, 3D 합성 가능성 증명 |
| 2 | Task 2/3/4와 Task 5 | API/실시간/미디어 전환, React 전체 UI; 계약 고정 뒤 담당별 병렬 |
| 3 | Task 6 완성 + Task 7/8 | wall editor, 영구 프리셋, 방 단위 공유 상호작용 |
| 4 | Task 9 | 실제 브라우저 통합/회귀, branch CI, 운영 전환·복구 자료 |

동시 작업자는 최대 3명. A는 `backend/`, B는 `frontend/src/app`, `features`, `api`, C는 `frontend/src/wall-engine`, `scene` 또는 독립 QA에 배정한다. 공용 DTO/락파일/compose/workflow는 통합 담당자가 편집한다. 구현자가 자기 작업을 최종 승인하지 않으며 spec reviewer와 code reviewer를 단계별로 별도 투입한다.

각 task는 failing test → 최소 구현 → 관련 테스트 → 리뷰/수정 → 단계 commit으로 끝낸다. task 간 의존을 건너뛰어 mock UI만 먼저 완성하지 않는다.

## 파일 구조와 주요 계약

```text
backend/pyproject.toml
backend/metamuseum/{asgi,config,db,auth,models,schemas}.py
backend/metamuseum/api/{gallery,admin,legacy,integrations,wall_designs,wall_media}.py
backend/metamuseum/services/{gallery,providers,streams,wall_designs,wall_media}.py
backend/metamuseum/realtime/{server,presence,voice,ar,gesture,wall_interactions}.py
backend/tests/{conftest,test_*,fixtures/}
frontend/package.json
frontend/src/{app/,api/,features/,scene/,wall-engine/}
frontend/tests/{unit/,e2e/,fixtures/}
contracts/{feature-parity.md,legacy-routes.json,socket-events.json,legacy-bson.json,openapi.json}
scripts/{export_openapi.py,import_wall_presets.py,verify_mongo_snapshot.py}
docker-compose.migration.yml
.github/workflows/{ci.yml,deploy.yml}
docs/validation/2026-10-29-migration-baseline.md
docs/validation/migration-acceptance.md
```

`models.py`에는 순수 MongoEngine document 정의를 둔다. 파일을 나누어도 collection/_cls/class 이름은 바꾸지 않는다. 아래 DTO/API/event 이름은 인접 task 사이의 계약이며 변경할 때 계약과 생성 타입을 같은 commit에서 갱신한다.

## Task 0: 기능 계약과 실행 가능한 테스트 기준선

**Files:** `.gitignore`, `contracts/{feature-parity.md,legacy-routes.json,socket-events.json,legacy-bson.json}`, `docker-compose.migration.yml`, `backend/tests/fixtures/`, `frontend/tests/fixtures/`, `docs/validation/2026-10-29-migration-baseline.md`.

**Consumes:** 기존 `flask_server/app/metamuseum/` 소스, `flask_server/tests/`, 기존 compose/workflow.
**Produces:** 실제 HTTP method/path/auth/status/payload 목록, 11 admin resource 목록, socket event 계약, 모델별 BSON golden fixture, 정상 해시의 E2E 관리자와 로컬 미디어, 테스트 전용 DB guard.

- [x] 실행 환경을 준비한다: 프로젝트 전용 Python 3.12 env, 별도 compose project의 MongoDB 7. env/node_modules/dist/업로드/test artifacts/DB snapshot은 `.gitignore`로 제외한다. DB는 `metamuseum_test`이고 test-instance marker가 없는 서버에서 delete/reset을 거절한다. 새 포트는 실행 시 비어 있는지 확인한다.
- [x] `test_destructive_fixture_rejects_wrong_database_or_marker`를 먼저 작성한다. `metamuseum`, 외부 connection, marker 없는 `metamuseum_test` 모두 reset이 실패해야 한다.
- [x] 기존 Flask suite를 real MongoDB로 실행하고 결과를 저장한다. 이미 실행한 125 JS 테스트 결과도 기록한다. 실패는 재현/원인과 함께 baseline 결함으로 분류하며 기존 실패를 새 구현의 성공으로 숨기지 않는다.
- [x] 앱의 실제 route/socket/model 등록을 위 4개 계약 파일로 캡처한다. 선언 횟수보다 최종 중복 등록/동작을 기준으로 한다. synthetic/sanitized DB fixture에 모든 작품 유형, rotated wall/floor/ceiling, 양방향 refs, `OnlineUser`, 설정/비밀키 비공개 조건을 포함한다. 운영 dump/개인정보는 커밋하지 않는다.
- [x] 브라우저 fixture에 real hashed admin/nonadmin, local image/GLB/splat/MP4/HLS/frame-allowed/frame-blocked HTML, spawn/marker/effect를 만든다. runtime fixtures는 격리 DB만 채우며 기존 파괴적 seed 스크립트를 호출하지 않는다.
- [x] 확인: legacy Python suite 결과, `node --test tests/js/*.test.mjs` 125개 결과, golden BSON round trip 및 fixture guard 테스트. commit: `test: capture gallery migration contracts and isolated fixtures`.

## Task 1: FastAPI 실행·Mongo 호환·인증 수직 절편

**Files:** `backend/{pyproject.toml,requirements.lock,requirements-dev.lock}`, `backend/metamuseum/{asgi,config,db,auth,models,schemas}.py`, `backend/tests/{conftest,test_runtime,test_data_compat,test_auth}.py`, `scripts/export_openapi.py`, `contracts/openapi.json`.

**Consumes:** Task 0 golden BSON, 기존 visitor/confirmation token salt 및 bcrypt 형식.
**Produces:** `create_app(settings: Settings) -> FastAPI`, `asgi.app`, `require_admin(request) -> User`, `resolve_visitor(capability: str) -> VisitorIdentity`; `/health`, `/api/v1/auth/{csrf,session,signin,signout}`, 기존 capability/confirmation 경로. `SessionRead`는 인증/관리자 여부만, 비밀키/해시를 포함하지 않는다.

- [x] `test_existing_bson_and_passwords_round_trip`, `test_tokens_keep_existing_format`, `test_register_remains_closed`, `test_auth_requires_verified_admin_and_csrf`, `test_no_password_or_secret_in_response_or_log`를 failing test로 만든다. 운영 값 없이 deterministic test secret을 쓴다.
- [x] 순수 MongoEngine model을 이식해 metadata/refs/class names를 고정한다. Flask UserMixin/url_for와 render 메서드를 persistence에서 분리한다. 모델 `.clean()`의 기존 유효성 규칙을 유지한다.
- [x] Settings/lifespan/DB ping/연결 종료와 signed session/CSRF/origin/안전한 return URL을 구현한다. 로그인 교체 시 한 번 재로그인을 허용하되 계정·비밀번호·visitor/confirmation token은 보존한다.
- [x] `pyproject.toml`에서 runtime/dev dependency lock을 생성해 CI와 로컬 env가 같은 버전을 설치하도록 한다. reference/runtime browser assets도 출처와 버전을 고정한다.
- [x] sync DB endpoint/dependency는 threadpool에서, async socket에서 호출할 sync service는 명시적 offload에서 동작하게 한다. 신규 세션은 HttpOnly/SameSite, production Secure 설정을 사용한다.
- [x] `python -m pytest backend/tests/test_runtime.py backend/tests/test_data_compat.py backend/tests/test_auth.py -q`; 예상: 모두 PASS, real Mongo ping·기존 BSON 불변·정상/거절 인증 확인. OpenAPI를 export한다. commit: `feat: add FastAPI runtime with compatible Mongo models and auth`.

## Task 2: 갤러리 REST·관리 CRUD·기존 링크 호환

**Files:** `backend/metamuseum/api/{gallery,admin,legacy}.py`, `services/gallery.py`, `schemas.py`, `backend/tests/{test_gallery,test_admin,test_legacy_contracts}.py`, `contracts/openapi.json`.

**Consumes:** Task 1 auth/model, Task 0 route/BSON contracts.
**Produces:** `GET /api/v1/rooms`, `GET /api/v1/rooms/{id}/scene -> RoomScene`, 월/작품 detail DTO, allowlisted 11종 `/api/v1/admin/{resource}` CRUD, 기존 mutation API aliases. `RoomScene`은 room/boundary/spawn/presets/walls/elements/capability URL/avatar catalog/admin/debug/mode 정보를 포함하며 scene HTML은 포함하지 않는다.

- [x] `test_all_legacy_routes_have_mapped_behavior`, `test_all_admin_resources_require_admin`, `test_relationships_survive_move_and_delete`, `test_transforms_validate_finite_bounds_and_units`, `test_room_scene_excludes_secrets`를 작성한다. malformed/missing ObjectId, wall 간 이동, ordered refs를 포함한다.
- [x] allowlist/Pydantic schema 기반 CRUD, room→wall→element 조회, transform/spawn/boundary/marker/effect 저장을 구현한다. list/detail/query alias를 모두 계약에 대응시키며 refresh ETag는 실제 저장 revision/timestamp에서 만든다.
- [x] GET 딥링크와 QR가 새 SPA/DTO를 사용하게 하고 기존 PATCH/POST clients에는 호환 adapter를 둔다. `/logout` GET은 상태 변경 API 대신 UI/CSRF POST 흐름으로 연결한다.
- [x] `python -m pytest backend/tests/test_gallery.py backend/tests/test_admin.py backend/tests/test_legacy_contracts.py -q`; 예상: 모든 계약 행에 PASS 근거 존재, guest writes 거절, BSON 관계/미디어 URL 유지. commit: `feat: migrate gallery and admin APIs to FastAPI`.

## Task 3: Socket.IO·presence·voice·AR·gesture 전환

**Files:** `backend/metamuseum/realtime/{server,presence,voice,ar,gesture}.py`, `backend/tests/{test_presence_contract,test_voice,test_ar_gesture}.py`, `contracts/socket-events.json`.

**Consumes:** Task 1 identity/auth, 기존 pure PresenceService/profile normalization, 기존 event payload 계약.
**Produces:** `socketio.AsyncServer(async_mode='asgi')`, `socketio.ASGIApp(sio, fastapi_app)`, 기존 `/socket.io`/polling/WebSocket, `get_room_visitor(sid, room_id) -> VisitorIdentity | None` (Task 8에서 재사용).

- [x] real `socketio.AsyncClient` 통합 테스트를 먼저 만든다. `test_two_visitors_reconnect_and_displacement`, `test_no_guest_mongo_writes`, `test_forged_identity_and_cross_room_voice_rejected`, `test_ar_gesture_handshake_cannot_publish_presence`, `test_sse_disconnect_releases_subscriber`를 포함한다.
- [x] connect/disconnect를 단일 lifecycle로 합치고 public visitor/legacy AR·gesture handshake를 분기한다. 동기 model 조회는 offload하고 SID를 public payload에 노출하지 않는다.
- [x] 기존 join/leave/position/profile/hands/expression/voice/AR/gesture event와 SSE/상태 HTTP를 이식한다. 활성 세션 교체 시 media peer 종료 신호, disconnect cleanup, callback ack와 room isolation을 유지한다.
- [x] `python -m pytest backend/tests/test_presence_contract.py backend/tests/test_voice.py backend/tests/test_ar_gesture.py -q`; 예상: real clients 간 payload/방 격리/late join PASS, guest collection count 불변. commit: `feat: migrate realtime gallery services to ASGI Socket.IO`.

## Task 4: 미디어·AI·STT·메일 통합과 발견 결함 수정

**Files:** `backend/metamuseum/api/integrations.py`, `services/{providers,streams}.py`, `backend/tests/{test_providers,test_streams}.py`, `backend/tests/fixtures/provider_server.py`, `frontend/tests/fixtures/media/`.

**Consumes:** 관리자 auth, Task 2 관계/변환 service, Task 3 room broadcasts.
**Produces:** 기존 `/stream/*`, LLM/layout/effect/Whisper/mail HTTP contracts; `apply_layout`의 검증된 관계 변경; secret 없는 public STT capability; 관리되는 FFmpeg process lifecycle.

- [x] `test_layout_move_updates_both_relationships`, `test_effects_are_arrays_and_expire`, `test_stt_status_is_public_but_secret_config_is_admin`, `test_upstream_failure_retains_draft`, `test_hls_segments_resolve_and_process_stops`, `test_stream_paths_reject_traversal`을 만든다.
- [x] configurable local provider server로 success/timeout/invalid JSON/STT binary를 검증한다. 현재 지원하는 OpenAI-compatible wire format을 명시하고 구현 없는 provider 선택을 성공으로 표시하지 않는다.
- [x] 폰 MediaRecorder 입력 container를 감지/검증해 FFmpeg로 HLS를 만들고 RTSP fixture/정지/종료/에러 정리를 구현한다. playlist segment URI는 실제 public segment route에 연결한다. room/wall별 stream ID를 사용한다.
- [x] `python -m pytest backend/tests/test_providers.py backend/tests/test_streams.py -q`; generated stream과 real FFmpeg를 사용한다. 브라우저 영상 재생 인수는 Task 9에서 다시 확인한다. commit: `feat: port media and provider integrations with verified playback contracts`.

## Task 5: React 전체 화면과 A-Frame lifecycle adapter

**Files:** `frontend/package.json`, `frontend/src/{app/,api/,features/,scene/}`, `frontend/tests/unit/`, `frontend/tests/e2e/{gallery,auth,admin,visitor,scene-lifecycle}.spec.ts`, 기존 `flask_server/app/metamuseum/static/js/room/` 이식 파일.

**Consumes:** Task 1/2 OpenAPI에서 생성한 TypeScript DTO, Task 3 socket 계약, Task 4 미디어 API.
**Produces:** 동일 origin React SPA, preserved deep links; `mountRoom({container,bootstrap,services}) -> {update,dispose}`; 선택-aware inspector; public/admin/AR/tools 화면.

- [x] `scene-lifecycle`, `editor-selection`, `coordinates` unit tests와 real backend를 사용하는 gallery/auth E2E를 먼저 작성한다. 두 번째 작품 선택, world/local 좌표, rotated wall/floor/ceiling, StrictMode 재실행을 포함한다.
- [x] React+TS+Vite를 구성하고 API 타입을 생성한다. app routes/legacy query alias, catalog/detail/signin/admin 11종 forms/settings/AR/tools를 구현한다. API/media 우선순위가 SPA fallback보다 앞서야 한다.
- [x] 기존 pose/visitor/core 모듈을 최대한 재사용한다. DOM/global singleton은 instance lifecycle로 변경하고 scene 객체는 React 밖에서 갱신한다. toolbar/profile/map/share/voice/hand/expression/AI를 연결한다.
- [x] drag/선택 inspector/실패한 save의 draft 보존, wall image background, HLS/native fallback, 표면별 좌표, splat clipping과 webpage 허용/차단 overlay 처리를 구현한다. clipping 검증 실패는 미완료로 남기고 완료로 대체하지 않는다.
- [x] keyboard/focus/labels/reduced-motion/mobile layout을 점검하고 avatar/vendor attribution과 local pinned runtime assets를 제공한다. 미사용 과거 데모까지 새 UI를 만들지 않는다.
- [x] `npm --prefix frontend run typecheck`, `npm --prefix frontend test`, `npm --prefix frontend run test:e2e -- gallery auth admin visitor scene-lifecycle`; 예상: 실제 login/저장/reload/탭 identity/scene 전환 PASS, unexpected console/pageerror 없음. commit: `feat: replace gallery web UI with React and managed A-Frame scenes`.

## Task 6: 참고 엔진 추출·3D 합성 검증·월 authoring UI

**Files:** `frontend/src/wall-engine/{renderer,config,compositor,motion}.ts`, `frontend/src/features/wall-editor/`, `frontend/src/scene/interactive-wall.ts`, `frontend/tests/unit/wall-engine/`, `frontend/tests/e2e/wall-rendering.spec.ts`, `frontend/public/wall-presets/`, `THIRD_PARTY_NOTICES.md`.

**Consumes:** pinned reference source/config/stable element IDs. 초기 합성 검증은 기존 A-Frame의 격리 test scene에서 진행하므로 Task 5와 독립적이다. 최종 연결은 Task 5 scene adapter를 사용하며 Task 7 전에는 in-memory fixture config를 사용한다.
**Produces:** reference state/authoring validator를 포팅한 `WallLookV1`과 backend JSON-schema contract; `createWallRenderer({canvas,config,assetResolver,onError}) -> WallRenderer`; `setConfig(config)`, `resize(width,height)`, `setInteraction({x,y})`, `render(timeSeconds)`, `dispose()`; 동일 renderer 기반 editor/standalone/room.

- [x] 초기 수직 검증부터 한다: 한 animated object/text/logo/uploaded video/brightness를 합성해 월 texture로 표시한다. `test_composition_keeps_all_layer_classes`, `test_uv_pointer_orientation`, `test_same_seed_and_time_give_same_motion`, `test_dispose_releases_context_and_media`를 작성하고 real browser frame/texture를 검사한다.
- [x] editor/room aspect, crop, rotated surface, composition and disposal were checked with real WebGL fixtures.
- [ ] Physical desktop/mobile GPU30/24FPS benchmark: actual device measurement was unavailable; headless functional evidence is not reported as hardware performance.
- [x] engine에서 window/URL/localStorage/global loop를 제거하고 seeded/time-based motion으로 바꾼다. reference DOM text/logo/video/brightness를 compositor로 옮긴다. original Three.js 객체를 A-Frame으로 직접 넘기지 않는다.
- [x] layer/preset browser, search/group/regroup/order, move/size/rotation/visibility/delete, clipboard/duplicate/undo/redo/keyboard, rich text, appearance/motion controls를 구현한다. authoring draft는 live wall과 분리한다.
- [x] 12+16+16 source look과 출처 manifest를 로컬 bundle에 고정한다. source limits와 single logical screen 선택을 UI/schema에 반영한다. YouTube/외부 iframe은 설계의 제약을 화면에 표시하고 실제 미지원 합성을 지원으로 표시하지 않는다.
- [x] `npm --prefix frontend test -- wall-engine`, `npm --prefix frontend run test:e2e -- wall-rendering`; 예상: 모든 layer의 실제 렌더링, asset 실패, resize/context loss/re-entry, 같은 seed/time 출력 검증 PASS. commit: `feat: add reusable wall renderer and interactive authoring UI`.

## Task 7: MongoDB 프리셋·assets·wall 적용

**Files:** `backend/metamuseum/api/{wall_designs,wall_media}.py`, `services/{wall_designs,wall_media}.py`, `models.py`, `schemas.py`, `scripts/import_wall_presets.py`, `backend/tests/{test_wall_designs,test_wall_media}.py`, `frontend/src/features/wall-editor/`, `frontend/tests/e2e/wall-presets.spec.ts`.

**Consumes:** Task 6 WallLookV1/config validator/manifest; Task 1 auth; Task 2 RoomScene.
**Produces:** `WallDesignPreset`, `WallDesignBinding`, `WallDesignAsset`; `/api/v1/wall-presets` CRUD, `/api/v1/wall-presets/import`, `/api/v1/wall-presets/{id}/export`, `/api/v1/walls/{id}/design` GET/PUT/DELETE, `/api/v1/wall-assets` upload/delete and asset GET. Writes use `expected_revision`; `AppliedWallDesign` includes immutable config snapshot and animation seed/epoch.

- [x] `test_import_44_presets_is_idempotent`, `test_save_does_not_change_applied_wall`, `test_apply_preserves_wall_and_artworks`, `test_binding_overrides_background_and_unbind_restores_it`, `test_stale_revision_returns_409`, `test_restart_restores_presets_and_assets`, `test_referenced_asset_cannot_be_deleted`를 real Mongo tests로 만든다.
- [x] new collections/unique indexes/revision CAS를 구현한다. source defaults는 readonly, duplicate는 custom editable record로 만든다. 기존 LocationPreset과 작품 문서를 이 프리셋에 섞지 않는다.
- [x] persistent wall_media volume과 streaming upload/MIME/size/quota/generated path/cleanup을 구현한다. `test_partial_upload_and_quota_race_leave_no_orphans`, `test_blob_url_and_path_traversal_rejected`를 추가한다. 브라우저 local file은 upload 완료 후만 config 저장 가능하다.
- [x] UI에서 새 저장/다른 이름/복제/삭제/검색/thumbnail/JSON import/export/명시적 적용/409 diff 상태를 연결한다. apply snapshot에만 room broadcast가 발생하고 단순 저장은 live wall을 바꾸지 않는다.
- [x] `python -m pytest backend/tests/test_wall_designs.py backend/tests/test_wall_media.py -q`와 `npm --prefix frontend run test:e2e -- wall-presets`; backend를 재시작한 뒤 reload하고 동일 look/asset을 확인한다. commit: `feat: persist and apply wall design presets in MongoDB`.

## Task 8: 방 전체에 공유하는 월 입력·애니메이션

**Files:** `backend/metamuseum/realtime/wall_interactions.py`, `frontend/src/scene/interactive-wall.ts`, `frontend/src/wall-engine/motion.ts`, `backend/tests/test_wall_interactions.py`, `frontend/tests/e2e/shared-wall.spec.ts`, `contracts/socket-events.json`.

**Consumes:** Task 3 `get_room_visitor`, Task 7 AppliedWallDesign, Task 6 renderer's input/render methods.
**Produces:** spec §8의 `wall.interaction`, `wall.interaction_state`, `wall.design_applied` events, `WallRuntimeState` and join/reconnect snapshot; authoritative single shared pointer and server-clock-driven rendering.

추가 확정 계약: `wall.playback_command`/`wall.playback_state`는 spec §8을 따른다. 영상 clock은 binding에 저장하고 admin-only control, optimistic concurrency, late join/reconnect/restart 복원, YouTube iframe API와 uploaded video 양쪽의 시간 보정을 구현한다.

- [x] `test_only_members_can_interact_with_their_wall`, `test_input_is_finite_bounded_and_revision_checked`, `test_last_accepted_input_wins_and_broadcast_is_capped`, `test_active_disconnect_or_idle_resets_pointer`, `test_late_join_and_restart_snapshot`를 작성한다. spectator/AR-only handshake로 wall input을 허용하지 않는다.
- [x] wall별 runtime_id/sequence/state와 20 Hz coalescing을 구현한다. client_seq 중복/역순과 이전 binding revision을 무시하고 state/apply 전달 순서를 계약 테스트로 고정한다. idle reset은 3초, center는 x=y=0이다.
- [x] mouse/touch/XR hit UV를 normalized pointer로 변환한다. 자신도 authoritative echo를 따르고 모든 renderer는 shared seed/epoch/server clock estimate로 평가한다. timestamp/phase 보정은 화면 프레임 누적 시간이 아닌 동일 기준을 사용한다.
- [x] `test_playback_commands_require_admin_and_revision`, `test_play_pause_seek_late_join_restart`, `test_video_player_tracks_canonical_clock`를 추가한다. 실제 업로드 영상 두 플레이어의 play/pause/seek와 0.5초 drift 보정을 검증하고 YouTube는 iframe adapter protocol 단위 테스트 + 가능한 live smoke로 구분한다.
- [x] 두 개의 실제 browser context가 같은 방에 참여해 A/B 입력 각각을 모두 관찰한다. concurrent input/지연/재접속/late join/다른 방/관리자 apply/서버 restart를 검증한다. local test network에서 최종 state는 250 ms 이내 수렴을 목표로 검사하며 인터넷 전체 SLA로 표현하지 않는다.
- [x] `python -m pytest backend/tests/test_wall_interactions.py -q`와 `npm --prefix frontend run test:e2e -- shared-wall`; 예상: state/seed/phase 수렴, 다른 방 event 없음, DB에는 pointer별 write가 없음. commit: `feat: synchronize interactive wall reactions across room visitors`.

## Task 9: 전체 실브라우저·CI·패키징·전환 리허설

**Files:** `frontend/playwright.config.ts`, `frontend/tests/e2e/`, `.github/workflows/{ci.yml,deploy.yml}`, 최종 Dockerfile/compose/startup, `docs/migration-validation.md`, `docs/validation/results.json`, `README.md`.

**Consumes:** Task 0~8 전체 결과, spec §9의 인수 조건.
**Produces:** branch CI + test artifacts + 격리 staging build + 데이터 호환/운영 복구 runbook. 실제 운영 배포는 별도 검토 후 실행한다. 자동 승인 검토가 운영 job 활성화를 거절하여 현재 workflow는 검증 전용이고, 운영 job은 텍스트 제안으로만 보존했다.

- [x] Real Mongo+ASGI browser suites passed: development30/30 and actual FastAPI-served production bundle29/29 (one development-only harness excluded). Firefox/WebKit,390px/reduced-motion/keyboard, multitab, deep links/reload and real media decoding are covered. Physical touch/XR/GPU remains explicitly unverified.
- [x] 로컬 RTSP test source→FFmpeg→HLS→browser playback, fake microphone 권한/거절/voice peer tracks/admin toggle/STT transcript, AR/gesture의 synthetic relay를 검증한다. 실제 device/네트워크/TURN/provider smoke는 별도 열에 성공/실패/미실행으로 기록한다.
- [x] feature-parity.md의 모든 행을 구현/검증 근거와 연결한다. cutout/Webpage/YouTube 같은 예외는 사용자와 정한 인수 기준에 따라 명시하고 미완료를 PASS로 바꾸지 않는다.
- [x] Docker multi-stage frontend build + Python runtime을 만들고 기존 production media mount/port 51736/socket proxy를 보존한다. 새 wall_media volume을 포함하고 test/dev Mongo와 production external Mongo를 분리한다. 최종 이미지의 installed packages/imports에 Flask/Flask-Admin/Flask-SocketIO/eventlet이 없는지 확인한다.
- [x] 필요한 static assets와 재사용 순수 모듈 이식을 확인한 후 대체된 Flask 앱/requirements/Dockerfile/시작 스크립트를 제거한다. 이전 동작의 근거는 Git 이력과 새 테스트/계약 파일로 유지한다.
- [x] Branch/PR CI runs Python/Node/typecheck/build/real Mongo/Socket.IO/controlled RTSP/Playwright/image smoke. Active migration workflow is validation-only after automatic approval rejected production activation; the master-only deployment job is saved as a reviewable text proposal. Branch pushes cannot deploy production.
- [ ] production snapshot 접근이 준비되면 dump→격리 restore→새 앱 read/write→ID/collection/ref/index/media 비교를 실행한다. additive wall collections/bindings만 추가되었는지 확인하고 이전 이미지로 돌아가는 리허설과 미디어 복구 절차를 기록한다. **미실행:** 운영 snapshot 접근이 제공되지 않아 실제 데이터 리허설은 수행하지 않았으며 runbook으로 남겼다.
- [x] 최종 확인: `python -m pytest backend/tests -q`, `npm --prefix frontend run typecheck`, `npm --prefix frontend test`, `npm --prefix frontend run build`, `npm --prefix frontend run test:e2e`, clean image `/health`/real page/Socket.IO/media smoke, `git diff --check`. 재현 결함은 담당 구현자에게 돌려보내 고친 뒤 해당 시나리오와 관련 회귀만 다시 실행한다.
- [x] 별도 reviewer의 whole-branch review와 증거 목록을 마친 뒤 `chore: validate FastAPI React migration and complete branch CI`로 commit한다. 최종 보고에는 구현/테스트/실기 미확인 사항과 배포 전 필요한 접근만 적는다.

## 지금까지 완료한 준비

- [x] origin을 fetch하고 별도 migration branch 생성.
- [x] backend/frontend/reference 조사에 독립 서브에이전트 3명 투입.
- [x] 사용자 결정: 같은 방 방문자 전체에 실시간 반응 공유.
- [x] 기존 JS suite 125개 PASS 확인.
- [x] Docker/Python/Node/현재 CI 및 self-hosted runner 상태 확인.
- [x] 설계·단계별 계획 작성.
- [x] fresh builder review 수행 및 배경 우선순위 확정.
- [x] 사용자 승인: YouTube 별도 플레이어, 재생 위치/일시정지/탐색 공유.
- [x] 사용자 설계/범위 검토 후 Task 0부터 제품 구현 시작.

작업 완료 표시는 실제 결과/테스트/commit 근거가 생긴 항목에만 한다. 계획 작성과 제품 구현 완료는 구분한다.
