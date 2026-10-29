"""Turn actual browser/CDP/OS samples into explicitly scoped report data."""
import hashlib
import json
import math
from pathlib import Path
import statistics
from collections import defaultdict
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'output/playwright/performance'
DEST = ROOT / 'docs/reports'
MIB = 1024 ** 2

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def lines(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()] if path.exists() else []

def percentile(values, p):
    if not values: return None
    a = sorted(values)
    x = (len(a) - 1) * p
    return a[math.floor(x)] + (a[math.ceil(x)] - a[math.floor(x)]) * (x % 1)

def mean(values):
    a = [v for v in values if v is not None]
    return statistics.mean(a) if a else None

def maximum(values):
    a = [v for v in values if v is not None]
    return max(a) if a else None

def main():
    assert percentile([1, 2, 3, 4], .5) == 2.5
    assert percentile([], .95) is None
    host, browser = read(RAW/'host-hardware.json'), read(RAW/'browser-hardware.json')
    logical = host['logicalProcessors']
    monitor = lines(RAW/'system-samples.jsonl')
    gpu_memory = {row['id']: row for row in lines(RAW/'gpu-process-memory.jsonl')}
    # Resume may leave an earlier failed attempt; retain the latest trial for each ID.
    raw_rows = {r['id']: r for r in lines(RAW/'results.jsonl')}
    rows = []
    for r in raw_rows.values():
        spec, trace = r['spec'], r.get('trace', {})
        row = {k: spec.get(k) for k in ('slug','room_id','room_side_m','room_area_m2','element_count','element_types','profile','profile_mode','repeat','width','height','dpr','cpuRate','model_triangles_total','splat_points_total','image_decoded_rgba_bytes','image_rgba_bytes_with_mipmaps_estimate','videoWallCount','asset_network_bytes_once','unique_asset_count')}
        row.update(id=r['id'],status=r['status'],load_ready_ms=r.get('readiness',{}).get('load_ready_ms'),
                   errors=r.get('errors',[]),request_failures=r.get('failures',[]),error=r.get('error'))
        if not trace:
            rows.append(row)
            continue
        intervals = trace['frame_intervals_ms']
        assert intervals and all(v > 0 for v in intervals), r['id']
        row.update(fps=trace['rendered_frames']*1000/trace['elapsed_ms'],
                   raf_fps=1000/mean(intervals),frames=trace['rendered_frames'],elapsed_ms=trace['elapsed_ms'],
                   frame_p50_ms=percentile(intervals,.5),frame_p95_ms=percentile(intervals,.95),frame_p99_ms=percentile(intervals,.99),
                   one_pct_low_fps=1000/mean(sorted(intervals,reverse=True)[:max(1,math.ceil(len(intervals)*.01))]),
                   over20ms_pct=100*sum(x>20 for x in intervals)/len(intervals),over33ms_pct=100*sum(x>33.333 for x in intervals)/len(intervals),
                   render_submit_p95_ms=percentile(trace['render_submit_cpu_ms'],.95),
                   gpu_main_p95_ms=percentile(trace['gpu_main_scene_ms'],.95) if not trace['gpu_disjoint_samples'] and trace.get('gpu_disjoint_policy')=='discard_all_pending_v2' else None,
                   gpu_timer_validation=trace.get('gpu_disjoint_policy','early-policy-optional-timer-excluded'),
                   gpu_disjoint_policy=trace.get('gpu_disjoint_policy'),
                   gpu_timer_samples=len(trace['gpu_main_scene_ms']),gpu_disjoint_samples=trace['gpu_disjoint_samples'],
                   long_task_count=len(trace['long_tasks']),long_task_total_ms=sum(x['duration'] for x in trace['long_tasks']),
                   drawing_buffer=trace['drawing_buffer'],actual_pixel_ratio=trace['renderer_pixel_ratio'],device_pixel_ratio=trace['device_pixel_ratio'],
                   context_losses=trace['context_losses'],visibility=sorted(set(trace['visibility'])),
                   renderer=trace['renderer'],design_canvas_sizes=trace['design_canvas_sizes'],dom_nodes=trace['dom_nodes'],
                   xr_presenting=trace['xr_presenting'],immersive_vr_supported=trace.get('immersive_vr_supported'),
                   frame_intervals_ms=intervals,gpu_main_samples_ms=trace['gpu_main_scene_ms'])
        before, after = r['before'], r['after']
        seconds = after['Timestamp'] - before['Timestamp']
        assert seconds > 0
        row['main_cpu_core_pct'] = max(0,100*(after['ThreadTime']-before['ThreadTime'])/seconds)
        row['main_task_occupancy_pct'] = max(0,100*(after['TaskDuration']-before['TaskDuration'])/seconds)
        start_cpu = {p['id']:p['cpuTime'] for p in r['processes_before']}
        cpu_seconds = sum(max(0,p['cpuTime']-start_cpu.get(p['id'],0)) for p in r['processes_after'])
        row['browser_cpu_core_pct'] = 100*cpu_seconds/seconds
        row['cpu_basis'] = {'elapsed_seconds':seconds,'browser_cpu_seconds':cpu_seconds,
                            'main_thread_cpu_seconds':after['ThreadTime']-before['ThreadTime'],
                            'main_task_seconds':after['TaskDuration']-before['TaskDuration'],'logical_processors':logical}
        row['browser_cpu_machine_pct'] = row['browser_cpu_core_pct']/logical
        row['js_heap_mib'] = after['JSHeapUsedSize']/MIB
        row['js_heap_start_mib'] = before['JSHeapUsedSize']/MIB
        row['cdp_dom_nodes'] = after['Nodes']
        row['draw_calls_mean'] = mean([s['calls'] for s in trace['draw_samples']])
        row['draw_calls_max'] = maximum([s['calls'] for s in trace['draw_samples']])
        row['triangles_max'] = maximum([s['triangles'] for s in trace['draw_samples']])
        row['geometry_count'] = trace['final_memory_counts']['geometries']
        row['texture_count'] = trace['final_memory_counts']['textures']
        # Align whole-system snapshots to the actual 10-second measurement window.
        samples = [s for s in monitor if r['started_at'] <= s['at'] <= r['ended_at'] and s.get('case') == r['id']]
        row['os_samples'] = len(samples)
        row['system_window'] = [{**{k:s.get(k) for k in ('at','gpu_util_pct','gpu_memory_mib','gpu_temp_c','gpu_power_w','gpu_decoder_pct')},
                                'browser_working_set_mib':sum(p['working_set_bytes'] for p in s.get('browser',[]))/MIB,
                                'browser_private_commit_mib':sum(p['private_commit_bytes'] for p in s.get('browser',[]))/MIB,
                                'server_working_set_mib':sum(p['working_set_bytes'] for p in s.get('server',[]))/MIB} for s in samples]
        for key in ('gpu_util_pct','gpu_memory_mib','gpu_temp_c','gpu_power_w','gpu_decoder_pct'):
            row[key+'_mean'] = mean([s.get(key) for s in samples])
            row[key+'_max'] = maximum([s.get(key) for s in samples])
        for label in ('browser','server'):
            resident = [sum(p['working_set_bytes'] for p in s.get(label,[]))/MIB for s in samples if s.get(label)]
            commit = [sum(p['private_commit_bytes'] for p in s.get(label,[]))/MIB for s in samples if s.get(label)]
            row[label+'_working_set_peak_mib'] = maximum(resident)
            row[label+'_private_commit_peak_mib'] = maximum(commit)
            row[label+'_working_set_mean_mib'] = mean(resident)
        snap = gpu_memory.get(r['id'],{}).get('snapshot',[])
        snap = snap if isinstance(snap,list) else [snap] if snap else []
        row['gpu_process_dedicated_mib'] = sum(x['DedicatedUsage'] for x in snap)/MIB if snap else None
        row['gpu_process_shared_mib'] = sum(x['SharedUsage'] for x in snap)/MIB if snap else None
        row['gpu_memory_snapshot_bytes'] = snap
        row['video_frames'] = []
        for i,video in enumerate(trace['videos']):
            initial = r.get('video_before',[])[i] if i < len(r.get('video_before',[])) else {}
            total = video.get('total',0)-initial.get('total',0)
            dropped = video.get('dropped',0)-initial.get('dropped',0)
            row['video_frames'].append({**video,'measured_total_frames':total,'measured_dropped_frames':dropped,'measured_drop_pct':100*dropped/total if total else None})
        row['media_decoder_properties'] = [p for event in r.get('media_properties',[]) for p in event.get('properties',[]) if 'decoder' in p.get('name','').lower() or 'platform' in p.get('name','').lower()]
        api = [t for t in trace.get('resource_timings',[]) if '/scene' in t['url']]
        row['scene_api_resource_ms'] = maximum([a['duration'] for a in api])
        row['measurement_asset_errors'] = bool(row['errors'] or row['request_failures'])
        rows.append(row)
    groups = defaultdict(list)
    for row in rows:
        groups[(row['profile_mode'],row['slug'])].append(row)
    summaries=[]
    for (mode,slug), trials in groups.items():
        good=[r for r in trials if r['status']=='ok' and not r.get('measurement_asset_errors')]
        source=good[0] if good else trials[0]
        summary={k:source.get(k) for k in ('slug','profile','profile_mode','room_side_m','element_count','model_triangles_total','splat_points_total','image_rgba_bytes_with_mipmaps_estimate','videoWallCount','drawing_buffer','actual_pixel_ratio','design_canvas_sizes','texture_count','geometry_count','unique_asset_count')}
        summary.update(valid_trials=len(good),attempted_trials=len(trials),trial_ids=[r['id'] for r in trials])
        for key in ('fps','one_pct_low_fps','browser_cpu_core_pct','main_cpu_core_pct','main_task_occupancy_pct','js_heap_mib','gpu_process_dedicated_mib','gpu_util_pct_mean','gpu_power_w_mean','gpu_temp_c_mean','gpu_decoder_pct_mean','draw_calls_mean','scene_api_resource_ms','load_ready_ms'):
            values=[r[key] for r in good if r.get(key) is not None]
            summary[key]=statistics.median(values) if values else None
        for key in ('frame_p95_ms','frame_p99_ms','gpu_main_p95_ms','render_submit_p95_ms','browser_working_set_peak_mib','browser_private_commit_peak_mib','server_working_set_peak_mib','draw_calls_max','triangles_max','over20ms_pct','over33ms_pct'):
            summary[key]=maximum([r.get(key) for r in good])
        summaries.append(summary)
    manifest=read(RAW/'workload-manifest.json')
    result={'generated_at':datetime.now(timezone.utc).isoformat(),'source_commit':'d80bd32845d8716f77f2aa7afdb7d3db626d73de',
            'host':host,'browser':browser,'profiles':{'desktop':'actual Chrome1440x900 DPR1, hardwareGPU','mobile':'desktop Chrome390x844 DPR2,4x MAIN-thread slowdown; not phone hardware','qhd':'actual desktop GPU,2560x1440 drawing load; not headset stereo'},
            'actual_mobile_measured':False,'actual_quest3_measured':False,'warmup_seconds':5,'measurement_seconds':10,'repeats':2,
            'summary_rule':'FPS/CPU/load/VRAM medians of valid trials; frame p95/p99, mainGPU p95, RAM peaks use worse valid trial; no pooling percentiles',
            'counter_scope':'CPU core%=one logical core100%; whole-machine%=core%/32. RAM=sum Chrome working sets (shared-page doublecount), privatecommit notresident. VRAM=Windows GPUProcessMemory post-trial dedicatedusage. NVIDIA utilization/power/memory=wholeadapter. MainGPU query excludes separate live-wall contexts.',
            'workloads':[{k:v for k,v in c.items() if k not in ('walls',)} for c in manifest['cases']],
            'asset_totals':manifest['asset_totals'],'trials':rows,'cases':summaries,
            'sources':{'results_jsonl_sha256':hashlib.sha256((RAW/'results.jsonl').read_bytes()).hexdigest(),'manifest_sha256':hashlib.sha256((RAW/'workload-manifest.json').read_bytes()).hexdigest()}}
    DEST.mkdir(exist_ok=True,parents=True)
    (DEST/'performance-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'trials':len(rows),'cases':len(summaries),'valid':sum(r['status']=='ok' and not r.get('measurement_asset_errors') for r in rows),'output':'docs/reports/performance-results.json'}))

if __name__ == '__main__':
    main()
