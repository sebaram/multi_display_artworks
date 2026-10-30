# Customizable Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 복수 프리셋·개인 외형 저장·연결된 전신 움직임을 지원하되 현재 방 동기화와 성능을 보존한다.

**Architecture:** 서버 단일 카탈로그와 버전 있는 appearance/pose 계약을 사용한다. 본인 클라이언트가 입력 → 모션/IK → 최종 공통 rig 관절 포즈를 한 번 계산한다. 서버는 검증·최신 메모리 상태 보관·중계만 수행하고, 관찰자 클라이언트는 관절 포즈를 보간·표시한다. 외형은 MongoDB에 저장하고 고빈도 pose는 Socket.IO binary로 전달한다. 과거 동작 녹화/재생은 별도 요청 시 진행한다.

**Tech Stack:** 기존 React/TypeScript, A-Frame1.8/super-three r184, GLB/SkeletonUtils, FastAPI/MongoEngine/Socket.IO, Vitest/node/Playwright.

**Spec:** ../specs/2026-10-30-customizable-avatars-design.md

## Global Constraints

- 2026-10-30 사용자가 구현을 승인했다. 현재 결과를 기반으로 `codex/avatar-customization` 브랜치에서 진행한다.
- Socket.IO를 유지하며 `avatar/transport.ts`에서 포즈 publish/subscribe만 담당한다. 포즈·IK·모델 코드가 Socket.IO API를 직접 부르지 않게 한다. 향후 LiveKit 어댑터 추가가 가능하도록 하되 SDK/서버·다중 transport 설정은 만들지 않는다.
- 공통 rig의 새 사람형4프리셋과 기존 shiba/robot/rigged-simple/none ID 호환을 보존한다. 실제 모델·복장 자산 확보/재배포 허용은 첫 과업의 선행 조건이다.
- 두 번째 Three 런타임, 외부 아바타 SaaS, 임의 모델 업로드는 초기 범위에서 제외한다.
- appearance schemaVersion2, pose version2. 기존 이름/avatarId/color와 v1 pose의 join/late join/reconnect를 깨지 않는다.
- 외형 MongoDB 저장과 탭 단위 visitor 신원은 분리한다. 고빈도 pose와 카메라 영상은 저장하지 않는다.
- 본인1명의 모션/IK만 생성하고 원격 아바타는 IK를 재계산하지 않는다. 서버는 최신 pose를 메모리에 보관하되 IK/렌더링을 하지 않는다. 공통 rigVersion/뼈 순서/길이와 binary full snapshot 계약을 Task1에서 확정한다.
- A-Frame 소유 XR session을 재사용하고 world meter/Y-up 및 camera rig 변환을 일관되게 적용한다.
- 다리/골반은 추정임을 유지한다. 기존 가상 바닥만 접지하며 임의 작품을 보행 충돌 지형으로 사용하지 않는다.
- 실제 휴대폰/Quest3가 없으므로 PC/mock XR 결과와 실기기 측정을 구분한다.

## Review Focus

- 한 사람의 재질/옷/모자 변경이 같은 모델을 쓰는 다른 사람에게 퍼지지 않을 것.
- local-floor/local 전환, rig 텔레포트·회전 후 팔 목표가 두 번 변환되지 않을 것.
- 손 하나가 사라지거나 과거 sequence가 늦게 도착해도 팔이 멎거나 뒤집히지 않을 것.
- 로그인/로그아웃·다중 탭·새 방문자 생성이 다른 사람의 저장 외형/신원을 덮어쓰지 않을 것.
- 보이지 않는 동안 받은 외형/pose가 재등장 때 반영되고, 늦은 모델 로드가 퇴장 뒤 자원을 되살리지 않을 것.

---

### Task 1: 공통 사람형 자산과 독립 아바타 수명

**Files:** Create `backend/metamuseum/avatar_catalog.py`, `backend/metamuseum/schemas_avatar.py`, `backend/metamuseum/api/avatars.py`, `frontend/src/avatar/types.ts`, `frontend/src/avatar/catalog.ts`, `frontend/src/avatar/rig.ts`, `frontend/src/avatar/resources.ts`, `frontend/public/avatars/`, `frontend/tests/unit/avatar-resources.test.ts`; Modify `backend/metamuseum/asgi.py`, `frontend/src/scene/legacy/avatar-catalog.js`, `frontend/src/scene/legacy/avatar-renderer.js`, `frontend/src/scene/legacy/rendering/scene.js`.

**Interfaces:** `types.ts`에 spec의 `AvatarPreset`, `AvatarAppearanceV2`, 로컬 전용 `AvatarInputV2`, 최종 관절 전송용 `AvatarPoseV2`, `Calibration` 계약을 먼저 정의한다. `AvatarPreset`는 id/assetUrl/thumbnail/rigVersion/rigMap/materialSlots/headAnchor/capabilities/budgets를 제공한다. root transform/hipsOffset과 고정 bone 순서의 부모 기준 회전 배열을 계약으로 정하고 전송/수신에서 같은 rig를 사용한다. `createAvatarInstance({scene,preset,appearance}): Promise<{root,applyAppearance,applyPose,setDetail,dispose}>`는 공유 자산 참조와 사용자별 skeleton/material을 소유한다. 여기서 `GET /api/v1/avatars/catalog`를 등록하고 `loadAvatarCatalog()`가 이를 읽도록 한다. 후속 작업은 이 계약을 가져와 정규화/송수신을 구현한다.

- [ ] 기준 사람형 한 개를 확보하고 뼈 이름/방향·meter scale·idle/walk clip·재질 슬롯·head anchor·라이선스를 검사한다. 목표20k triangles/70bones/본체2material/1024px를 확인한다. 네 외형은 같은 rig를 사용하는 조합으로 정의한다.
- [ ] `avatar-resources.test.ts`에 두 인스턴스의 bone 회전·상의 색·모자 분리, geometry/texture 공유 및 마지막 해제, load 도중 dispose 후 재부착 없음의 실패 검증을 작성하고 실행한다.
- [ ] AFRAME.THREE와 같은 revision의 SkeletonUtils를 연결한다. 기존 avatar factory를 새 어댑터로 연결하되 레거시 모델은 그대로 읽는다. 프로필 갱신 때 외형 변경만으로 모델 전체를 재로드하지 않는다.
- [ ] `npm.cmd exec vitest -- run tests/unit/avatar-resources.test.ts`, `npm.cmd run typecheck`와 실제 기준 모델 로드/두 방문자의 다른 색 표시를 검증하고 커밋한다.

### Task 2: 버전 있는 외형·저장·프리셋 편집

**Files:** Create `frontend/src/avatar/appearance.ts`, `frontend/src/features/avatar/AvatarEditor.tsx`, `frontend/src/features/avatar/AvatarPreview.tsx`, `backend/tests/test_avatar_profiles.py`, `frontend/tests/unit/avatar-appearance.test.ts`, `frontend/tests/e2e/avatar-customization.spec.ts`; Modify `backend/metamuseum/schemas_avatar.py`, `backend/metamuseum/api/avatars.py`, `backend/metamuseum/models.py`, `backend/metamuseum/auth.py`, `backend/metamuseum/asgi.py`, `backend/metamuseum/realtime/profile.py`, `backend/metamuseum/realtime/presence.py`, `backend/metamuseum/realtime/server.py`, `backend/metamuseum/api/gallery.py`, `backend/metamuseum/schemas.py`, `frontend/src/api/types.ts`, `frontend/src/features/room/Room.tsx`, `frontend/src/scene/realtime.ts`, `frontend/src/scene/legacy/application.js`, `frontend/src/scene/legacy/profile-store.js`, `frontend/src/scene/legacy/profile-panel.js`, `frontend/src/scene/legacy/visitor-session.js`.

**Interfaces:** `AvatarAppearanceV2`는 spec에 열거한 필드만 수용한다. `normalizeAppearance(input,catalog): AvatarAppearanceV2`. `GET /api/v1/avatars/catalog`, `GET /api/v1/me/avatar`, `PUT /api/v1/me/avatar {appearance,expectedRevision,ownerScopeToken}`. GET/저장 성공은 `{appearance,revision,ownerScopeToken}`, 충돌/소유자 전환은409다. 기존 profile_update/profile_updated의 정규화된 appearance를 join/room_state에도 포함한다. legacy onSave의 동기식 즉시 닫기를 바꾸어 Promise 성공 때만 적용/닫기 처리한다.

- [ ] 기존3필드 이전, 무효 ID/색/부품URL 거부, 지원하지 않는 얼굴/모자 조합 정규화, 소유자 분리, CSRF, revision 충돌, 익명 cookie와 account 전환을 계약 테스트로 작성하고 실패를 확인한다.
- [ ] `AvatarProfile`의 ownerKey 고유 인덱스/익명90일TTL을 정의한다. 익명 owner는 서명 cookie, account는 기존 검증된 session_user에서 구한다. GET에서 익명 cookie를 준비하고 첫 PUT 때만 DB 기록을 만든다. 입장 위치나 다른 탭의 visitor capability를 공유하지 않는다.
- [ ] 로그인 시 기존 계정 외형 우선/계정 기록 없으면 익명 외형을 미저장 draft로만 사용, 로그아웃 시 익명 저장값 복귀를 구현한다. 로그인/로그아웃/새 방문자 생성으로 저장 기록을 자동 덮어쓰지 않는다. 다른 탭의 계정 전환 중 PUT은 ownerScopeToken 불일치409를 반환하는 테스트를 추가한다.
- [ ] React 미리보기 회전/확대,4프리셋, 부위 색/얼굴/헤어/모자/안경, 적용/취소/다시 불러오기를 구현한다. 적용 전에는 로컬 draft, 저장 성공 후에만 profile_updated를 방송한다. 다른 탭의 저장 충돌은 명시한다.
- [ ] immersive XR에는 저장 프리셋 선택/되돌리기를 위한 world panel을 추가해 DOM overlay가 없어도 사용할 수 있게 한다. 정밀 편집은 XR 진입 전 React 편집기를 사용한다.
- [ ] 두 브라우저/늦은 입장/재접속에서 외형 일치, 타인의 색 불변, 취소 시 비방송, 탭 독립, 모델 로드 실패 대체 표시를 실제 브라우저에서 검증한다. 기존 presence/profile/session 테스트도 통과시키고 커밋한다.

### Task 3: 데스크톱/모바일 전신 동작과 발 접지

**Files:** Create `frontend/src/avatar/pose.ts`, `frontend/src/avatar/pose-codec.ts`, `frontend/src/avatar/transport.ts`, `frontend/src/avatar/motion.ts`, `frontend/src/avatar/two-bone-ik.ts`, `frontend/tests/unit/avatar-motion.test.ts`, `frontend/tests/unit/avatar-pose-codec.test.ts`, `frontend/tests/unit/avatar-transport.test.ts`; Modify `legacy/rendering/scene.js`, `legacy/rendering/render-loop.js`, `legacy/core/pose-buffer.js`, `legacy/core/pose-publisher.js`, `frontend/src/scene/realtime.ts`, `backend/metamuseum/schemas_avatar.py`, `realtime/presence.py`, `realtime/server.py`, `backend/tests/test_presence_contract.py`.

**Interfaces:** `AvatarInputV2`는 로컬 root/head/hand targets/tracking/locomotion이고 `AvatarPoseV2`는 spec의 version/rigVersion/sequence/sampleTime/root/hipsOffset/boneRotations/tracking/teleport다. `updateAvatarMotion(instance,input,delta,ground,detail)`는 본인의 idle/walk, 독립 head/torso yaw, 추정 hips, foot lock을 갱신하고 최종 pose를 생성한다. `encodeAvatarPose`/`decodeAvatarPose`는 메타데이터와 float32 binary 배열을 처리한다. `interpolateAvatarPose(a,b,t)`는 root와 최종 bone quaternion을 보간하며 원격 IK/보행을 실행하지 않는다. `solveTwoBone(chain,target,pole,limits)`는 도달 범위와 유한 값을 보장한다.

`AvatarPoseTransport`는 `publish(pose)`, `subscribe(listener): unsubscribe`, `dispose()`의 작은 경계로 둔다. Socket.IO 이벤트 등록/해제·binary 전송은 여기에만 두고 모션/모델/codec은 transport SDK를 import하지 않는다. 같은 인터페이스에 후속 LiveKit 어댑터를 붙일 수 있지만 이번에는 Socket.IO 하나만 구현한다. room lifecycle의 연결 소유권은 기존 연결을 따른다.

- [ ] 머리를 좌우/상하로 돌려도 몸통이 쓰러지지 않음, 보행/정지/후진/회전, 발 접지, 닿지 않는 목표, 발 위상 순환, teleport 즉시 초기화의 실패 테스트를 추가한다.
- [ ] camera entity를 avatar root로 쓰던 구조를 분리하고 이름·표정·음성의 기존 lookup ID는 호환 anchor에 남긴다. 초기 바닥은 room boundary floor이며 standalone wall/AR처럼 바닥 정의가 없으면 foot planting을 끄고 안전한 idle을 사용한다.
- [ ] v2 binary 왕복·정확한 길이/관절 순서/endianness·NaN/무효 quaternion/알 수 없는 rigVersion 거부·재접속 세대/sequence·서버 시간 매핑 테스트를 추가한다. v1 어댑터, 메타데이터 포함4KiB 상한,20Hz 지속+짧은 burst 제한을 적용한다. live packet은 오래된 버퍼를 버리고 join/reconnect는 최신 전체 스냅샷을 받게 한다.
- [ ] 서버는 사용자별 최신 검증 스냅샷만 메모리에 보관하고 퇴장 시 해제한다. 본인1명의 모션/IK 결과를 송신하고 수신자는 이를 보간 적용한다. 수신 아바타 수를 늘려도 본인 IK 호출이 늘지 않고 서버/관찰자 IK 호출이0이며, GPU 스키닝은 계속 필요함을 검증한다. 자기 머리를 숨겨도 원격 표시용 포즈는 생성한다. MongoDB 고빈도 쓰기/녹화 기능은 추가하지 않는다.
- [ ] 기존 presence unit/E2E와 함께 PC/390px mobile, 두 방문자의 머리/몸통/발과 teleport를 검증한다. 이 단계를 첫 실용 버전으로 삼아 XR 입력이 없어도 완결된 외형/동작을 제공한다.
- [ ] 전체 frontend와 해당 backend 계약을 검증하고 커밋한다.

### Task 4: XR 입력 통합·팔 IK·키 보정

**Files:** Create `frontend/src/avatar/xr-input.ts`, `frontend/src/avatar/calibration.ts`, `frontend/tests/unit/avatar-xr-input.test.ts`, `frontend/tests/e2e/avatar-tracking.spec.ts`; Modify `legacy/interaction/hand-tracking.js`, `scene/realtime.ts`, `avatar/pose.ts`, `avatar/motion.ts`, `legacy/core/pose-buffer.js`, `legacy/rendering/scene.js`.

**Interfaces:** `sampleAvatarInput({frame,referenceSpace,xrOrigin,calibration}): AvatarInputV2`는 같은 frame의 HMD/grip/wrist를 월드 좌표로 통일하는 로컬 전용 입력이다. 이를 본인 `updateAvatarMotion`에 넣어 계산한 관절 포즈만 송신한다. `calibrateAvatar({viewer,floorMode,posture}): Calibration`은 Task1의 version/eyeHeight/floorOffset/mode/referenceSpace 계약을 반환한다. tracking loss는250ms 이후 untracked, 약300ms 동안 rest로 blend하며 최대20Hz 송신과 정지 heartbeat를 유지한다. session은 scene.renderer.xr.getSession()의 소유권을 가져오지 않는다.

- [ ] floor/local, rig 이동/yaw, teleport, 좌우 한쪽만 존재, controller→hand 전환, session end, 잘못된 quaternion/과거 packet, 앉은 자세와 손의 도달 범위를 mock XR 실패 테스트로 확인한다.
- [ ] 별도 session을 request하던 hand 경로를 renderer 소유 session 수집으로 대체한다. pointer ray 대신 grip/wrist를 팔 끝 목표로 삼고 같은 frame의 head/hand에서 본인 IK를 계산한다. 원격은 송신한 관절을 보간해 뼈/손 mesh를 갱신하며 손 DOM을 재생성하지 않는다.
- [ ] 양팔 two-bone IK, elbow pole, body/head 분리, 키 보정/앉기 전환, 추정 다리와 접지,1인칭 자기 머리 숨김을 구현한다. 완전한 손가락/얼굴/다리 native SDK 지원은 전제하지 않는다.
- [ ] 가상 XR 입력을 실제 A-Frame scene에 전달하는 E2E로 팔이 어깨와 연결됨·손목 목표 추종·rig 변환 중복 없음·추적 소실 후 복귀를 확인한다. 실기기가 있을 때만 Quest3 controller/hand/seated 측정을 추가한다.
- [ ] 기존 AR/gesture/voice/shared-wall/room lifecycle도 검증하고 커밋한다. 실기기 미측정을 통과로 처리하지 않는다.

### Task 5: 인원/거리 LOD·성능 평가·마무리

**Files:** Create `frontend/src/avatar/detail-policy.ts`, `frontend/tests/unit/avatar-detail-policy.test.ts`, `tools/performance/avatar-workloads.mjs`, `docs/reports/avatar-evaluation.html`; Modify `avatar/resources.ts`, `avatar/motion.ts`, `scene/legacy/rendering/render-loop.js`, `tools/performance/README.md`.

**Interfaces:** `avatarDetail({distance,visible,device,quality}): {meshLevel,poseApplyHz,expressionHz}`는 관찰자의 표시 정책이다. 가까운 순서로30/15/5Hz의 초기 관절 보간/적용 단계를 시험하며 head anchor/root 표시 보간은 렌더 주기로 계속한다. 화면 밖에서는 표시용 skeleton/표정 갱신을 중지하되 수신 상태와 공유 자산 수명은 유지한다. 본인 모션/IK 생성 주기는 입력 지연/CPU를 별도로 측정해 정하며 관찰자 수/거리로 IK를 다시 풀지 않는다.

- [ ] 화면 밖 외형/pose 변경→재등장, LOD 전환 hysteresis, 느린 로드 중 퇴장, 공유 자산의 다른 사용자 유지, 반복 SPA 왕복을 실패 테스트로 추가한다.
- [ ] 자기 미리보기, 근거리 상세, 원거리 저폴리/간략 동작, 로드 공유/해제를 통합한다. 방문자마다 매 frame 뼈/손 DOM을 생성하지 않는다.
- [ ] 1/5/10/20/50명,10/30/100m, 같은 모델의 다른 색/서로 다른 모델, image/splat/mixed 공존을 순차 측정한다. FPS/p95, 본인1명의 animation+IK CPU p95와 원격 관절 보간/적용 CPU p95, RAM/GPU memory, draw calls, bytes/s, 서버 fanout을 분리 기록한다. 원격10명 포즈 보간/적용 CPU p95≤2ms는 현재 PC의 초기 목표다. 모든 쌍 중계에서 인원 제곱으로 늘어나는 대역폭과 지연/혼잡을 평가하고 필요할 때만 거리/전달 빈도 제한을 설계한다.
- [ ] 기존 표시/새 프리셋/외형 편집/보행/추적 소실의 스크린샷·짧은 영상과 조건별 수치를 단일 HTML로 정리한다. PC 제한/mock XR/실기기를 구분한다.
- [ ] 전체 suite/build·해당 backend·실제 browser를 검증하고 독립 리뷰 지적을 해소한다. 구현 브랜치에 커밋하며 별도 지시 없이 push/merge/deploy하지 않는다.

## 권장 병렬 분담

먼저 Task1에서 rig와 appearance/pose 계약을 맞춘다. 그 뒤 A: 자산/runtime/IK, B: catalog/profile/Mongo, C: editor/browser QA로 나누고 같은 scene 통합 파일의 편집자는 한 명으로 제한한다. 각 단계에서 별도 담당자가 리뷰하고 마지막에 인원 부하와 HTML을 교차 검증한다.

## 계획의 확인 사항

스타일라이즈드 사람형을 중심으로 하고 임의 모델 업로드와 고급 얼굴 조각은 초기 범위에서 제외하는 제안이다. 사용자가 스타일을 지정하면 자산 선택/프리셋을 조정한다. 연결 가능한 실기기가 없다는 기존 제약은 유지한다.
