"""Verify the generated offline report against browser-exported data and sources."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'output/playwright/avatar-evaluation'
REPORT = ROOT / 'docs/reports'

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate():
    data = read(REPORT/'avatar-evaluation-results.json')
    exported = read(RAW/'report-export.json')
    assert data == exported, 'Actual browser download differs from machine JSON'
    html = (REPORT/'avatar-evaluation.html').read_text(encoding='utf-8')
    embedded = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S).group(1))
    stripped = {**embedded, 'media':[{k:v for k,v in m.items() if k!='data'} for m in embedded['media']]}
    assert stripped == data, 'Embedded JSON differs from machine JSON'
    assert len(data['render']) == 101 and len(data['groups']) == 74 and len(data['fanout']) == 0
    assert len(data['coverage']['notRunRender'])==47 and len(data['coverage']['notRunFanout'])==10
    assert data['decisions'] == read(ROOT/'tools/performance/avatar-decisions.json')
    assert len([m for m in data['media'] if m['kind']=='video']) == 4
    assert all(m['data'].startswith('data:') for m in embedded['media'])
    for media in data['media']:
        assert digest(ROOT/media['path']) == media['sha256'], media['path']
    for item in data['integrity']:
        assert item['verified'] and digest(ROOT/item['path']) == item['sha256'], item['path']
    frozen = data['provenance']
    for field,path in [('harnessSha256','avatar-workloads.mjs'),('collectorSha256','avatar-measure-case.js')]:
        assert digest(ROOT/'tools/performance'/path) == frozen[field], field
    fields = ['productCommit','frontendCommit','relayCommit','modelSha256','harnessSha256','collectorSha256','bundles']
    for row in data['render']+data['fanout']:
        assert all(row['source'][key] == frozen[key] for key in fields), row['id']
    qa = read(RAW/'report-browser-validation.json')
    assert qa['status']=='ok' and not qa['errors'] and not qa['externalRequests']
    assert not qa['initial']['overflow'] and qa['initial']['rows']==74 and qa['filtered']==2
    assert qa['media']['imageWidth']>0 and qa['media']['video']['advanced'] and not qa['media']['video']['error']
    result = dict(status='PASS_BRIEF_ARTIFACT_CHECK', checks=dict(renderTrials=101,renderConditions=74,fanoutTrials=0,notRunRender=47,notRunFanout=10,
        decisions=len(data['decisions']),media=len(data['media']),videos=4,
        browserExportEqualsMachineJSON=True,embeddedJSONEqualsMachineJSON=True,
        mediaHashes=True,priorReportAndBeforeHashes=True,frozenHarnessCollector=True,
        desktopInitFilterExport=True,sampledImages=1,sampledVideos=1,mobileAndAllMediaQA='NOT_RUN_BY_USER_REQUEST',noExternalRequests=True), browser=qa,
        files={name:digest(REPORT/name) for name in ['avatar-evaluation.html','avatar-evaluation-results.json']},
        source=frozen, deviceChecks=data['deviceChecks'],limits=['Physical phone/Quest performance NOT_RUN; brief functional status separately recorded','Simulated XR is functional only',
        'N50 severe stale-sample age and forced closure are retained, not a realtime/shutdown pass'])
    (REPORT/'avatar-evaluation-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result['checks']))

if __name__=='__main__':
    validate()
