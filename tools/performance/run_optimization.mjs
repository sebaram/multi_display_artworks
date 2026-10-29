// Sequential actual-app comparison through the repository's playwright-cli workflow.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'output/playwright/render-optimization');mkdirSync(out,{recursive:true});
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
const source=readFileSync(resolve(import.meta.dirname,'optimization-case.js'),'utf8');
const productPaths=['frontend/src','frontend/public','frontend/package.json','frontend/package-lock.json','frontend/vite.config.ts','frontend/tsconfig.json','frontend/index.html'];
const {stdout:revision}=await execute('git',['log','-1','--format=%H','--',...productPaths],{cwd:root,windowsHide:true});
const {stdout:dirtyProduct}=await execute('git',['status','--porcelain','--',...productPaths],{cwd:root,windowsHide:true});
if(dirtyProduct.trim())throw Error('Commit the product sources and rebuild before measuring a frozen bundle.');
const manifest=JSON.parse(readFileSync(resolve(root,'output/playwright/performance/workload-manifest.json'),'utf8'));
const slugs=['images-shared-L30-N1000','images-unique-L30-N300','gltf-L30-N100','gaussian_splat-L30-N8','binding-L30-four-walls','mixed-L30-N300'];
const resultFile=resolve(out,'comparison-raw.jsonl');
const completed=existsSync(resultFile)?readFileSync(resultFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const latestCompleted=new Map(completed.map(row=>[row.id,row]));
const mode=process.argv[2]||'dry',filter=process.argv[3];
const jobs=[];
const push=(variant,profile,slug,stationary,repeat)=>{
  const workload=manifest.cases.find(c=>c.slug===slug);
  if(!workload)throw Error(`Missing fixture ${slug}`);
  const spec={...workload,variant,profile,workload:slug+(stationary?'-stationary':''),stationary,repeat,
    source_commit:variant==='baseline'?'52ee0b4':revision.trim(),
    width:profile==='desktop'?1440:390,height:profile==='desktop'?900:844,
    origin:variant==='baseline'?'http://127.0.0.1:8101':'http://127.0.0.1:8102',warmupMs:mode==='dry'?3000:8000,durationMs:mode==='dry'?3000:10000};
  spec.id=`${variant}:${profile}:${spec.workload}:${repeat}`;
  if(!filter||spec.id.includes(filter))jobs.push(spec);
};
if(mode==='dry')push('optimized-fixed','desktop',filter||'gaussian_splat-L30-N8',false,0);
else if(mode==='desktop')for(let repeat=1;repeat<=2;repeat++)for(const slug of repeat===1?slugs:[...slugs].reverse())for(const variant of repeat===1?['baseline','optimized-fixed']:['optimized-fixed','baseline'])push(variant,'desktop',slug,false,repeat);
else if(mode==='stationary')for(let repeat=1;repeat<=2;repeat++)for(const variant of repeat===1?['baseline','optimized-fixed']:['optimized-fixed','baseline'])push(variant,'desktop','gaussian_splat-L30-N8',true,repeat);
else if(mode==='mobile')for(let repeat=1;repeat<=2;repeat++)for(const slug of ['images-unique-L30-N300','gaussian_splat-L30-N8','binding-L30-four-walls','mixed-L30-N300'])for(const variant of repeat===1?['baseline','optimized-adaptive']:['optimized-adaptive','baseline'])push(variant,'mobile-stress',slug,false,repeat);
else if(mode==='adaptive')for(let repeat=1;repeat<=2;repeat++)push('optimized-adaptive','desktop','binding-L30-four-walls',false,repeat);
else throw Error(`Unknown mode ${mode}`);
const {stdout:processText}=await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perfopt','run-code','async(page)=>{const c=await page.context().browser().newBrowserCDPSession();const r=(await c.send("SystemInfo.getProcessInfo")).processInfo;await c.detach();return r;}','--raw'],{cwd:root,maxBuffer:1024*1024,windowsHide:true});
const chrome=JSON.parse(processText.trim());
for(let index=0;index<jobs.length;index++) {
  const spec=jobs[index];
  const previous=latestCompleted.get(spec.id);
  if(mode!=='dry'&&previous?.status==='ok'&&(previous.source_commit===spec.source_commit||spec.variant==='baseline')&&!process.env.PERF_FORCE)continue;
  if(spec.repeat===1||mode==='dry')spec.screenshot=resolve(out,`${spec.variant}-${spec.profile}-${spec.workload}.jpg`);
  writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({case:spec.id,phase:'measuring',browser_root_pid:chrome.find(p=>p.type==='browser')?.id}));
  const script=resolve(out,'active-optimization.js');writeFileSync(script,`async(page)=>{return (${source})(page,${JSON.stringify(spec)});}`);
  console.log(`START ${index+1}/${jobs.length} ${spec.id}`);
  let row;
  try {
    const {stdout}=await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perfopt','run-code',`--filename=${script}`,'--raw'],{cwd:root,maxBuffer:24*1024*1024,timeout:180000,windowsHide:true});
    row=JSON.parse(stdout.trim());
  } catch(error) { row={...spec,status:'harness_error',error:String(error),stdout:error.stdout,stderr:error.stderr}; }
  row.id=spec.id;
  if(row.processes_after) {
    const ids=row.processes_after.map(p=>p.id);
    const command=`$taskIds=@(${ids.join(',')}); @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and $taskIds -contains [int]$Matches[1] } | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted) | ConvertTo-Json -Compress`;
    try {
      const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,maxBuffer:1024*1024});
      row.gpu_process_memory=JSON.parse(stdout.trim()||'[]');
      if ([row.gpu_process_memory].flat().length) row.gpu_dedicated_mib=[row.gpu_process_memory].flat().reduce((sum,value)=>sum+(value.DedicatedUsage||0),0)/1048576;
    } catch(error) {row.gpu_memory_error=String(error);}
  }
  if(existsSync(resolve(out,'system-samples.jsonl'))&&row.started_at) {
    const samples=readFileSync(resolve(out,'system-samples.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(s=>s.at>=row.started_at&&s.at<=row.ended_at);
    row.system_samples=samples;
    if(samples.length){row.working_set_mib=Math.max(...samples.map(s=>(s.browser||[]).reduce((sum,p)=>sum+p.working_set_bytes,0)))/1048576;row.private_commit_mib=Math.max(...samples.map(s=>(s.browser||[]).reduce((sum,p)=>sum+p.private_commit_bytes,0)))/1048576;}
  }
  if(mode==='dry')writeFileSync(resolve(out,'dry-comparison.json'),JSON.stringify(row,null,2));
  else appendFileSync(resultFile,JSON.stringify(row)+'\n');
  writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({case:spec.id,phase:'between',browser_root_pid:chrome.find(p=>p.type==='browser')?.id}));
  console.log(`END ${spec.id} ${row.status} FPS=${row.fps?.toFixed(1)} CPU=${row.cpu_core_pct?.toFixed(1)} VRAM=${row.gpu_dedicated_mib?.toFixed(1)}`);
  if(row.status!=='ok'){console.log(JSON.stringify({errors:row.errors,failures:row.failures,error:row.error,stdout:row.stdout?.slice(-2000)}));process.exitCode=1;break;}
}
