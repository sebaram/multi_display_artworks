"""Small loopback API load test against only the owned synthetic performance DB."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import time
from urllib.request import urlopen
from aggregate_results import percentile

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT/'output/playwright/performance'

def main():
    manifest=json.loads((RAW/'workload-manifest.json').read_text(encoding='utf-8'))
    host='http://127.0.0.1:8101'
    def fetch(case):
        start=time.perf_counter()
        with urlopen(host+'/api/v1/rooms/'+case['room_id']+'/scene',timeout=60) as response:
            data=response.read()
            status=response.status
        parsed=json.loads(data)
        actual=sum(len(w['elements']) for w in parsed['walls'])
        assert status==200 and actual==case['element_count'], (status,actual)
        return {'ms':(time.perf_counter()-start)*1000,'status':status,'bytes':len(data)}
    cases=[c for c in manifest['cases'] if c['slug'] in ('images-shared-L30-N100','images-shared-L30-N1000','mixed-L30-N300')]
    results=[]
    targets=json.loads((RAW/'monitor-targets.json').read_text(encoding='utf-8'))
    for case in cases:
        for concurrency in (1,8):
            targets.update(case='api:'+case['slug']+':'+str(concurrency),phase='api')
            (RAW/'monitor-targets.json').write_text(json.dumps(targets),encoding='utf-8')
            fetch(case)
            started=time.time()
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                rows=list(pool.map(lambda _:fetch(case),range(24)))
            elapsed=time.time()-started
            values=sorted(r['ms'] for r in rows)
            result={'slug':case['slug'],'concurrency':concurrency,'requests':len(rows),'started_at':started,
                    'ended_at':time.time(),'wall_seconds':elapsed,'requests_per_second':len(rows)/elapsed,
                    'p50_ms':statistics.median(values),'p95_ms':percentile(values,.95),'max_ms':max(values),
                    'bytes_per_response':rows[0]['bytes'],'statuses':sorted(set(r['status'] for r in rows)),'samples':rows}
            results.append(result)
            print(json.dumps({k:v for k,v in result.items() if k!='samples'}),flush=True)
    (RAW/'api-load.json').write_text(json.dumps({'created_at':datetime.now(timezone.utc).isoformat(),'scope':'loopback HTTP, no production clients; 24requests/case; no WAN/network shaping; new urllib connection per request','cases':results},indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    main()
