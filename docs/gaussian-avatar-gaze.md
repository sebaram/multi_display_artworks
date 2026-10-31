# GaussianAvatars와 절차적 시선 — 개발 상태

브랜치: `codex/gaussian-avatar-gaze`. 실제 눈 추적은 아직 사용하지 않는다. 상대가 추정 시선을 알아채는지, 자연스럽게 느끼는지는 후속 실험의 가설이다.

## 사용할 수 있는 시선 기능

- `/tools/gaze-lab`: 실제 엔진으로 동작하는 도식, 머리/대상 위치와 발화·움직임·상호작용·현저성 입력, 대상 점수 표시.
- `/tools/gaussian-avatar`: 같은 엔진의 출력을 실제 GaussianAvatars 306 머리·상체에 적용한다. 눈 회전, 턱, 표현 계수와 카메라 각도를 조절할 수 있다.
- 방의 Visitor → Customize → 사람 프리셋 → 절차적 시선 실험 → 사용 → Apply: 기존 소유자별 MongoDB 프로필에 설정을 저장한다. 기본적으로 꺼져 있으며 기존 프로필은 그대로 사용할 수 있다.
- `forward`, `nearest`, `weighted` 세 선택 조건. Weighted는 중앙·거리·사람·발화·상호작용·움직임·현저성·새로움 8개 가중치를 사용한다. 없는 신호는 0이다.
- 전체 60°(좌우 30°), 15 m, 최소 응시 600 ms, 최대 응시 4000 ms, 전환 점수 차 0.15, 소실 유예 200 ms, 필터 τ 150 ms, 최대 속도 120°/s, 눈 회전 yaw ±25°/pitch ±15°가 초기값이다. 생리적 최적값을 주장하는 값은 아니다.
- 대상 선택은 10 Hz, 눈 회전 필터는 매 렌더 프레임에 적용된다. 순간이동·긴 프레임 공백·설정 변경은 상태를 초기화한다. 눈은 두 눈에 같은 방향을 적용하며 수렴/실제 눈 추적을 구현했다고 주장하지 않는다.
- 방에서는 원격 머리와 작품의 위치, 기존 발화 표시, 포인터 상호작용, 루트 위치 변화 속도, `data-gaze-salience`를 사용한다. 최대 128개 루트를 훑고 발화/상호작용 대상 우선 및 가까운 순으로 16개에 벽 가림 검사를 한다. 복잡한 작품 메시가 만드는 가림은 아직 검사하지 않는다. 실험실의 수동 입력과 실제 방의 제한된 입력은 구분한다.
- 관찰자에게는 최종 head-local 각도만 전달한다. 기존 Socket.IO의 제한된 최신 포즈 중계를 사용하고, 관절 바이너리는 계속 392바이트다. 서버는 시선을 계산하거나 고빈도 포즈를 DB에 기록하지 않는다. 대상 ID·점수·실험 로그는 전송하지 않는다.

## 실험 기록

실험실에서 ‘새 기록 시작’을 누르면 최대 1200 렌더 프레임을 메모리에 기록한다. 설정 변경 이력과 각 프레임의 머리·대상 입력, 출력 각도, 선택 대상과 점수, 알고리즘 버전 `attention-v1`, 단위, 시드가 JSON에 포함된다. 네이티브 미리보기가 열려 있으면 마지막 적용된 눈·턱·표현 값, 카메라 각도와 모델 리비전도 포함한다. 화면 영상은 기록하지 않는다. 기록을 멈추고 JSON으로 내보낸다. 설정만 별도 내보내기/가져오기도 가능하며 잘못된 설정은 거부한다. 페이지를 떠나면 기록은 사라진다.

이 로그는 절차적 알고리즘의 출력이며 사람의 실제 주의나 시선을 측정한 데이터가 아니다. 참가자 실험에서는 동일 입력에 대한 조건별 재생과 조건 순서 설계가 별도로 필요하다.

## 네이티브 GaussianAvatars 단계

선택한 구현은 [GaussianAvatars](https://github.com/ShenhanQian/GaussianAvatars), 확인한 소스 리비전은 `29b0021308d45c6dce0b522044a4893e189c7a23`이다. 실제 FLAME과 삼각형에 바인딩된 Gaussian 렌더링을 구현했다. 2D 시선 도식과 기존 CC0 사람 프리셋은 이 네이티브 렌더러와 별개다.

사용자가 제공한 `FLAME/FLAME2023.zip`과 `FLAME/FLAME_masks.zip`으로 `FLAME/derived/web`에 로컬 패키지를 만들었다. Open ZIP도 있지만 이번 패키지는 원본 2023을 사용한다. 전체 FLAME 폴더와 파생 데이터는 Git에서 제외했고 프런트엔드 빌드에도 복사하지 않는다.

실제로 연결한 경로:

1. 원본 모델과 masks는 오프라인 export 도구에서 숫자 컨테이너만 허용하는 제한된 로더로 읽는다. 서버에서 pickle 업로드를 실행하지 않는다. [공식 다운로드 지침](https://github.com/ShenhanQian/GaussianAvatars/blob/29b0021308d45c6dce0b522044a4893e189c7a23/doc/download.md) 참고.
2. 공식 subject 306의 `point_cloud.ply`(89,021 Gaussians, 22,434,847 bytes)와 `flame_param.npz`(69,653,560 bytes)를 고정 리비전의 Git blob hash로 확인했다. `binding_0` 삼각형 ID와 Gaussian 순서를 보존한다.
3. identity 300개와 static offset을 template에 반영하고, expression 100개·pose corrective 36개·5개 관절 skinning 및 치아를 보존했다. 결과는 5,143 vertices, 10,144 faces, 약 8.8 MB의 rig다. 눈은 quaternion으로 합성한 뒤 FLAME axis-angle로 변환한다.
4. FLAME을 CPU에서 계산하고 삼각형 변환을 GPU texture로 보내 Spark의 custom source가 Gaussian 중심·회전·scale과 변형 후 위치의 SH를 계산한다. covariance도 다시 계산한다. FLAME의 +Y 위/+Z 정면을 Y축 180° 회전으로 앱의 −Z 정면에 맞춘다.
5. 실험실과 방의 로컬 프리셋에서 실제 브라우저 렌더링을 확인했다. 방의 프리셋은 **머리·상체 모델**이며 팔·다리는 포함하지 않는다. 기존 22관절 포즈의 머리 anchor를 따라간다. 가까운 full 단계에서 네이티브 모델을 표시하고, low 단계는 기존 저해상도 사람 proxy를 사용하며 hidden에서는 FLAME 계산을 멈춘다. 이 모델의 동적 Gaussian LOD는 아직 구현하지 않았다.

방에서는 Visitor → Customize → `GaussianAvatars 306 · Local research bust`로 선택한다. 자동 방문자 기본값에는 이 무거운 프리셋을 넣지 않았다. 같은 방의 네이티브 모델은 SparkRenderer 하나를 공유한다. 모델 기저는 클라이언트 안에서 공유하지만 각 아바타의 Gaussian GPU texture는 별도이므로 대규모 인원 성능은 아직 평가하지 않았다.

새 환경에서의 준비 순서는 다음과 같다. NumPy가 있는 Python을 사용하며 별도 Torch/Scipy 설치는 필요 없다.

```powershell
python tools/avatars/download_gaussian_demo.py
python tools/avatars/export_gaussian_avatar.py
$env:GAUSSIAN_AVATAR_ROOT = (Resolve-Path FLAME/derived/web).Path
```

명시적으로 설정한 개발·테스트 서버의 loopback 접속에서만 manifest/rig/PLY 세 파일을 제공한다. 프로덕션과 외부 호스트에서는 자산 경로가 차단되고 네이티브 프리셋도 노출하지 않는다. 코드 이용 조건은 [라이선스 사본](licenses/GaussianAvatars-LICENSE.md)에 보존했다.

Tailscale에서 볼 때는 앱을 loopback에 유지하고 `tailscale serve --bg --tcp=8000 tcp://127.0.0.1:8000`으로 사설망에 전달한다. `GAUSSIAN_AVATAR_HOSTS`에 해당 장치의 짧은 이름/FQDN/IP를 JSON 배열로 명시하고, `ALLOWED_ORIGINS`에도 해당 HTTP 주소를 추가해야 모델·설정 저장·WebSocket이 동작한다. 기본 허용 호스트는 localhost뿐이며, 추가 호스트도 로컬 전달 연결에서만 모델을 받을 수 있다. 전달 해제는 `tailscale serve --tcp=8000 off`를 사용한다. 인터넷 공개 Funnel은 사용하지 않는다.

[FLAME의 현재 이용 조건](https://flame.is.tue.mpg.de/modellicense.html)은 원본 2023과 CC-BY인 2023 Open을 구분한다. 원본의 로컬 연구 이용과 모델/기저의 공개 배포는 다르다. [공식 안내](https://flame.is.tue.mpg.de/)에 연결된 Open 변환 도구도 두 모델을 모두 요구하므로 바로 대체할 수 있다고 가정하지 않는다. 공개 배포 자산과 subject 데이터의 권한은 실제 배포 전에 확인한다.

## 이번 단계의 짧은 확인

- 엔진: cone/head 좌표계, 가중치·응시 전환, 대상 소실, 속도·필터, 시드, 잘못된 입력 관련 테스트 통과.
- 포즈/프로필: 기존 프로필·392바이트 포즈 유지, 눈만 변할 때 발행, 중립 보간, 잘못된 설정/각도 거부, JS/Python 기본값 일치 테스트 통과.
- 브라우저: 실험실 조건 변경, 로컬 기록 다운로드, 잘못된 설정 거부/정상 설정 복원, MongoDB 설정 저장 및 다른 브라우저 관찰자의 실제 눈 회전 적용 확인. 방 확인에서는 런타임 오류가 없었다. 깨끗한 개발 방에 테스트용 대상 하나를 잠깐 넣고 제거했다.
- 네이티브: 9개 실제 포즈의 모든 vertices가 별도 NumPy 수식 참조와 Float32 반올림 후 일치했다. 원본 PyTorch 구현은 실행하지 않았다. 브라우저에서 실제 Gaussian의 좌우 시선·턱·표현 변형을 확인했다. 방에서 별도 관찰자의 네이티브 표시, Spark 공유, 일반 프리셋 왕복 전환도 확인했다.
- 첫 직접 접속의 404는 FastAPI의 명시적 SPA 경로 목록에 새 경로를 추가해 수정했다.
- 프로덕션 빌드 통과. 전체 회귀·성능 행렬·실기기 검사는 이번 단계에서 하지 않았다. Quest 검사는 배터리 때문에 중단한 상태다. 지각적 자연스러움, 상대가 알아채는지, 본인 촬영 데이터 학습과 공개 배포는 이번 단계에서 검증하지 않았다.
