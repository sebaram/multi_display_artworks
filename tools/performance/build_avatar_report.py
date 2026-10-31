"""Build the offline avatar report from immutable raw trials and original media."""
import base64
import hashlib
import json
import statistics
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'output/playwright/avatar-evaluation'
REPORT = ROOT / 'docs/reports'

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def rows(name):
    return [json.loads(line) for line in (RAW/name).read_text(encoding='utf-8').splitlines() if line]

def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None

def maximum(values):
    values = [v for v in values if v is not None]
    return max(values) if values else None

def percentile(values, p):
    import math
    values=sorted(values)
    return values[max(0, math.ceil(len(values)*p)-1)] if values else None

def process_cpu(samples, key='server'):
    if len(samples) < 2:
        return None
    first, last = samples[0], samples[-1]
    old = {p['pid']: p['cpu_seconds'] for p in first.get(key, [])}
    elapsed = last['at']-first['at']
    return sum(max(0,p['cpu_seconds']-old[p['pid']]) for p in last.get(key, []) if p['pid'] in old)/elapsed*100 if elapsed > 0 else None

def resource(row):
    samples=row.get('system_samples',[])
    gpu=row.get('gpu_process_memory',[])
    if not isinstance(gpu,list):
        gpu=[gpu]
    return dict(ram=maximum([sum(p['working_set_bytes'] for p in s.get('browser',[]))/1048576 for s in samples]),
        privateCommit=maximum([sum(p['private_commit_bytes'] for p in s.get('browser',[]))/1048576 for s in samples]),
        gpu=sum(g.get('DedicatedUsage',0) for g in gpu)/1048576 if gpu and not gpu[0].get('unavailable') else None,
        serverCpu=process_cpu(samples))

def build():
    integrity=[]
    for manifest,base in [('prior-report-integrity.json',ROOT),('before-integrity.json',RAW)]:
        for item in read(RAW/manifest):
            path=base/item['path']
            actual=digest(path)
            assert actual.lower()==item['sha256'].lower(), f'Original evidence changed: {path}'
            integrity.append(dict(path=str(path.relative_to(ROOT)),sha256=actual,verified=True))
    all_render=rows('render-raw.jsonl')
    render=[r for r in all_render if r['status']=='ok']
    fanout=rows('fanout-raw.jsonl') if (RAW/'fanout-raw.jsonl').exists() else []
    provenance=read(RAW/'measurement-provenance.json')
    assert render
    frozen_fields = ['productCommit','frontendCommit','relayCommit','modelSha256','harnessSha256','collectorSha256','bundles']
    assert all(all(r['source'].get(k)==provenance.get(k) for k in frozen_fields) for r in render+fanout), 'Mixed product/relay/collector provenance'
    assert len(render)==101 and len(fanout)==0, 'User-authorized partial collection must remain101 render /0 fanout'
    assert all(r['trace']['rosterStable'] for r in render), 'A render window lost its expected humanoid roster'
    assert len({r['id'] for r in render})==len(render), 'Duplicate selected repeat; preserve raw and explicitly choose before assembling.'
    groups={}
    for r in render:
        groups.setdefault(r['id'].rsplit('-r',1)[0],[]).append(r)
    summary=[]
    for name,group in groups.items():
        assert sorted(r['spec']['repeat'] for r in group) in ([1],[1,2]), name
        resources=[resource(r) for r in group]
        row=dict(id=name,spec={k:v for k,v in group[0]['spec'].items() if k not in ['producers','owner']},rawIds=[r['id'] for r in group])
        row['repeatCount']=len(group)
        for key in ['fps','drawCalls','networkInBps','networkOutBps','chromeCpuCorePct','threadCpuCorePct']:
            row[key]=median([r.get(key) for r in group])
        for key in ['p95Ms','ownerP95','poseP95','poseActiveP95','remoteTotalP95','jsHeapMiB']:
            row[key]=maximum([r.get(key) for r in group])
        for key in ['ram','privateCommit','gpu']:
            row[key]=maximum([r.get(key) for r in resources])
        row['serverCpu']=median([r['serverCpu'] for r in resources])
        row['observerArrivalP95']=maximum([percentile(r['network'].get('poseHeaderLatencies',[]),.95) for r in group])
        row['serverArrivalP95']=maximum([percentile(r['network'].get('poseServerArrivalAges',[]),.95) for r in group])
        row['lodRanges']={k:[min(s[k] for r in group for s in r['trace']['samples']),max(s[k] for r in group for s in r['trace']['samples'])] for k in ['full','low','hidden']}
        distances=[a['distance'] for r in group for a in r['trace']['avatars'] if a['distance'] is not None]
        row['distanceRange']=[min(distances),max(distances)] if distances else None
        row['actualSocketParticipants']=group[0]['spec']['n']+1
        row['humanoidCount']=sum(a['humanoid'] for a in group[0]['trace']['avatars'])
        row['nonHumanoidRemotes']=group[0]['spec']['n']-row['humanoidCount']
        row['residentArtworkRange']=[min(r['trace']['residentArtworks'] for r in group),max(r['trace']['residentArtworks'] for r in group)]
        row['connectionFailures']=[dict(id=r['id'],**r['connectionQuality']) for r in group if r['connectionQuality']['connectedAtEnclosingEnd']!=r['spec']['n'] or r['connectionQuality']['beforeTimedWindow'] or r['connectionQuality']['duringTimedWindow'] or r['connectionQuality']['afterTimedWindow']]
        row['networkFreshness']='N/A' if row['observerArrivalP95'] is None else 'OVER_1S' if row['observerArrivalP95']>1000 else 'UNDER_1S'
        row['observerPoseHz']=median([len(r['network'].get('poseHeaderLatencies',[]))/(r['ended_at']-r['started_at']) for r in group])
        summary.append(row)
    network_summary=[]
    for n in [1,5,10,20,50]:
        group=[r for r in fanout if r['actualParticipants']==n]
        if not group:
            continue
        assert len(group)==2
        network_summary.append(dict(n=n,inBps=median([r['inBps'] for r in group]),outBps=median([r['outBps'] for r in group]),latencyP95=maximum([r['latencyP95'] for r in group]),serverCpu=median([process_cpu(r['system_samples']) for r in group]),nodeCpu=median([r['node']['cpuCorePct'] for r in group]),actualSendHz=median([r['network']['actualSent']/(r['ended_at']-r['started_at']) for r in group]),minimumConnected=min(r['network']['connected'] for r in group),deliveryRatio=median([r['network']['receivedCohort']/r['expectedDeliveries'] for r in group if r['expectedDeliveries']]) if n>1 else None))
    media=[]
    # Explicit source revision per asset; no historic image is presented as timed baseline.
    choices=[
      ('before-dog-room.png','이전 · Shiba','3e40065, 원래 마스코트 표시. 수치 성능 baseline 아님.','3e4006535aae9472b88ee0018bbe7787260770ee'),
      ('before-robot-room.png','이전 · 도형 로봇','3e40065, 머리 anchor를 따르는 고정 팔다리.','3e4006535aae9472b88ee0018bbe7787260770ee'),
      ('before-profile-editor.png','이전 · 이름·모델·색 편집','기존 editor 원본 화면 보존.','3e4006535aae9472b88ee0018bbe7787260770ee'),
      ('after-final-editor.png','이후 · 개인 외형 편집','최종 빌드. 개인 preview, 프리셋·부위 색·얼굴·부착물.','final'),
      ('after-final-editor-actions.png','이후 · 부착물과 저장 동작','최종 빌드 editor 내부 스크롤 아래쪽. 모자·안경·적용·취소.','final'),
      ('after-final-editor-mobile.png','이후 · 390px 편집 화면','PC의390px viewport. 실제 휴대폰 테스트 아님.','final'),
      ('after-final-presets.png','이후 · 분리된 방문자','최종 빌드의 공통 rig 프리셋. 이름·머리·발 확인.','final'),
      ('after-lod-near.png','이후 · 숨김 상태에서 최신 외형 복원','최종 빌드 actual Socket.IO actor. 화면 밖 파랑 변경 후 다시 등장.','final'),
      ('desktop-L10-N10-shared-empty-all-joints-r0.jpg','별도 진단 · 근거리10명','22관절·머리 활성 합성 입력. full10/hidden0이며 깊이 행의 몸은 일부 겹칩니다. owner는 desktop idle.','final'),
      ('after-final-walk.mp4','이후 · 보행','최종 빌드. 합성 입력을 사용한 실제 앱 보행. 추정 다리.','final'),
      ('task5-final-simulated-xr-standing-tracked.png','최종 빌드 · XR 입력 시뮬레이션','가상 HMD/grip 입력, 실제 renderer+pose relay. 실기기 아님.','final'),
      ('task5-final-simulated-xr-tracking-loss.png','최종 빌드 · 추적 소실','가상 입력 손실 후 rest blend. 실제 추적 장치 검증 아님.','final'),
      ('task5-final-simulated-xr-recovered.png','최종 빌드 · 추적 복귀','가상 손목 입력이 복구된 뒤 같은 rig와 relay로 복귀. 실기기 아님.','final'),
      ('task5-final-simulated-xr-seated.png','최종 빌드 · 앉기','추정 골반/다리와 가상 바닥. 실제 의자 충돌 없음.','final'),
      ('task5-final-simulated-xr-observer.mp4','최종 빌드 · XR 동작 영상','SIMULATED XR · 연결된 팔, 추적 소실/복귀, 앉기.','final'),
      ('before-robot.mp4','이전 · 움직임 영상','원본3e40065 WebM의 로컬 MP4 변환, 수치 baseline 아님.','3e4006535aae9472b88ee0018bbe7787260770ee'),
      ('task4-simulated-xr-observer.mp4','Task4 · 원래 XR 기능 증거','이전 단계 원본 영상. SIMULATED XR, 최종 LOD 측정 아님.','c4f3c19'),
      ('../avatar-task2-desktop-fixed.png','Task2 · 확정된 editor UI','당시 수정이 끝난 외형 편집 화면. 최종 LOD 측정 아님.','98f914f'),
      ('../avatar-task3-walking.png','Task3 · 전신 보행 증거','당시 clean room 보행 화면. 실제 기기 다리 추적 아님.','a8387b6'),
      ('../avatar-hardware/phone-editor.png','실제 LG V35 · 외형 편집','Android10/Chrome156 실제 휴대폰. Explorer·색#CC3388·calm 얼굴을 UI로 저장하고 재로딩 유지 확인. 성능 측정 아님.','final'),
      ('../avatar-hardware/phone-room-after-touch.png','실제 LG V35 · 터치 이동','Android 기본 터치1초로 약1.5m 이동. 페이지 오류0/가로 넘침 없음. FPS·발열 검증은 미실행.','final'),
      ('../avatar-hardware/desktop-sees-phone.png','실제 PC 관찰자 · 휴대폰 동기화','휴대폰의 외형·재질색과 약1.5m 위치를 수신. 관찰자 위치는 보이도록 스크립트로 배치했으며 데스크톱 입력 테스트가 아님.','final'),
    ]
    for file,title,caption,commit in choices:
        path=RAW/file
        assert path.exists(), f'Missing required media: {path}'
        kind='video' if path.suffix=='.mp4' else 'image'
        mime='video/mp4' if kind=='video' else 'image/jpeg' if path.suffix=='.jpg' else 'image/png'
        media.append(dict(path=str(path.relative_to(ROOT)),title=title,caption=caption,kind=kind,sourceCommit=provenance['frontendCommit'] if commit=='final' else commit,relayCommit=provenance['relayCommit'] if commit=='final' else None,sha256=digest(path),bytes=path.stat().st_size,data=f'data:{mime};base64,'+base64.b64encode(path.read_bytes()).decode()))
    decisions=read(ROOT/'tools/performance/avatar-decisions.json')
    validation=read(RAW/'validation-summary.json')
    near=[r for r in summary if r['spec']['profile']=='desktop' and r['spec']['size']==10 and r['spec']['models']=='shared' and r['spec']['n']==10]
    target=near[0]['poseActiveP95']
    assert near[0]['lodRanges']['full']==[10,10] and near[0]['lodRanges']['hidden']==[0,0], 'Near10 target must represent ten visible full humanoids'
    superseded_file=RAW/'superseded-244a1ce/render-raw.jsonl'
    superseded=[json.loads(line) for line in superseded_file.read_text(encoding='utf-8').splitlines() if line] if superseded_file.exists() else []
    diagnostics={name:read(RAW/name) for name in ['dry-N50-disconnected.json','dry-N50-connected.json'] if (RAW/name).exists()}
    diagnostics['cleanup']=read(RAW/'cleanup-diagnostic.json')
    diagnostics['initialCleanupTransportClose']=read(RAW/'cleanup-initial-transportclose.json')
    diagnostics['perCaseCleanup']=rows('transport-cleanup.jsonl')
    diagnostics['relaySoak']=read(RAW/'relay-soak.json')
    diagnostics['activeJoints']=read(RAW/'active-joints-diagnostic.json')
    assert diagnostics['activeJoints']['status']=='ok'
    assert all(s['full']==10 and s['hidden']==0 for s in diagnostics['activeJoints']['trace']['samples'])
    diagnostics['transportNegotiation']={'status':'NOT_RUN','reason':'User stopped additional evaluation; no compression probe was run.'}
    assert all(diagnostics['relaySoak']['source'].get(k)==provenance.get(k) for k in frozen_fields)
    diagnostics['oldRelayTrials']={'reason':'All five old-relay windows are superseded after reproduced pending-disconnect lock cycles and unbounded v2 relay work were corrected. Frontend341f600 unchanged; backend source differs. No FPS-based selection.', 'trials':rows('superseded-341f600-relay/render-raw.jsonl')}
    diagnostics['preIngressGuardTrials']={'reason':'All20 completed6a5a8d4 trials and its65s soak are superseded solely because incoming guard888 changed the measured backend source, not FPS or latency. An unfinished L100N1 condition is NOT_MEASURED. Mixed/legacy N50 forced closures remain separate from pure-v2 soak behavior.', 'trials':rows('superseded-6a5a8d4-relay/render-raw.jsonl'),'soak':read(RAW/'superseded-6a5a8d4-relay/relay-soak.json'),'manifest':read(RAW/'superseded-6a5a8d4-relay/archive-manifest.json')}
    diagnostics['preRetainedSocketHandles']={'reason':'All20 first888-source trials,65s soak and active-joint diagnostic superseded together for uniform actual-closure instrumentation. Native Engine.IO clears transport.ws; late lookup lost37 handles. The mixed50 postwindow1011 disconnects are an actual capacity failure; not explained away by bookkeeping. No FPS selection.', 'trials':rows('superseded-7b1aa30-cleanup-handles/render-raw.jsonl'),'soak':read(RAW/'superseded-7b1aa30-cleanup-handles/relay-soak.json'),'active':read(RAW/'superseded-7b1aa30-cleanup-handles/active-joints-diagnostic.json'),'cleanup':rows('superseded-7b1aa30-cleanup-handles/transport-cleanup.jsonl'),'manifest':read(RAW/'superseded-7b1aa30-cleanup-handles/archive-manifest.json'),'postAbortQuiescence':read(RAW/'superseded-7b1aa30-cleanup-handles/post-abort-quiescence.json')}
    diagnostics['quiescence']=rows('quiescence.jsonl')
    diagnostics['provisionalBeforeCleanup']={'reason':'All provisional rows excluded before uniform instrumentation and verified transport-close/empty-roster isolation; includes the ERR_NO_BUFFER_SPACE failed attempt. No FPS-based selection.', 'trials':rows('provisional-before-cleanup/render-raw.jsonl')}
    source_archive={name:dict(sha256=digest(RAW/name),source=(RAW/name).read_text(encoding='utf-8')) for name in ['render-harness-frozen.mjs','superseded-341f600-relay/render-harness-graceful-only.mjs','render-collector-frozen.js']}
    soak=diagnostics['relaySoak']
    soak50=next(r for r in soak['cases'] if r['spec']['n']==50)
    soak_samples=[s for s in soak['systemSamples'] if soak50['started_at']<=s['at']<=soak50['ended_at']]
    soak_age=percentile(soak50['network']['poseHeaderLatencies'],.95)
    soak_server_age=percentile(soak50['network']['poseServerArrivalAges'],.95)
    soak_rate=len(soak50['network']['poseHeaderLatencies'])/(soak50['ended_at']-soak50['started_at'])
    soak_close=next(c for c in soak['closures'] if c['n']==50)
    soak_private=maximum([sum(p['private_commit_bytes'] for p in s['server'])/1048576 for s in soak_samples])
    soak_findings=f'<h3>50 remote + 관찰자 지속 시험</h3><p>{soak50["ended_at"]-soak50["started_at"]:.2f}초 동안 연결50개와 모든 rig를 유지했고, FPS는 {soak50["fps"]:.1f}였습니다. 이후50개 소켓은 {soak_close["elapsedMs"]/1000:.3f}초에 정상 종료했고 강제 종료는 {sum(s["forced"] for s in soak_close["states"])}개였습니다. 공개 명단이 비고 서버가 유휴 상태가 된 뒤 N1 후속 시험도 통과했습니다. 서버 private commit 최대 {soak_private:.1f}MiB, 서버 CPU {process_cpu(soak_samples):.1f}%1core, 생성기 CPU {soak50["nodeWindow"]["cpuCorePct"]:.1f}%1core였습니다.</p><p><strong>낮은 지연의50명 동작을 입증한 결과는 아닙니다.</strong> 관찰자 pose 도착 p95는 {soak_age:.0f}ms, 수신 pose header는 전체 {soak_rate:.1f}/s였습니다. 생성기 송신과 관찰자 수신은 서로 다른 관측 구간이므로 두 값을 단순 전달률로 나누지 않습니다. 혼잡 시 최신 pose를 합치는 서버의 유한 작업량과 화면 FPS 유지가20Hz의 신선한 동작 전달을 보장하지 않습니다. 향후 낮은 지연이 필요하면 거리별 관심 대상·송신/전달 빈도·packed snapshot/배치 전송을 별도 설계하고 재측정해야 합니다. LiveKit 어댑터만 교체해 자동으로 해결되는 문제로 보지 않습니다.</p><p>구 relay의40–45초 연결 소실, 종료 지연 및 약4GiB private commit 관측은 원본 진단으로 남겼습니다. 새 시험은 재시작한 서버와 다른 관측 구간이므로 메모리 배수 개선의 통제 실험으로 해석하지 않습니다. 독립적으로 재현한 해제 중 잠금 순환과 무제한 pose 대기 작업을 수정했으며, 구 증상 전부의 단일 원인이라고 단정하지 않습니다.</p>'
    result=dict(formatVersion=1,generatedAt=datetime.now(timezone.utc).isoformat(),provenance=provenance,hardware=read(RAW/'timed-host-hardware.json'),functionalEvidence=dict(features=read(RAW/'final-feature-capture.json'),simulatedXR=read(RAW/'final-xr-measurements.json')),diagnosticDryRuns=diagnostics,integrity=integrity,render=render,excludedRender=[r for r in all_render if r['status']!='ok'],superseded=dict(reason='244a1ce trials superseded after once-only teleport/generation coherence and bounded snapshot parser corrections. N20 readiness timed out before measurement; not a numeric trial.',trials=superseded),fanout=fanout,groups=summary,fanoutGroups=network_summary,media=media,decisions=decisions,
      sourceArchive=source_archive,selectionCriteria='All successful r1/r2 frozen-source render trials, opposite order; no FPS-based cherry-picking. High arrival age is retained, not grounds to discard a valid render window. OVER_1S means measured observer arrival p95>1000ms, a descriptive report warning, not a product SLA; UNDER_1S is not a realtime certification. Dry runs excluded. Invalid trials retained separately; no old revision numerical baseline.',
      method='<p>각 조건은 실제 모델·작품 준비 후 2초 yaw warmup, 정면 1초 안정화, 6초 측정입니다. 두 번째 반복은 반대 순서입니다. 관찰자 카메라는 방 크기의 0.45L에 있으며 원격은 정면 0.35–0.45L 거리에 배열합니다. 깊이별 행에서 몸이 일부 겹치므로 full10은 frustum/LOD 기준이며10개 몸이 모두 분리된 fill-rate 최악 조건을 뜻하지 않습니다. 방 크기와 거리 LOD가 함께 변하므로 FPS 차이를 방 크기만의 효과로 해석하지 않습니다. 모든 조건은 기존 품질 컨트롤러 level0을 고정하고 device 정책과 거리·가시성 LOD를 유지합니다.</p><p>Chrome의 합산 working set은 공유 페이지를 중복 계산할 수 있습니다. private commit은 물리 RAM이 아닙니다. GPU 값은 측정 이후 Windows GPU-process dedicated usage snapshot이며(첫 반복은 스크린샷 뒤, 둘째 반복은 캡처 없이) 아바타만의 VRAM 또는 측정 중 peak가 아닙니다. ThreadTime 및 process CPU는 CPU1core=100%로 정규화합니다. 4x는 main-thread 지연만 적용하며 GPU·worker·디코더·메모리·열은 PC 그대로입니다. Windows Chrome 전체 CPU에는 감속 스레드의 인위적 비용도 포함되므로390px4x의 전체CPU를 데스크톱과 직접 비교해 앱 요구량으로 해석하지 않습니다. 실제 main-thread ThreadTime과 같은 조건의 결과를 함께 봅니다. VSync/display pacing의 영향과 짧은1–2회 표본의 변동이 있으므로 통계적 신뢰구간이나 실기기 인증으로 해석하지 않습니다.</p>',
      validation=validation['html'],findings=f'<h3>근거리 10명 초기 목표</h3><p>현재 PC의 원격 관절 보간·적용 active-frame p95는 {target:.3f}ms입니다. 초기 ≤2ms 목표: {"충족" if target<=2 else "미충족"}. owner 한 명의 모션/IK는 원격 수·거리에 의해 다시 실행되지 않습니다. 전체 화면 FPS는 스키닝·그리기·작품·Socket.IO 비용을 함께 포함합니다. 대규모 relay 결과에는 단일 Node 생성기 비용도 있으므로 이 결과만으로 서버 거리 필터를 도입하지 않았습니다.</p>')
    soak_findings=soak_findings.replace('초에 정상 종료했고 강제 종료는','초에 실제 CLOSED/close event를 확인했고 강제 종료는')
    if any(s['forced'] for s in soak_close['states']):
        soak_findings+='<p><strong>50명 정상 종료는 실패했습니다.</strong> 5초 grace 이후 소유한 생성기 WebSocket만 강제 종료한 결과입니다. 이후 빈 명단·서버 유휴 상태는 다음 조건의 격리를 검증하며 일반 앱의 graceful shutdown이 건강하다는 증거가 아닙니다.</p>'
    result['findings']+=soak_findings
    active=diagnostics['activeJoints']
    result['findings']+=f'<h3>입력·가시성 범위</h3><p>주 행렬의 근거리10명은 보존된1회 측정의 모든 샘플에서 full10 / low0 / hidden0입니다. 합성 입력은 네 팔다리 관절을 회전시키며 머리와 root는 고정입니다. 본인1명의 owner 값은 yaw warmup 뒤 desktop idle의 모션/IK 비용이며, 걷기나 추적 팔의 최악 비용을 의미하지 않습니다. 별도1회22관절·머리 활성 진단 역시 full10 / hidden0이며 remote active p95 {active["poseActiveP95"]:.3f}ms, owner idle p95 {active["ownerP95"]:.3f}ms였습니다. 이 진단은148행렬 반복에 섞지 않았습니다.</p><p>65초 시험에서 producer sampleTime→CDP callback p95는 {soak_age:.0f}ms, serverTime→CDP callback p95는 {soak_server_age:.0f}ms입니다. 전자는 송신 전/서버 입력 대기까지 포함하며 후자는 서버가 수락한 시각 이후 나이입니다. 두 값 모두 관찰/생성기 스케줄링을 포함하고 별도100ms 시각 보간 버퍼를 포함하지 않습니다.</p>'
    result['method']+='<p>범례: shared는 Casual 프리셋의 같은 GLB에 다른 top 색, mixed-models는 사람형/도형 로봇/Shiba/RiggedSimple입니다. 빈방 none(표의 hidden)/legacy-robot/사람형 비교는 같은 최종 빌드의 대조군입니다. none/legacy 대조군은 v1 position_update 경로를 쓰므로 차이에 renderer뿐 아니라 codec/relay 비용도 포함됩니다. 아바타만의 순수 GPU/CPU 비용으로 빼지 않습니다. 구3e40065 이미지는 시각적 비교만 제공하며 구버전 숫자 baseline은 없습니다. 각 행의 N+1 실제 소켓, full/low/hidden 범위와 실제 거리를 함께 확인하십시오. Shared의22개 quaternion 중 기본4개만 변화하며, 별도 진단은22개 모두 변화합니다.</p>'
    result['method']+='<p>측정 뒤 GPU snapshot과 CLI는 비동기 execFile이므로 그 프로세스가 실행되는 시간 전체가 생성기 이벤트 루프를 막지는 않습니다. 다만 누적 sampler파일 readFileSync/JSON.parse와 결과 JSON.stringify/appendFileSync는 동기 작업이며 그 단계별 시간을 별도로 측정하지 않았습니다. 렌더 창 뒤 keepalive1011 소실에는 생성기/클라이언트 스케줄링·수집기 작업의 영향도 있을 수 있습니다. 이는 이 결합 부하·정리 조건의 실패이고 서버만의 용량 원인으로 확정하지 않습니다. 기록된 Node lag/CPU는 앞선 enclosing 구간이며 이후 GPU/정리 단계 전체를 설명하지 않습니다. r1은 측정 뒤 스크린샷을 포함하고 r2는 캡처하지 않으므로 enclosing 구간 길이도 다릅니다. 6초 렌더/관찰자 traffic 창은 별도 동일 절차이며, 서로 다른 enclosing 구간의 연결 유지 결과를 같은 길이의 신뢰성 시험으로 합치지 않습니다.</p>'
    result['captureProvenance']={'frontendCommit':provenance['frontendCommit'],'relayCommit':provenance['relayCommit'],'featureErrors':result['functionalEvidence']['features']['errors'],'simulatedXRErrors':result['functionalEvidence']['simulatedXR']['errors']}
    planned_render=[f'{name}-r{repeat}' for repeat in [1,2] for name in (list(groups) if repeat==1 else reversed(list(groups)))]
    completed_ids={r['id'] for r in render}
    not_run=[dict(id=name,status='NOT_RUN',reason='Explicit user request to stop exhaustive evaluation and do brief connected-device functional checks') for name in planned_render if name not in completed_ids]
    fanout_not_run=[dict(id=f'fanout-N{n}-r{repeat}',status='NOT_RUN',reason='Explicit user scope reduction; no relay-only trial was run') for repeat in [1,2] for n in ([1,5,10,20,50] if repeat==1 else [50,20,10,5,1])]
    assert len(groups)==74 and len(not_run)==47 and len(fanout_not_run)==10
    result['coverage']=dict(status='PARTIAL_BY_USER_REQUEST',plannedRender=148,completedRender=101,notRunRender=not_run,plannedFanout=10,completedFanout=0,notRunFanout=fanout_not_run,completedConditions=74,conditionsWithTwoRepeats=sum(len(g)==2 for g in groups.values()),reason='User requested brief core functional checks on newly connected phone/Quest and stopped further exhaustive validation.')
    result['deviceChecks']=read(RAW/'device-functional-summary.json') if (RAW/'device-functional-summary.json').exists() else {'status':'PENDING_ROOT_EVIDENCE','phone':'Connected; functional check pending','quest':'Connected; functional check pending','performance':'NOT_RUN'}
    result['selectionCriteria']='All101 completed frozen-source render rows are retained without FPS-based selection. All74 conditions have r1;27 have r2. User stopped the sweep after actual closure/empty-idle verification. Remaining47render and10fanout are explicitly NOT_RUN; no values are invented. Superseded archives remain diagnostic. High latency and postwindow disconnects remain visible.'
    result['method']+='<p><strong>사용자 요청에 따른 부분 수집:</strong> 전체 반복 검증을 줄이고 새로 연결한 기기의 핵심 동작만 확인하도록 범위가 바뀌었습니다. 74조건의 첫 반복과27조건의 두 번째 반복, 총101행을 보존했습니다. 나머지47렌더 반복과10중계 전용 시험은 NOT_RUN입니다. 두 반복이 있는 행만 FPS 중앙값/p95 큰 값을 쓰며, 한 반복인 행은 그 값 자체입니다. 순서를 거꾸로 한 반복이 모든 조건에 완료된 것은 아닙니다.</p>'
    result['userStopEvidence']={'stop':read(RAW/'user-requested-stop.json'),'quiescence':read(RAW/'user-stop-quiescence.json'),'ownedHelpers':read(RAW/'user-stop-owned-helpers.json')}
    result['notRunHtml']='<p>사용자의 명시적 범위 축소로 미실행했습니다. 수치0이나 성공으로 취급하지 않습니다.</p><ul>'+''.join(f'<li>{r["id"]}: NOT_RUN</li>' for r in not_run+fanout_not_run)+'</ul>'
    forced=[(r['id'],sum(s['forced'] for s in r['states'])) for r in diagnostics['perCaseCleanup'] if any(s['forced'] for s in r['states'])]
    preclosed=[(r['id'],sum(s.get('closedBeforeRequested',False) for s in r['states'])) for r in diagnostics['perCaseCleanup'] if any(s.get('closedBeforeRequested',False) for s in r['states'])]
    result['diagnosticsHtml']='<p>모든 과거 자료는 source별 진단으로 보존했습니다. 성공한 FPS만 선택하지 않았습니다.</p><ul><li>244a1ce:3초기 행, N20 populated snapshot 준비 실패. teleport/snapshot parser 변경으로 전부 대체.</li><li>provisional-before-cleanup:11성공+ERR_NO_BUFFER_SPACE 준비 실패1건. 동일 종료·격리 수집기로 바꾸기 전에 전체 제외.</li><li>341f600 frontend/구relay:5행, 40–45초 연결 소실·CLOSING/명단 배출 지연·약4GiB private commit 진단. 작은 in-memory 잠금 순환 재현이 모든 live 증상의 원인을 입증하지는 않음.</li><li>6a5a8d4 relay:20행+65초 soak 전체. incoming guard888로 source가 달라져 전체 대체. 시작만 기록된 L100N1은 NOT_MEASURED. 당시 pure-v2 soak 정상 종료와 mixed/legacy N50 forced50은 서로 다른 조건.</li><li>초기888/harness7b1aa30:65초N50 렌더/연결 유지, sample age15초와 forced50은 실패 한계로 보존. 도구 수정 뒤 새65초 결과는 본문에 별도 표시하며, 도구 수정의 지연 개선 효과로 비교하지 않음. 이후 빈명단/유휴/N1은 조건 격리의 증거.</li></ul>'
    result['diagnosticsHtml']+=f'<p>현재 source에서 행렬·별도진단·fanout 종료 기록 {len(diagnostics["perCaseCleanup"])}건 중 강제 종료가 필요한 조건 {len(forced)}건. '+('; '.join(f'{name}: forced{count}' for name,count in forced) if forced else '해당 짧은 조건에서는 forced0.')+'</p><p>65초 soak는 위 집계와 별개입니다. 종료 시간은 관찰자 about:blank 전환 뒤 생성기 disconnect 요청부터 실제 CLOSED/close event까지이며, 전체 종료 준비 시간을 뜻하지 않습니다. 모든 다음 조건은 공개 명단·6초 유휴 검사를 통과해야 시작합니다. 7b1aa30의20번째 mixed50행은 실제6초 렌더 창에는50rig를 유지했지만 이후 준비/캡처/CLI를 포함한 구간에서 keepalive1011 연결 소실이 발생했습니다. 종료 시37개 transport.ws 참조가 이미 null이라 검사가 중단됐습니다. 원본20행과65초/active진단을 전부 보관하고 원래 WebSocket 객체·이벤트를 입장 시 보관하도록 도구만 수정했습니다. 원본 행·소스·아카이브 manifest와 결과는 내보내기 JSON에 포함됩니다.</p>'
    result['diagnosticsHtml']+=f'<p>생성기의 명시적 종료 요청 전에 이미 닫힌 소켓이 있는 조건 {len(preclosed)}건: '+('; '.join(f'{name}: preclosed{count}' for name,count in preclosed) if preclosed else '없음')+'. 이 기록은 강제 종료 수와 다르며, 각 close code·이유·시각을 원본 cleanup history에 보존했습니다. 렌더 결과 표의 enclosing-window 경고 이후 GPU snapshot/관찰자 종료 준비 중 연결이 소실될 수도 있으므로 이 목록을 함께 확인해야 합니다.</p>'
    # JSON retains complete numeric/raw trial evidence; media is referenced by digest to avoid duplicated binary storage.
    datafile=REPORT/'avatar-evaluation-results.json'
    machine={**result,'media':[{k:v for k,v in m.items() if k!='data'} for m in media]}
    datafile.write_text(json.dumps(machine,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    template=(ROOT/'tools/performance/avatar-report-template.html').read_text(encoding='utf-8')
    encoded=json.dumps(result,ensure_ascii=False,separators=(',',':')).replace('</',r'<\/')
    html=template.replace('__DATA__',encoded)
    (REPORT/'avatar-evaluation.html').write_text(html,encoding='utf-8')
    print(json.dumps(dict(renderTrials=len(render),conditions=len(summary),fanoutTrials=len(fanout),media=len(media),htmlBytes=len(html.encode()),jsonBytes=datafile.stat().st_size,productCommit=provenance['productCommit'])))

if __name__=='__main__':
    build()
