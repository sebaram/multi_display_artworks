# 커스터마이즈 가능한 전신 아바타 설계 초안

상태: 2026-10-30 사용자가 개발 진행을 승인했다. 별도 `codex/avatar-customization` 브랜치에서 단계별 구현·검증한다. 실시간 통신은 Socket.IO를 유지하고 포즈 송수신 경계만 분리하여 추후 LiveKit 전환 시 IK/모델/보간을 다시 작성하지 않게 한다. LiveKit SDK·서버 도입은 이번 범위가 아니다.

2026-10-30 리소스 분배 검토 반영: 사람형의 모션/IK는 해당 방문자 본인의 클라이언트에서 한 번 계산하고, 최종 관절 포즈를 서버가 검증·중계한다. 관찰자 클라이언트는 같은 포즈를 보간해 표시한다. 기존 초안의 관찰자별 IK 재계산 제안을 이 방식으로 변경한다. 실시간 최신 상태 보관과 과거 동작 녹화는 구분한다.

## 목표와 현재 상태

접속자가 여러 프리셋을 선택하고 색·얼굴·머리·모자를 바꾸며, 같은 방의 방문자가 같은 외형과 자연스러운 전신 움직임을 볼 수 있게 한다. 데스크톱·모바일·WebXR을 같은 프로필로 지원한다.

현재 확인한 구현:

- `legacy/avatar-catalog.js`: shiba, primitive robot, rigged-simple, none 네 ID. RiggedSimple.glb는 Cylinder/Bone/Bone.001을 가진 테스트 자산이므로 사람형 완제품으로 쓰지 않는다.
- `legacy/avatar-renderer.js`: 모델을 카메라 자식으로 부착한다. 로봇 팔·다리는 고정 도형이고 GLTF의 사용자 색은 작은 별도 표식에만 적용한다.
- `legacy/rendering/scene.js`: 머리 회전이 몸 전체에 적용되고, 손 데이터 변경 때 손 DOM을 다시 만든다. 손은 몸에 연결된 뼈가 아니다.
- `legacy/interaction/hand-tracking.js`: 손목·손끝 일부만 송신하며 별도 immersive session을 요청한다. 렌더링 중인 A-Frame XR session을 공유하는 방식으로 바꿔야 한다.
- 위치는 최대20Hz, 보간 지연100ms이며 pose-buffer에는 머리/손의 동시 보간이 없다. 프로필은 이름·avatarId·color 세 필드, 현재 presence는 메모리, 방문자 식별은 탭 단위다.

## 권장 제품 범위 — 설계자의 제안

1. 첫 제공은 가벼운 스타일라이즈드 사람형을 중심으로 한다. 캐주얼·스포티·탐험가·사람형 로봇 네 외형을 같은 뼈 규격으로 제작한다. 이름·구체적인 아트 스타일은 제안값이다.
2. 기존 강아지/로봇/숨김 ID와 저장 프로필을 유지한다. 기존 모델의 지원 범위는 카탈로그에 표시하며, 얼굴 편집 등이 없는 모델에는 해당 조작을 노출하지 않는다.
3. 사람형은 피부·상의·하의·머리카락·눈 색, 얼굴 프리셋, 헤어 프리셋, 모자/안경/없음을 제공한다. 얼굴은 준비된 눈·눈썹·입 조합으로 시작하며 자유로운 얼굴 조각, 사진 기반 생성은 후속 범위다.
4. `Visitor → 내 아바타`에서 회전/확대 가능한 미리보기를 보고 편집한다. 적용 전에는 다른 방문자에게 공개하지 않고, 적용 후 같은 방에 반영한다. 취소는 현재 외형을 유지한다. 데스크톱·모바일은 React 편집기, immersive XR은 일단 DOM overlay를 전제하지 않는 간단한 월드 패널로 저장 프리셋 선택/되돌리기를 제공한다. 정밀 색·얼굴 편집은 XR 진입 전에 한다.
5. 계정 사용자는 계정별, 익명 방문자는 같은 브라우저별 선호 외형을 MongoDB에 저장한다. 탭별 방문자 신원은 유지한다. 다른 기기의 익명 사용자를 같은 사람으로 연결하지 않는다.

## 모델과 렌더링

추천은 **공통 humanoid rig의 모듈형 GLB + 기존 AFRAME.THREE**다. 외형 프리셋은 같은 몸의 재질·헤어·의상·부착물 구성을 재사용한다. 제품급 사람형 모델/헤어/모자는 새로 확보해야 하며, 현재 저장소에 완성 자산이 있다고 가정하지 않는다.

- 첫 단계에서 재배포 가능한 라이선스/자체 제작 자산을 고르고 출처를 기록한다. 기하·뼈·재질 슬롯·head 부착점·idle/walk 클립 검사를 통과한 하나의 기준 몸부터 확정한다.
- skeleton과 animation mixer는 사용자별로 분리하고 geometry/texture는 참조 계수로 공유한다. 사용자 색을 바꾸는 material만 복제하여 타인의 색이 바뀌지 않게 한다. 단순 Object3D.clone으로 skinned model을 복제하지 않는다.
- 새 instance의 root는 THREE.Object3D다. 기존 `#camera-<visitorId>`는 이름/표정/음성용 head anchor로 남기고 사람형 body root는 별도 노드로 분리한다. 레거시 마스코트는 기존 anchor 어댑터를 사용한다.
- 머리, 흉곽, 골반, 양팔, 양다리는 분리한다. 모자는 head anchor를 따르며 헤어와 모자의 호환 조합/가림 규칙을 자산 manifest에 둔다.
- 얼굴 외형과 순간 표정은 분리한다. 첫 제공은 수동 표정/깜박임이며 기존 표정 이벤트를 연결한다. 웹캠 감지·음성 입 모양은 선택 기능으로 유지/후속 확장한다.
- VRM은 humanoid/표정 규격 참고 및 후속 import 어댑터 후보다. 초기 버전에 외부 아바타 SaaS, 임의 GLB/VRM 업로드, 두 번째 Three 런타임을 도입하지 않는다.

## 입력별 전신 움직임

| 환경 | 관측 입력 | 표시하는 몸 |
|---|---|---|
| 데스크톱/일반 모바일 | 이동 위치·시선 | idle/walk 전환, 독립적인 머리 회전, 자연스러운 기본 팔 자세, 추정 다리 |
| XR 컨트롤러 | HMD + 좌우 grip pose | 손 위치에 양팔 two-bone IK, 몸통/골반 추정, 추정 보행과 발 접지 |
| XR 손 추적 | HMD + 손목, 가능한 손가락 정보 | 손목에 팔 IK, 지원되는 손가락만 추가 적용 |
| 한 손/추적 소실 | 유효한 입력만 | 유효한 쪽 유지, 잃은 팔은 기본 자세로 부드럽게 복귀 |

**다리는 실제 추적 재현이 아니다.** 관측되지 않는 골반·무릎·발 위치는 유일하게 결정되지 않는다. 이동 속도/방향에 따른 보행 애니메이션에 다리 IK/foot lock을 덧대어 바닥을 뚫거나 발이 과하게 미끄러지는 현상을 줄인다. 신경망 전신 추정은 초기 범위에서 제외한다.

- root는 가상 바닥 좌표, head는 관측한 머리 pose다. 카메라의 pitch/roll로 몸 전체를 숙이지 않는다. 몸 yaw는 머리/이동 방향을 제한 범위 안에서 따라간다.
- A-Frame의 기존 XR session/reference space를 재사용한다. 컨트롤러 grip과 포인터 ray를 구분한다. hand joint/local-floor 좌표는 camera rig 이동·회전·텔레포트를 포함해 월드 좌표로 한 번만 변환한다.
- 팔·다리는 two-bone 해석식, 관절 한계와 elbow/knee pole을 적용한다. 도달 불가능한 목표는 팔 길이로 제한하며 NaN/팔 뒤집힘을 허용하지 않는다.
- 첫 접속의 키 맞추기와 앉기/서기 모드를 제공한다. local-floor가 없으면 추정 높이를 사용하고 수동 보정을 허용한다. 키 보정은 센서 설정이며 개인 외형과 분리한다.
- 현재 가상 바닥/이동 경계 안에서 접지한다. 임의 조각상·계단·실제 방의 가구를 자동 인식/충돌 지형으로 취급하지 않는다. 앉기는 선택한 모드의 자세이며 의자 자동 감지는 하지 않는다.
- 본인 클라이언트만 자신의 idle/walk·몸통 추정·팔/다리 IK·foot lock을 계산한다. 자기 몸을 숨겨도 다른 방문자에게 보낼 포즈 생성은 유지한다. 관찰자는 최종 관절 회전을 적용하고 IK/보행을 다시 계산하지 않는다. 같은 rig/체형이면 관찰자별 발 위상·팔꿈치 방향 차이를 줄일 수 있지만 보간 지연/LOD 때문에 표시 시점까지 완전히 같다고 보장하지 않는다.
- 시야에서 벗어나도 최신 관절 pose 수신은 유지한다. 다시 보이면 최신 포즈로 복구한다. 텔레포트는 송신 측의 foot lock/보행 위상과 수신 측 보간 버퍼를 즉시 초기화한다.
- 자기 머리/얼굴은 1인칭 카메라에서 숨기되 편집 미리보기/다른 방문자에게는 표시한다.

## 외형 저장과 실시간 프로토콜

- 서버의 `avatar_catalog.py`를 카탈로그와 허용 조합의 단일 원본으로 두고 `GET /api/v1/avatars/catalog`로 공개한다. 프런트·서버의 하드코딩 목록 분기를 줄인다.
- 외형 `AvatarAppearanceV2`: schemaVersion=2, presetId, colors={skin,top,bottom,hair,eyes}, faceId, hairId, hatId, glassesId. 모든 ID/색은 서버 검증, 정적 자산 경로는 카탈로그에서만 결정한다.
- 기존 displayName/avatarId/color와 v2 appearance를 함께 수용한다. 기존 세 필드는 호환 표시이며 v2 외형의 canonical 값을 따르도록 정규화한다. 알 수 없는 ID는 안전한 프리셋으로 대체한다.
- MongoDB `avatar_profiles`: ownerKey, appearance, revision, updatedAt. ownerKey는 검증된 계정 또는 서버가 서명한 익명 브라우저 키에서 산출하고 공개 presence에는 포함하지 않는다. 별도 익명 쿠키는 HttpOnly/SameSite와 환경별 Secure 정책을 따른다. 실시간 pose를 매 프레임 MongoDB에 쓰지 않으며 웹캠 영상도 저장하지 않는다.
- `GET/PUT /api/v1/me/avatar`와 기존 CSRF 정책을 사용한다. PUT은 expectedRevision으로 충돌을 감지하며 저장 성공 후 적용 프로필을 방송한다. 다른 탭의 현재 방문자 외형은 강제로 덮어쓰지 않는다. 익명 기록은 마지막 저장 후90일 TTL을 제안한다.
- 로그인 전환 정책도 설계자의 제안이다. 입장 시 계정 저장값이 있으면 그것을 사용하고, 없으면 현재 익명 외형을 저장되지 않은 초깃값으로 보여준다. 계정 저장은 명시적으로 적용할 때만 한다. 로그아웃 후에는 익명 브라우저의 이전 저장 외형으로 돌아가며 계정 값을 익명 기록에 복사하지 않는다. 다른 탭에서 로그인 계정이 바뀌면 GET이 발급한 opaque ownerScopeToken을 PUT에서 확인해409로 재불러오기를 요구한다. 현재 편집 내용을 다른 소유자에게 자동 저장하지 않는다. 새 방문자 버튼은 탭 신원을 교체하고 저장된 외형 선호는 유지한다.
- `AvatarInputV2`는 본인 기기 내부의 root/head/left/right targets+tracking status/locomotion 입력이다. 센서 입력 → 모션/IK → `AvatarPoseV2` 생성 순서이며 센서 목표만 보내 관찰자가 다시 IK를 계산하는 구조는 사용하지 않는다.
- 전송하는 `AvatarPoseV2`: version, rigVersion, sequence, sampleTime, root, hipsOffset, boneRotations, tracking, teleport. root는 미터/Y-up 월드 transform(position=[x,y,z], orientation=[x,y,z,w]), hipsOffset은 root 기준 골반 이동, boneRotations는 카탈로그의 고정된 공통 bone 순서에 따른 부모 기준 quaternion 배열이다. 뼈 길이/부착 위치는 rig 자산에서 읽고 모든 관절의 월드 위치/4x4 행렬을 중복 전송하지 않는다. 첫 계약에서 몸통·머리·팔다리 약20~25개 핵심 뼈를 확정하며 손가락은 별도 후속 범위다. 고정된 관절 수와 rigVersion을 서버/클라이언트가 함께 검증한다.
- 본인 표시는 로컬 계산 결과를 즉시 사용해 서버 왕복을 기다리지 않는다. 최종 포즈는 최대20Hz 변경 송신하고 정지는1초 heartbeat다. 매 패킷을 독립적으로 적용 가능한 전체 핵심 관절 스냅샷으로 보내 누락된 delta에 의존하지 않는다. 수신자는 root를 보간하고 bone quaternion을 slerp해 표시하며 gait/IK를 다시 실행하지 않는다. 수신 지연100ms는 초기값이며 실측 조정한다. sampleTime은 송신 스트림의 단조 시간이고 서버 수신 시각과 매핑하여 다른 기기의 절대 시계가 같다고 가정하지 않는다.
- Socket.IO의 binary/TypedArray 경로로 float32 배열을 전달한다. 초기에는 관절 양자화/복잡한 delta codec을 넣지 않고 정확도·대역폭 측정 후 판단한다. 중간 live packet은 연결 불가/혼잡 시 오래된 상태를 쌓지 않게 버리고, join/reconnect/room-state는 최신 전체 스냅샷을 확실히 전달한다. v1 position/rotation/hand의 수신/레거시 대체 표시는 유지하되 구버전 페이지가 새 몸 전체를 표시한다고 보장하지 않는다.
- 서버는 IK·스키닝·렌더링 없이 연결 소유권, 유한 좌표/정규화 회전/관절 수와 크기, rigVersion, sequence와 재연결 세대를 검증한다. v2 pose는 메타데이터와 binary 합계4KiB 상한 및 소켓별20Hz 지속/짧은 burst 한도를 둔다. 외형 저장과 채팅/월 이벤트의 제한은 분리한다. 이 검증은 관측되지 않은 다리 자세가 실제 동작이라는 증명을 뜻하지 않는다.

## 실시간 보관과 녹화·재생의 분리

- 실시간 기본값: 서버 presence 메모리에 방문자별 최신 검증된 전체 포즈와 수신 시각만 유지하고 퇴장 때 해제한다. 늦은 입장/재접속은 이 스냅샷부터 표시한다. 서버는 화면을 재생하는 주체가 아니라 시간 정보가 붙은 데이터를 전달하는 주체다.
- 영구 녹화는 이번 외형/실시간 아바타 범위에 자동 추가하지 않는다. 별도 요청 시 `avatar_recordings` 메타데이터와 시간 구간별 binary 포즈 청크를 MongoDB에 저장하는 방식을 검토한다. 관절/프레임마다 문서를 쓰지 않고, rigVersion·해당 시점 외형/체형·타임라인·키프레임을 함께 보존해 seek와 원래 포즈 재생을 가능하게 한다. 서버는 청크/재생 시간만 공급하고 클라이언트가 보간·표시한다. 녹화 보존 기간과 권한은 그 단계에서 정한다.
- 트레이드오프: 본인 한 명의 모션/IK만 계산하므로 관찰자마다 같은 계산을 반복하는 비용은 줄어든다. 대신 head/hand 목표만 전송할 때보다 네트워크/서버 fanout이 증가한다. 예를 들어24개 quaternion과 root transform/hipsOffset을 float32로 매20Hz 보내면 `((24×4+7+3)×4)×20=8,480bytes/s`이며 메타데이터/Socket.IO/TLS 오버헤드는 별도다. 같은 방 모든 쌍에 중계하면 n명에 대해 약n(n−1)배의 송신 스트림이 생기므로 대규모 방은 전달 거리/빈도 제한을 측정 후 결정한다. 이는 측정치가 아닌 산술 예시다.
- 관찰자는 IK가 없어도 스켈레톤 계층 갱신·스키닝·그리기를 수행한다. 따라서 GPU/인원 비용이 사라지는 것은 아니며 기존 geometry/material 공유와 화면 밖 렌더 중지·LOD는 계속 필요하다. 추후 체형/rig가 달라지면 호환 retargeting과 접지 오차를 별도로 검토한다.

## 성능·자산 예산 — 검증 전 시작값

- 기본 사람형 근거리 모델은20k triangles 이하,70bones 이하, 본체 material2개 이하, 부착물 합계2개 material 이하, 기본 map1024px 이하를 자산 검사 목표로 한다. 발끝/손가락 뼈가 추가되면 예산 안에서 검사한다.
- 본인 IK/애니메이션 품질과 관찰자의 표시 LOD를 분리한다. 본인 포즈 생성 주기는 입력 추종 성능을 측정해 정하되 관찰자가 없다고 센서 수집/기본 포즈를 파괴하지 않는다. 먼 아바타는 저폴리 모델과 관절 보간/적용30/15/5Hz 시작값을 시험하고 root/head anchor는 렌더 주기로 보간한다. 시야 밖에서는 표시용 스켈레톤 갱신을 중지하되 최신 수신 pose/외형은 보존한다. 자산 로딩에는 재방문 유예/공유 캐시와 명시적 해제를 적용한다.
- visible avatars=1/5/10/20/50, 방10/30/100m, gallery image/splat/mixed와 함께 비교한다. 빈 장면과 사람형 표시 전후, 여러 사용자가 같은 프리셋/모두 다른 색인 경우를 구분한다.
- FPS/p95, 본인1명의 animation/IK CPU시간, 원격1/5/10/20/50명의 관절 보간/적용 CPU시간, JS heap/Chrome RAM/GPU전용 메모리, draw calls, 네트워크 bytes/s, 서버 CPU/방송 부하를 나눠 기록한다. 원격10명 근거리 표시에 대한 추가 포즈 보간/적용 CPU p95≤2ms를 현재 PC의 초기 목표로 삼되 실측 후 조정한다. 수신 아바타 증가로 본인 IK 호출 수가 증가하지 않고 서버 IK 호출이0임을 검증한다. GPU 스키닝 비용은 별도 항목이다.
- Quest3 목표 refresh frame budget과 휴대폰 적합성은 실기기에서만 판정한다. 현재 연결 기기가 없으므로 PC 제한/가짜 XR 입력을 실제 기기 합격으로 표기하지 않는다.

## 진행 순서와 완료 기준

1. 기준 사람형 한 개 + 공통 자산 규격/카탈로그/독립 skeleton 수명.
2. 네 프리셋과 외형 편집·MongoDB 저장·같은 방 외형 동기화.
3. 데스크톱/모바일 idle·walk·시선·발 접지. 이것만으로도 동작하는 첫 배포 후보.
4. 기존 XR session에서 HMD/컨트롤러/손 추적을 수집하고 연결된 팔 IK·키 보정·추정 다리를 적용.
5. 거리/가시성 LOD, 동시 방문자 부하와 전후 HTML 보고서. 실기기 검증 전 Quest3 인증은 보류한다.

프리셋/색/얼굴/모자를 바꿔도 타인의 외형이 오염되지 않고, 늦은 입장과 재접속에서 동일한 외형을 보며, 팔/다리가 몸에서 분리되지 않아야 한다. 추적 소실·앉기·텔레포트·방 왕복·편집 취소도 회귀 검증에 포함한다.

## 검토한 대안과 근거

- 프리셋마다 다른 skeleton을 바로 도입하면 의상/IK/모션 유지 비용이 크다. 초기에는 하나의 공통 rig를 권장한다.
- VRM 런타임 전체 도입은 외부 모델 import가 핵심일 때 재검토한다. VRM 자체가 자동으로 IK/의상 fitting/전신 추정을 제공하는 것으로 취급하지 않는다.
- 외부 아바타 서비스는 초기 의존성에서 제외한다. 자체 저장/정적 모델로 기능을 완결한다.
- [WebXR Device API: input/grip space](https://www.w3.org/TR/webxr/#input): 포인터 방향과 손에 쥐는 위치를 구분한다.
- [WebXR Hand Input](https://www.w3.org/TR/webxr-hand-input-1/): 손 관절 입력 규격. 전신/다리 관측을 전제하지 않는다.
- [Three SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html): 사용자별 skeleton 복제와 공유 geometry/material 소유권 설계의 근거.
- [VRM 기능](https://vrm.dev/en/vrm/vrm_features/): humanoid/표정/시선 규격의 후속 호환 후보.
- [Socket.IO emitting events](https://socket.io/docs/v4/emitting-events/): binary/TypedArray 전달과 오래된 위치 패킷을 쌓지 않는 volatile event 경로의 근거.
- [Unity client-side interpolation](https://docs.unity3d.com/Packages/com.unity.netcode.gameobjects@2.6/manual/learn/clientside-interpolation.html): 네트워크 수신 주기와 화면 표시 주기를 분리하는 보간 방식 참고. Unity 의존성을 도입한다는 뜻은 아니다.
- [Three SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html): IK 결과 전달 뒤에도 skeleton으로 정점을 변형하는 표시 비용이 남는 근거.
