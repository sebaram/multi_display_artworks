"""Build a portable HTML report from real, explicitly scoped benchmark results."""
import base64
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import statistics
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'output/playwright/performance'
DEST=ROOT/'docs/reports'
MIB=1024**2

def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def fmt(value,digits=1):
    return f'{value:,.{digits}f}' if isinstance(value,(int,float)) else 'N/A'

def main():
    subprocess.run([sys.executable,str(Path(__file__).with_name('aggregate_results.py'))],check=True)
    data=load(DEST/'performance-results.json')
    data['cases']=[r for r in data['cases'] if r['profile_mode']!='soak']
    data['extras']={}
    parts=['<p class="note">측정 흐름은 관람객의 방 입장·회전·SPA 이동입니다. 월 스튜디오 편집, AI 추론, 활성 음성채팅·카메라, 다수 방문자의 실시간 입력 부하는 포함하지 않았습니다. draw calls·삼각형·텍스처 개수는 30 RAF마다 수집한 표본이며, GPU 질의는 12회 렌더마다 수집한 표본입니다. 프레임 간격은 인접 RAF 전체에서 수집했습니다. 표본 최대를 모든 프레임의 절대 최대로 해석하지 않습니다.</p>']
    if (RAW/'cpu-calibration.json').exists():
        calibration=load(RAW/'cpu-calibration.json');data['extras']['cpu_calibration']=calibration
        parts.append(f'<h3>CPU 감속 설정 확인</h3><p>실제 빈 전시 페이지로 이동한 뒤 동일 정수 연산을 1×/4×에서 번갈아 두 번씩 실행했습니다. 4×의 경과시간 비율은 <strong>{fmt(calibration["slowdown_ratio"],2)}배</strong>, 계산 결과 일치는 {"확인" if calibration["checksums_match"] else "불일치"}했습니다. 특정 휴대폰의 성능에 맞춘 보정은 아닙니다.</p>')
    if (RAW/'instrumentation-check.json').exists():
        comparison=load(RAW/'instrumentation-check.json');data['extras']['instrumentation']=comparison
        on=[r['fps'] for r in comparison['trials'] if r['timers']];off=[r['fps'] for r in comparison['trials'] if not r['timers']]
        parts.append(f'<h3>선택 GPU 질의 켜기/끄기 대조</h3><p>같은 라이브 월 4개를 새 브라우저에서 5초 준비·8초 측정으로 켜기/끄기/끄기/켜기 순서로 실행했습니다. 질의 켬 {fmt(min(on))}–{fmt(max(on))} FPS, 질의 끔 {fmt(min(off))}–{fmt(max(off))} FPS였습니다. 질의를 꺼도 프레임 저하가 관측됐습니다. 단일 장면·짧은 2회씩의 대조이며 실행 변동과 모든 계측 비용을 정밀 분리하지 않았으므로, 전체 표의 FPS를 보정하거나 음의 오버헤드로 해석하지 않았습니다.</p>')
    if (RAW/'api-load.json').exists():
        api=load(RAW/'api-load.json');data['extras']['api']=api
        rows=''.join(f'<tr><th>{html.escape(r["slug"])}</th><td>{r["concurrency"]}</td><td>{r["requests"]}</td><td>{fmt(r["p50_ms"])}</td><td>{fmt(r["p95_ms"])}</td><td>{fmt(r["requests_per_second"],2)}</td><td>{fmt(r["bytes_per_response"]/MIB,2)}</td><td>{html.escape(str(r["statuses"]))}</td></tr>' for r in api['cases'])
        parts.append('<h3>장면 API · 로컬 동시 요청</h3><p>공개 scene API에 조건당 24회, 동시 요청 1개/8개를 보냈습니다. 각 응답의 요소 수와 상태 코드를 확인했습니다. 새 로컬 HTTP 연결이며 WAN·실시간 방문자·음성 부하 시험과는 다릅니다.</p><div class="table-wrap"><table><thead><tr><th>장면</th><th>동시</th><th>요청</th><th>p50 ms</th><th>p95 ms</th><th>요청/초</th><th>응답 MiB</th><th>HTTP</th></tr></thead><tbody>'+rows+'</tbody></table></div>')
    if (RAW/'lifecycle.json').exists():
        lifecycle=load(RAW/'lifecycle.json');data['extras']['lifecycle']=lifecycle
        clean=all(r['dom']['scenes']==0 and r['dom']['design_canvases']==0 and r['dom']['video_count']==0 for r in lifecycle['rows'])
        heaps=[r['metrics']['JSHeapUsedSize']/MIB for r in lifecycle['rows']]
        growth=heaps[-1]-heaps[0]
        if growth>1:
            parts.append(f'<aside class="notice"><strong>메모리 점검 필요 · GC 후 힙 증가</strong><p>10회 왕복의 첫 값 {fmt(heaps[0],2)}MiB에서 마지막 {fmt(heaps[-1],2)}MiB로 {fmt(growth,2)}MiB({fmt(growth/heaps[0]*100,1)}%) 증가했습니다. DOM 제거와 메모리 완전 해제는 다른 검증입니다. 캐시·DevTools 영향과 누수 가능성을 분리하는 장시간 반복·힙 스냅샷 분석이 필요하며, 현재 결과로 누수가 없다고 판정하지 않습니다.</p></aside>')
        rows=''.join(f'<tr><td>{r["cycle"]}</td><td>{fmt(r["metrics"]["JSHeapUsedSize"]/MIB,2)}</td><td>{r["dom"]["scenes"]}</td><td>{r["dom"]["design_canvases"]}</td><td>{r["dom"]["video_count"]}</td><td>{r["metrics"]["Documents"]}</td></tr>' for r in lifecycle['rows'])
        parts.append(f'<h3>4개 라이브 월 · SPA 진입/이탈 10회</h3><p>실제 카탈로그 링크로 왕복한 뒤 1초 대기하고 강제 GC를 실행했습니다. 이탈 후 전시 DOM 정리: <strong>{"10회 모두 확인" if clean else "잔존 항목 발견"}</strong>. GC 후 힙 범위 {fmt(min(heaps),2)}–{fmt(max(heaps),2)} MiB, 마지막−첫 번째 {fmt(heaps[-1]-heaps[0],2)} MiB입니다. 이는 잔존 힙 비교이며 장시간 누수가 없다는 증명은 아닙니다.</p><div class="table-wrap"><table><thead><tr><th>왕복</th><th>GC 후 JS 힙 MiB</th><th>전시 scene</th><th>디자인 canvas</th><th>video</th><th>CDP Documents</th></tr></thead><tbody>{rows}</tbody></table></div>')
    soaks=[r for r in data['trials'] if r['profile_mode']=='soak' and r['status']=='ok']
    if soaks:
        soak=soaks[-1]
        windows=soak.get('system_window',[])
        first=windows[:max(1,len(windows)//4)];last=windows[-max(1,len(windows)//4):]
        delta=statistics.median(r['browser_working_set_mib'] for r in last)-statistics.median(r['browser_working_set_mib'] for r in first) if windows else None
        buckets=[];acc=0;frames=0;start=0
        for value in soak['frame_intervals_ms']:
            acc+=value;frames+=1
            if acc-start>=10000:
                buckets.append({'end_seconds':acc/1000,'fps':frames*1000/(acc-start)})
                frames=0;start=acc
        data['extras']['soak']={'trial_id':soak['id'],'duration_ms':soak['elapsed_ms'],'ten_second_windows':buckets,'ram_last_minus_first_quarter_mib':delta}
        parts.append(f'<h3>4개 라이브 월 · 3분 지속 실행</h3><p>다른 장면과 분리해 {fmt(soak["elapsed_ms"]/1000,1)}초를 측정했습니다. 렌더 FPS {fmt(soak["fps"])}, 프레임 간격 p95 {fmt(soak["frame_p95_ms"],2)}ms, p99 {fmt(soak["frame_p99_ms"],2)}ms. GPU 전체 어댑터 최고 온도 {fmt(soak.get("gpu_temp_c_max"),0)}°C, Chrome WS 피크 {fmt(soak.get("browser_working_set_peak_mib"),0)}MiB입니다.</p><p>초반 1/4 대비 후반 1/4의 중앙 RAM 차이는 {fmt(delta,2)}MiB입니다. 10초 구간별 FPS는 {fmt(min(r["fps"] for r in buckets))}–{fmt(max(r["fps"] for r in buckets))}입니다. 이 짧은 PC 관찰로 모바일/Quest의 발열·배터리·장시간 안정성을 판정하지 않습니다.</p>')
    data['measurement_protocol']={'normal':'5s full-yaw warmup +10s measurement,2repeats,ascending/reversed order','soak':'10s warmup+180s measurement,1repeat','cold_scope':'Chrome HTTP cache disabled; OS/driver/media caches not globally reset','gpu_timer':'Only discard_all_pending_v2 and zero disjoint flag metrics published; early optional desktop timer samples excluded; OS GPU utilization/VRAM remain valid','capture':'Screenshots occur after timing, OS dedicated VRAM is a subsequent snapshot; screenshot/compositor caching may be retained','window_clock':'Controlled continuous yaw; GC/CDP collection shifts starting phase slightly; host display pacing variable','no_claim':'No actual phone/Quest GPU,immersive stereo,thermal,battery,TURN/multiplayer/AI benchmark'}
    data['raw_input_hashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [RAW/name for name in ('results.jsonl','system-samples.jsonl','gpu-process-memory.jsonl','workload-manifest.json','api-load.json','cpu-calibration.json','lifecycle.json','instrumentation-check.json')] if p.exists()}
    screenshots=[]
    wanted=[('desktop','images-shared-L30-N1000'),('desktop','images-unique-L30-N300'),('desktop','gaussian_splat-L30-N4'),('desktop','binding-L30-four-walls'),('mobile','images-shared-L30-N1000'),('mobile','binding-L30-four-walls')]
    captions=[]
    for mode,slug in wanted:
        image=RAW/f'scene-{mode}-{slug}.jpg'
        if not image.exists():continue
        row=next((r for r in data['cases'] if r['profile_mode']==mode and r['slug']==slug),None)
        caption=f'{"실제 데스크톱" if mode=="desktop" else "PC의 모바일 조건"} · {slug}'
        detail=f'렌더 FPS {fmt(row.get("fps"))} · 프레임 간격 p95 {fmt(row.get("frame_p95_ms"),2)}ms' if row else '실제 장면 캡처'
        uri='data:image/jpeg;base64,'+base64.b64encode(image.read_bytes()).decode()
        screenshots.append(f'<figure class="capture"><img src="{uri}" alt="{html.escape(caption)}" loading="lazy"><figcaption><b>{html.escape(caption)}</b>{html.escape(detail)} · 측정 구간 종료 후 촬영 · 클릭해 확대</figcaption></figure>')
        captions.append({'file':image.name,'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),'mode':mode,'slug':slug})
    data['report_captures']=captions
    (DEST/'performance-results.json').write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    template=Path(__file__).with_name('report_template.html').read_text(encoding='utf-8')
    encoded=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<',r'\u003c')
    assert json.loads(encoded)==data
    document=template.replace('__REPORT_DATA__',encoded).replace('__CAPTURE_GALLERY__',''.join(screenshots) or '<p>실행 화면을 수집 중입니다.</p>').replace('__EXTRA_TESTS__',''.join(parts) or '<p>추가 시험을 진행 중입니다.</p>')
    def find(mode,slug):
        return next((r for r in data['cases'] if r['profile_mode']==mode and r['slug']==slug),{})
    static=find('desktop','images-shared-L30-N1000')
    live=find('desktop','binding-L30-four-walls')
    mobile=find('mobile','images-shared-L30-N1000')
    summary=f'<aside class="notice" id="evaluation-summary"><strong>평가 요약</strong><ul><li>현재 PC: 공유 이미지 1,000개는 {fmt(static.get("fps"))} FPS로 빈 방 수준의 페이싱을 유지했습니다. 라이브 월 4개는 {fmt(live.get("fps"))} FPS, p95 {fmt(live.get("frame_p95_ms"),2)}ms로 지연이 늘었습니다.</li><li>PC의 모바일 CPU 제한 조건: 이미지 1,000개는 {fmt(mobile.get("fps"))} FPS, p95 {fmt(mobile.get("frame_p95_ms"),2)}ms였습니다. 실제 휴대폰 GPU·RAM·발열의 합격 판정은 아닙니다.</li><li>실제 휴대폰·Quest 3: 미측정. 특히 XR 프레임 루프와 splat 해상도 설정은 헤드셋에서 확인해야 합니다.</li><li>메모리: 10회 진입/이탈 뒤 GC 후 힙이 증가했습니다. 아래 추가 시험에 증가량을 표시하며 누수 없음으로 판정하지 않습니다.</li></ul></aside>'
    document=document.replace('<section id="results"',summary+'<section id="results"',1)
    icon=base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#172b30"/><text x="32" y="46" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#d5e8d9">P</text></svg>').decode()
    document=document.replace('</head>','<link rel="icon" href="data:image/svg+xml;base64,'+icon+'"></head>',1)
    assert '__REPORT_DATA__' not in document and '__CAPTURE_GALLERY__' not in document and '__EXTRA_TESTS__' not in document
    target=DEST/'performance-evaluation.html';target.write_text(document,encoding='utf-8')
    manifest={'created_at':datetime.now(timezone.utc).isoformat(),'html':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'data_sha256':hashlib.sha256((DEST/'performance-results.json').read_bytes()).hexdigest(),'normal_cases':len(data['cases']),'normal_trials':sum(r['profile_mode']!='soak' for r in data['trials']),'soak_trials':len(soaks),'screenshots':captions,'input_hashes':data['raw_input_hashes'],'actual_phone':False,'actual_quest3':False}
    (DEST/'performance-artifact.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest.items() if k not in ('screenshots','input_hashes')},ensure_ascii=False))

if __name__=='__main__':
    main()
