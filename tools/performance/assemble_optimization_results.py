"""Audit and package the final paired trials, retaining excluded iteration evidence."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/playwright/render-optimization'
PRODUCT = 'a941868d85045db9a61537d18fdd0ade2e8eddb3'
SLUGS = ['images-shared-L30-N1000', 'images-unique-L30-N300', 'gltf-L30-N100',
         'gaussian_splat-L30-N8', 'binding-L30-four-walls', 'mixed-L30-N300']


def main():
    raw_file = OUT / 'comparison-raw.jsonl'
    attempts = [json.loads(line) for line in raw_file.read_text(encoding='utf-8').splitlines() if line.strip()]
    latest = {row['id']: row for row in attempts}
    expected = set()
    for repeat in (1, 2):
        for slug in SLUGS + ['gaussian_splat-L30-N8-stationary']:
            for variant in ('baseline', 'optimized-fixed'):
                expected.add(f'{variant}:desktop:{slug}:{repeat}')
        for slug in ['images-unique-L30-N300', 'gaussian_splat-L30-N8', 'binding-L30-four-walls', 'mixed-L30-N300']:
            for variant in ('baseline', 'optimized-adaptive'):
                expected.add(f'{variant}:mobile-stress:{slug}:{repeat}')
        expected.add(f'optimized-adaptive:desktop:binding-L30-four-walls:{repeat}')
    missing = expected - latest.keys()
    if missing:
        raise RuntimeError(f'Missing {len(missing)} final trials: {sorted(missing)}')
    trials = [latest[key] for key in sorted(expected)]
    for row in trials:
        if row['status'] != 'ok':
            raise RuntimeError(f'Invalid final trial {row["id"]}: {row["status"]}')
        if row['variant'] != 'baseline' and row.get('source_commit') != PRODUCT:
            raise RuntimeError(f'Wrong optimized revision: {row["id"]} {row.get("source_commit")}')
        if row['errors'] or row['trace']['webgl_context_lost'] or row['trace'].get('context_losses'):
            raise RuntimeError(f'Browser failure: {row["id"]}')
        if not row.get('cpu_process_sets_equal') or len(row.get('system_samples', [])) < 8:
            raise RuntimeError(f'Incomplete CPU/RAM evidence: {row["id"]}')
        row['camera_path'] = 'fixed view, 5 s settle after yaw warmup' if row['spec']['stationary'] else 'one full 360 degree yaw in 10 s'
        row['pending_residents_at_end'] = len(row['trace'].get('pending_residents', []))
        row['source_commit'] = row.get('source_commit') or '52ee0b4'
    baseline = subprocess.check_output(['git', 'rev-parse', '52ee0b4'], cwd=ROOT, text=True).strip()
    zone = timezone(timedelta(hours=9))
    started = min(row['started_at'] for row in trials)
    ended = max(row['ended_at'] for row in trials)
    interval = f'{datetime.fromtimestamp(started, zone).isoformat()} – {datetime.fromtimestamp(ended, zone).isoformat()}'
    picking = json.loads((OUT / 'picking-validation.json').read_text(encoding='utf-8'))
    if len(picking['results']) != 4 or any(row['status'] != 'pass' or row['errors'] for row in picking['results']):
        raise RuntimeError('Actual canvas picking checks did not all pass')
    e2e = (OUT / 'e2e-progress.log').read_text(encoding='utf-8')
    if '9 passed' not in e2e or ' failed ' in e2e:
        raise RuntimeError('Final browser regression log is incomplete')
    binary_bounds = json.loads((OUT / 'binary-splat-bounds-proof.json').read_text(encoding='utf-8'))
    if (not binary_bounds.get('containsDecodedBounds') or binary_bounds.get('decodedSourceIterations') != 0
            or binary_bounds.get('errors') or binary_bounds.get('meshesAfterRemoval') != 0):
        raise RuntimeError('Binary splat bounds functional proof failed')
    lighting = json.loads((OUT / 'lighting-pixel-proof.json').read_text(encoding='utf-8'))
    if lighting['rgb']['light-original-8101.png'] != lighting['rgb']['light-compensated.png']:
        raise RuntimeError('Legacy ambient brightness proof failed')
    screenshots = []
    single_pass = json.loads((OUT / 'single-pass-validation.json').read_text(encoding='utf-8'))
    if not single_pass['pixel_equal'] or single_pass['draw_calls_after'] >= single_pass['draw_calls_before']:
        raise RuntimeError('Single-pass image regression proof failed')
    for row in trials:
        image = row['spec'].get('screenshot')
        if not image:
            continue
        path = Path(image)
        if not path.is_file():
            raise RuntimeError(f'Missing screenshot {path}')
        screenshots.append({'path': str(path.resolve()), 'variant': row['variant'], 'workload': row['workload'],
                            'caption': f'{row["profile"]} · {row["workload"]} · {row["variant"]} · after timed window; repeat {row["repeat"]}'})
    for capture, label in zip(single_pass['captures'], ['Double-pass diagnostic', 'Single-pass diagnostic']):
        screenshots.append({'path': capture['path'], 'caption': f'{label}: same static image-gallery view; RGB pixels identical; draw calls 197 to 101. This is an isolated flag test, not the original baseline build.', 'workload': 'single-pass-static-proof', 'variant': ''})
    excluded = [row for row in attempts if latest.get(row['id']) is not row]
    def metric(profile, workload, variant, field):
        return median(row[field] for row in trials if row['profile'] == profile
                      and row['workload'] == workload and row['variant'] == variant)
    unique_before = metric('desktop', 'images-unique-L30-N300', 'baseline', 'gpu_dedicated_mib')
    unique_after = metric('desktop', 'images-unique-L30-N300', 'optimized-fixed', 'gpu_dedicated_mib')
    splat_cpu_before = metric('desktop', 'gaussian_splat-L30-N8-stationary', 'baseline', 'cpu_core_pct')
    splat_cpu_after = metric('desktop', 'gaussian_splat-L30-N8-stationary', 'optimized-fixed', 'cpu_core_pct')
    mixed_before = metric('mobile-stress', 'mixed-L30-N300', 'baseline', 'fps')
    mixed_after = metric('mobile-stress', 'mixed-L30-N300', 'optimized-adaptive', 'fps')
    mobile_image_before = metric('mobile-stress', 'images-unique-L30-N300', 'baseline', 'fps')
    mobile_image_after = metric('mobile-stress', 'images-unique-L30-N300', 'optimized-adaptive', 'fps')
    mixed_p95_before = max(row['p95_ms'] for row in trials if row['profile'] == 'mobile-stress' and row['workload'] == 'mixed-L30-N300' and row['variant'] == 'baseline')
    mixed_p95_after = max(row['p95_ms'] for row in trials if row['profile'] == 'mobile-stress' and row['workload'] == 'mixed-L30-N300' and row['variant'] == 'optimized-adaptive')
    wall_before = metric('desktop', 'binding-L30-four-walls', 'baseline', 'fps')
    wall_fixed = metric('desktop', 'binding-L30-four-walls', 'optimized-fixed', 'fps')
    wall_adaptive = metric('desktop', 'binding-L30-four-walls', 'optimized-adaptive', 'fps')
    wall_rendered = metric('desktop', 'binding-L30-four-walls', 'optimized-fixed', 'wall_rendered_mean')
    wall_skipped = metric('desktop', 'binding-L30-four-walls', 'optimized-fixed', 'wall_skipped_mean')
    document = {
        'metadata': {
            'baseline_commit': baseline, 'optimized_commit': PRODUCT, 'measured_at': interval,
            'optimized_source_revisions': sorted({row['source_commit'] for row in trials if row['variant'] != 'baseline'}),
            'host': 'AMD Ryzen 9 5950X (16 cores / 32 threads), 128 GB RAM, NVIDIA RTX PRO 5000 Blackwell 48 GB, Windows',
            'browser': 'Chrome 155.0.8059.85; native NVIDIA ANGLE/D3D11 (each trial records actual GL renderer)',
            'actual_mobile_measured': False, 'actual_quest3_measured': False,
            'attempts_total': len(attempts), 'selected_trials': len(trials), 'excluded_trials': len(excluded),
            'invalid_attempts': sum(row['status'] != 'ok' for row in attempts),
            'evaluation': [
                f'서로 다른 이미지 300개: 데스크톱 GPU 전용 메모리 스냅샷 중앙값 {unique_before:.0f}→{unique_after:.0f} MiB ({(1-unique_after/unique_before)*100:.0f}% 감소). 화면 크기에 따른 이미지 LOD와 상주 제어가 포함됩니다.',
                f'라이브 월 4개: 최적화 고정 모드는 프레임당 평균 {wall_rendered:.2f}개 소스 렌더와 {wall_skipped:.2f}개 생략을 기록했습니다. FPS는 기존 {wall_before:.1f} / 고정 {wall_fixed:.1f} / 적응형 {wall_adaptive:.1f}입니다. 적응형은 해상도 절충을 포함하며, 작업 생략만으로 고정 모드 FPS 향상을 보장하지 않습니다.',
                f'Splat 8개 정지 시점: Chrome+관찰 작업 CPU 중앙값 {splat_cpu_before:.1f}→{splat_cpu_after:.1f} 코어%. 정렬·LOD 갱신 생략 효과가 관찰되지만 순수 앱 CPU 절감률로 환산하지 않습니다. 새 계층·누적 버퍼로 RAM/VRAM이 늘어나는 장면도 있습니다.',
                f'PC 모바일 제한: 이미지 300개 FPS 중앙값 {mobile_image_before:.1f}→{mobile_image_after:.1f}, 혼합 300개 {mixed_before:.1f}→{mixed_after:.1f}입니다. 혼합 장면의 p95 최악 반복은 {mixed_p95_before:.1f}→{mixed_p95_after:.1f} ms입니다. 평균 FPS와 프레임 지연을 함께 읽어야 하며 실제 휴대폰 수치가 아닙니다.',
                '평가: 이미지 메모리와 불필요한 화면 밖 작업을 줄였습니다. Splat 계층·재사용 캐시의 메모리 비용과 자동 품질의 화질 절충이 남습니다. 모든 장면의 FPS 향상을 보장하지 않습니다. 두 반복의 관찰이며 실제 휴대폰·Quest 3 사용 적합성을 인증하지 않습니다.',
            ],
            'notes': [
                '최종 비교는 30 m 방의 6개 콘텐츠 구성, splat 정지 시점, PC 모바일 스트레스와 자동 품질 조절입니다. 이전 59조건 보고서는 별도로 보존합니다.',
                '데스크톱은 1440×900/DPR1, 모바일 스트레스는 390×844/DPR1 및 메인 스레드 4배 제한입니다. 이전 보고서의 DPR2 모바일 항목과 직접 합쳐 계산하지 않습니다.',
                '고정 모드는 품질 제어기를 level0으로 고정합니다. 이미지/splat LOD와 자산 상주 관리는 켜져 있습니다. 같은 버퍼가 같은 시각 품질을 뜻하지 않습니다.',
                '최적화 구성은 이동 중 퇴거·재요청·LOD 전환을 실제로 수행합니다. 측정 끝에 요청 중인 작품이 있을 수 있으며 pending_residents_at_end에 수와 원시 ID를 기록합니다. 완전히 같은 렌더 작업량의 비교가 아닙니다.',
                '자동 품질 조절은 실제 버퍼와 월 소스 해상도를 낮출 수 있습니다. 상세 기록과 각 스크린샷에서 절충을 확인합니다.',
                '최종 최적화 빌드의 데스크톱 실행은 중간 개발 결과를 교체하면서 기존 빌드 실행 뒤에 수행했습니다. 두 반복은 장면 순서를 반대로 했지만 시간 순서의 영향을 완전히 제거하지 못합니다.',
                '기존 빌드도 현재 PC에서 약56–57FPS 부근에 머물 수 있습니다. 그 구간의 FPS 유지가 GPU/CPU 여유가 같다는 뜻은 아닙니다.',
                'Splat의 activeSplats는 정렬 후 활성 수이며, 할당 용량이나 LOD 트리 전체 크기가 아닙니다. 새 계층/누적 버퍼와 작업 스레드로 RAM/VRAM이 증가할 수 있습니다.',
                '화면 비교에서 제거된 legacy 조명의 π 배율을 보정해 기존 밝기를 복원했습니다. 이후 모바일 재방문 시 이미지 재해석 병목을 확인해, 준비된 축소 이미지만 32 MiB 추정 한도의 비활성 LRU로 재사용합니다. 최적화 조건 24회는 이 두 보정을 포함한 같은 최종 제품 커밋입니다.',
                '실제 작품 메시를 커서 선택 대상으로 등록하고, splat용 선택 프록시는 유지했습니다. 이미지/모델의 숨겨진 프록시는 좌표 갱신 대상에서 제외했습니다.',
                'CPU는 CDP 프로세스 시간의 합계입니다. 4배 제한용 Chrome 제어 스레드의 비용도 포함되어 모바일 앱의 실제 CPU 요구량으로 환산할 수 없습니다.',
                '작품 원본의 학습 품질/PSNR·실제 휴대폰·Quest3·발열·배터리·WAN·다수 방문자 부하는 이번 측정 범위에 포함되지 않습니다.',
                '로컬 이미지 요청에서 ERR_NO_BUFFER_SPACE가 발생한 실행은 무효로 남기고 같은 빌드·조건으로 재측정했습니다. 실패 이력은 제외 실행 목록에 보존합니다.',
            ],
        },
        'measurement_protocol': {
            'room_side_m': 30, 'wall_height_m': 6, 'warmup_seconds': 8, 'measure_seconds': 10,
            'stationary_settle_seconds': 5, 'repeats': 2, 'render_fps': 'main scene renderer.render calls only, excluding Spark internal passes; not presented-frame proof',
            'cpu': 'sum CDP per-process cpuTime endpoint deltas / enclosing Performance.Timestamp delta * 100; 1 logical core=100%; endpoint PID sets must match',
            'ram': 'owned Chrome process tree 1Hz sampled peak working set and private commit during the enclosing observation/trace-return window; shared pages may be counted multiple times',
            'gpu_memory': 'sum Windows GPU-process DedicatedUsage snapshot after the timed window and screenshot; not a peak or pure texture memory estimate',
            'quality': 'fixed level0 keeps residency and image/splat LOD enabled; adaptive records actual level, buffer, wall canvas size and selected detail',
            'resource_scope': 'real FastAPI production bundles and procedural Mongo fixtures; cache disabled at HTTP browser layer, OS/driver caches not reset',
            'excluded_development_trials': len(excluded),
        },
        'trials': trials,
        'checks': [
            {'name': '프런트엔드 전체 회귀', 'status': 'pass', 'detail': 'Vitest121 + legacy109 + wall/source76 = 306 tests; TypeScript and production build passed.'},
            {'name': '서버 갤러리·공유 월 계약', 'status': 'pass', 'detail': '49 guarded synthetic-database tests passed; no production database changes.'},
            {'name': '실제 브라우저 회귀', 'status': 'pass', 'detail': '9 tests: source replacement/GL texture and worker release, video, iframe fallback, presence/rejoin, saved locations, repeated SPA lifecycle, shared pointer/play/pause/seek/late join, AR/gesture event relay.'},
            {'name': '실제 캔버스 마우스 선택', 'status': 'pass', 'detail': 'Image1000, glTF100, splat8 and webpage20 scenes: real pointer clicks reached the artwork root; no page errors.'},
            {'name': '이미지의 중복 그리기 제거', 'status': 'pass', 'detail': 'One static 1440×900 image-gallery view: 197 to 101 draw calls with exact RGB screenshot equality after forceSinglePass. Other scenes are not certified pixel-identical.'},
            {'name': '기존 공간의 밝기 유지', 'status': 'pass', 'detail': 'A-Frame removed the legacy PI ambient factor. Compensating the owned room light restored all four sampled wall/floor RGB points exactly in native Chrome. Final comparisons rerun after this fix. This does not certify all PBR materials pixel-identical.'},
            {'name': '이미지 재방문과 캐시 정리', 'status': 'pass', 'detail': '31 resource ownership tests cover reuse, LRU byte limits, oversized/pending/failed/original-image exclusion, active peers, size changes, idempotent release and scene disposal. Inactive displays have a 32 MiB canvas-plus-mip estimate; active displays and driver overhead are additional.'},
            {'name': 'Splat 경계 계산 단축', 'status': 'pass', 'detail': '100k-point functional proof: no decoded per-point traversal, padded raw bounds contain decoded bounds, transforms and cleanup preserved. SwiftShader helper timing is diagnostic only; the native-GPU gallery trials provide FPS evidence. Negative/overflow scales retain unknown bounds through decoded fallback.'},
            {'name': '스테레오·숨김 상태·실패 자원 처리', 'status': 'pass', 'detail': 'Unit regressions cover stereo union and teleported XR rig, hidden canonical playback/pointer state, late canvas resolution, shared textures, singular bounds, canceled/failed model generations and late dependency closure.'},
            {'name': '실제 휴대폰', 'status': 'unmeasured', 'detail': '사용자가 연결 가능한 실기기가 없다고 확인했습니다. PC 스트레스 결과로 대체 판정하지 않습니다.'},
            {'name': '실제 Quest 3', 'status': 'unmeasured', 'detail': 'Immersive stereo performance, actual frame rate, foveation and thermals require the actual headset.'},
        ],
        'screenshots': screenshots, 'picking_validation': picking, 'single_pass_validation': single_pass,
        'binary_splat_bounds_validation': binary_bounds,
        'ambient_lighting_validation': lighting,
        'excluded_iteration_summary': [{'id': row['id'], 'status': row['status'], 'source_commit': row.get('source_commit', '8848d7b development iteration'),
                                        'reason': 'Invalid request/error evidence; retried without changing product' if row['status'] != 'ok' else 'Superseded implementation for this condition; latest valid trial retained',
                                        'errors': row.get('errors'), 'failures': row.get('failures')} for row in excluded],
        'evidence_hashes': {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in
                           ['comparison-raw.jsonl', 'system-samples.jsonl', 'picking-validation.json', 'e2e-progress.log', 'binary-splat-bounds-proof.json', 'single-pass-validation.json', 'lighting-pixel-proof.json']},
    }
    destination = OUT / 'comparison.json'
    destination.write_text(json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    archive = ROOT / 'docs/reports/render-optimization-results.json'
    archive.write_bytes(destination.read_bytes())
    print(json.dumps({'trials': len(trials), 'screenshots': len(screenshots), 'excluded': len(excluded), 'path': str(destination)}))


if __name__ == '__main__':
    main()
