"""Build one portable comparison report from supplied measurements; no benchmark runs."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / 'output/playwright/render-optimization/comparison.json'
DEFAULT_OUTPUT = ROOT / 'docs/reports/render-optimization.html'
TEMPLATE = Path(__file__).with_name('optimization_report_template.html')
IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}


def build_report(source, target):
    data = json.loads(source.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict):
        raise ValueError('Comparison input must be a JSON object.')
    for key in ('trials', 'checks', 'screenshots'):
        if key in data and not isinstance(data[key], list):
            raise ValueError(f'{key} must be an array.')
        data.setdefault(key, [])
    if not isinstance(data.get('metadata', {}), dict):
        raise ValueError('metadata must be an object.')
    data.setdefault('metadata', {})
    if any(not isinstance(row, dict) for key in ('trials', 'checks', 'screenshots') for row in data[key]):
        raise ValueError('Trials, checks, and screenshots must contain objects.')
    captures = []
    for shot in data['screenshots']:
        capture = {key: value for key, value in shot.items() if key not in ('data_uri', 'embedded_error')}
        path = Path(str(shot.get('path', '')))
        if not shot.get('path'):
            capture['embedded_error'] = '파일 경로가 제공되지 않았습니다.'
        elif not path.is_absolute():
            capture['embedded_error'] = '스크린샷은 절대 파일 경로가 필요합니다.'
        elif path.suffix.lower() not in IMAGE_TYPES:
            capture['embedded_error'] = '지원하는 이미지 형식이 아닙니다.'
        else:
            try:
                content = path.read_bytes()
            except OSError as error:
                capture['embedded_error'] = f'스크린샷을 읽지 못했습니다: {error}'
            else:
                capture['data_uri'] = f'data:{IMAGE_TYPES[path.suffix.lower()]};base64,' + base64.b64encode(content).decode('ascii')
                capture['sha256'] = hashlib.sha256(content).hexdigest()
        captures.append(capture)
    data['screenshots'] = captures
    data['report_artifact'] = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'input_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'aggregation': 'profile + workload + variant; status=ok only; finite numeric values only; median metrics; max repeat p95/p99',
    }
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    encoded = encoded.replace('<', r'\u003c').replace('\u2028', r'\u2028').replace('\u2029', r'\u2029')
    assert json.loads(encoded) == data
    template = TEMPLATE.read_text(encoding='utf-8')
    if template.count('__COMPARISON_DATA__') != 1:
        raise ValueError('Report template must have exactly one data placeholder.')
    document = template.replace('__COMPARISON_DATA__', encoded)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(document, encoding='utf-8')
    return {'html': str(target), 'bytes': target.stat().st_size, 'trials': len(data['trials']), 'screenshots_embedded': sum('data_uri' in shot for shot in captures), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


def self_check():
    scratch = ROOT / 'output/playwright/render-optimization'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='report-selfcheck-', dir=scratch) as folder:
        folder = Path(folder)
        picture = folder / 'capture.png'
        picture.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
        source, target = folder / 'comparison.json', folder / 'report.html'
        dangerous = '</script><script>window.UNSAFE=true</script> 한글 & <태그>\u2028'
        fixture = {'metadata': {'notes': [dangerous]}, 'trials': [
            {'variant': 'baseline', 'profile': 'desktop', 'workload': '정지-장면', 'repeat': 1, 'status': 'ok', 'fps': 30, 'cpu_core_pct': 100, 'buffer': {'width': 800, 'height': 600}, 'p95_ms': 40},
            {'variant': 'baseline', 'profile': 'desktop', 'workload': '정지-장면', 'repeat': 2, 'status': 'ok', 'fps': 50, 'cpu_core_pct': 200, 'buffer': {'width': 800, 'height': 600}, 'p95_ms': 30},
            {'variant': 'optimized-fixed', 'profile': 'desktop', 'workload': '정지-장면', 'repeat': 1, 'status': 'ok', 'fps': 60, 'buffer': {'width': 800, 'height': 600}},
            {'variant': 'optimized-adaptive', 'profile': 'mobile-stress', 'workload': '360-yaw', 'status': 'failed', 'errors': [dangerous]},
        ], 'checks': [{'name': dangerous, 'status': 'unmeasured', 'detail': '미측정'}], 'screenshots': [{'path': str(picture), 'caption': dangerous}, {'path': str(folder / 'missing.jpg')}]}
        source.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
        result = build_report(source, target)
        document = target.read_text(encoding='utf-8')
        embedded = re.search(r'<script id="comparison-data" type="application/json">(.*?)</script>', document, re.S)
        assert embedded, 'Missing embedded data'
        decoded = json.loads(embedded.group(1))
        assert decoded['metadata']['notes'][0] == dangerous, 'Korean or script escaping changed input'
        assert dangerous not in document and r'\u003c/script>' in document, 'Unsafe script boundary'
        assert decoded['trials'][2].get('working_set_mib') is None, 'Missing data must stay missing'
        assert decoded['screenshots'][0]['data_uri'].startswith('data:image/png;base64,')
        assert 'embedded_error' in decoded['screenshots'][1]
        assert result['screenshots_embedded'] == 1 and '__COMPARISON_DATA__' not in document
        assert '외부' in document and '미측정' in document
        print(json.dumps({'self_check': 'pass', 'checks': ['UTF-8 Korean', 'script-boundary escaping', 'missing optional metrics', 'embedded image', 'missing image', 'temporary output only']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=DEFAULT_INPUT)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--self-check', action='store_true', help='Check synthetic input under ignored output; do not write the official report.')
    args = parser.parse_args()
    if args.self_check:
        self_check()
    else:
        print(json.dumps(build_report(args.input.resolve(), args.output.resolve()), ensure_ascii=False))


if __name__ == '__main__':
    main()
