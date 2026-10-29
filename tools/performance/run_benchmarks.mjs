// CLI-first orchestration: one actual app page, one measured case at a time.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile);
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/performance');
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
const source=readFileSync(resolve(import.meta.dirname,'measure-case.js'),'utf8');
const {stdout:serverPidText}=await execute('powershell.exe',['-NoProfile','-Command',"(Get-NetTCPConnection -State Listen -LocalPort 8101).OwningProcess | ConvertTo-Json -Compress"],{windowsHide:true});
const serverPids=[JSON.parse(serverPidText.trim())].flat();
const manifest=JSON.parse(readFileSync(resolve(out,'workload-manifest.json'),'utf8'));
const modes={desktop:{width:1440,height:900,dpr:1,cpuRate:1},mobile:{width:390,height:844,dpr:2,cpuRate:4,mobile:true},qhd:{width:2560,height:1440,dpr:1,cpuRate:1},soak:{width:1440,height:900,dpr:1,cpuRate:1}};
const mode=process.argv[2]||'dry',match=process.argv[3];
let cases=manifest.cases;
if(match)cases=cases.filter(c=>c.slug.includes(match));
if(mode==='mobile')cases=cases.filter(c=>c.room_side_m===30&&((c.profile==='images-shared'&&[0,25,100,300,1000].includes(c.element_count))||(c.profile==='images-unique'&&[100,300].includes(c.element_count))||(c.profile==='gltf'&&c.element_count===100)||(c.profile==='gaussian_splat'&&[1,8].includes(c.element_count))||c.profile.startsWith('binding-')||(c.profile==='webpage'&&c.element_count===20)||(c.profile==='video-walls-1080p'&&c.videoWallCount===4)||c.profile==='video-walls-4k'||c.profile==='mixed'));
if(mode==='qhd')cases=cases.filter(c=>c.room_side_m===30&&((c.profile==='images-shared'&&[0,1000].includes(c.element_count))||(c.profile==='images-unique'&&c.element_count===300)||(c.profile==='gaussian_splat'&&c.element_count===8)||c.profile==='binding-four'||c.profile==='video-walls-4k'));
if(mode==='dry')cases=cases.slice(0,1);
if(mode==='soak')cases=cases.filter(c=>c.profile==='binding-four');
const repeats=['dry','soak'].includes(mode)?1:2;
const resultFile=resolve(out,mode==='dry'?'dry-results.jsonl':'results.jsonl');
const done=existsSync(resultFile)?readFileSync(resultFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
let total=cases.length*repeats,number=0;
for(let repeat=1;repeat<=repeats;repeat++)for(const workload of repeat===2?[...cases].reverse():cases){
  const profile=mode==='dry'?'desktop':mode;
  const id=`${profile}:${workload.slug}:${repeat}`;number++;
  if(mode!=='dry'&&!process.env.PERF_FORCE&&done.some(r=>r.id===id&&r.status==='ok'))continue;
  const spec={...workload,...modes[profile],origin:'http://127.0.0.1:8101',warmupMs:mode==='dry'?2500:5000,durationMs:mode==='dry'?4000:10000,timers:true,repeat,profile_mode:profile};
  if(mode==='soak'){spec.warmupMs=10000;spec.durationMs=180000}
  if(repeat===1&&((workload.element_count===300||workload.element_count===1000)&&workload.room_side_m===30||workload.profile==='binding-four'||workload.profile==='splats'&&workload.element_count===4))spec.screenshot=resolve(out,`scene-${profile}-${workload.slug}.jpg`);
  const active=resolve(out,'active-case.js');
  writeFileSync(active,`async(page)=>{const spec=${JSON.stringify(spec)};return (${source})(page,spec);}`);
  let result;
  const previousTargets=existsSync(resolve(out,'monitor-targets.json'))?JSON.parse(readFileSync(resolve(out,'monitor-targets.json'),'utf8')):{};
  writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({...previousTargets,case:id,phase:'case'}));
  console.log(`START ${number}/${total} ${id}`);
  try{
    const {stdout}=await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perf','run-code',`--filename=${active}`,'--raw'],{cwd:root,maxBuffer:20*1024*1024,timeout:210000,windowsHide:true});
    result=JSON.parse(stdout.trim());
  }catch(error){result={status:'harness_error',spec,error:String(error),stdout:error.stdout?.slice(-2000),stderr:error.stderr?.slice(-1000)}}
  result.id=id;
  appendFileSync(resultFile,JSON.stringify(result)+'\n');
  const frames=result.trace?.rendered_frames,resultMs=result.trace?.elapsed_ms;
  const fps=frames&&resultMs?(frames*1000/resultMs).toFixed(1):'N/A';
  console.log(`END ${number}/${total} ${id} ${result.status} FPS=${fps} ready=${result.readiness?.load_ready_ms||'N/A'}ms`);
  const pids=(result.processes_after||[]).map(p=>p.id);
  if(pids.length){
    const script=`$ownedIds=@(${pids.join(',')}); @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and $ownedIds -contains [int]$Matches[1] } | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted) | ConvertTo-Json -Compress`;
    try{const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',script],{maxBuffer:1024*1024,windowsHide:true});result.gpu_process_memory=JSON.parse(stdout.trim()||'[]')}catch(error){result.gpu_process_memory_error=String(error)}
    writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({browser_pids:pids,browser_root_pid:result.processes_after.find(p=>p.type==='browser')?.id,server_pids:serverPids,case:id,phase:'between_cases'}));
  }
  appendFileSync(resolve(out,'gpu-process-memory.jsonl'),JSON.stringify({id,...{snapshot:result.gpu_process_memory,error:result.gpu_process_memory_error}})+'\n');
  if(result.status==='harness_error'||result.status==='invalid')break;
}
