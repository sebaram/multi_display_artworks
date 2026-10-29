// Compare optional GPU-query collection on/off on the same actual live-wall case.
import { readFileSync,writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/performance');
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
const source=readFileSync(resolve(import.meta.dirname,'measure-case.js'),'utf8');
const workload=JSON.parse(readFileSync(resolve(out,'workload-manifest.json'),'utf8')).cases.find(c=>c.profile==='binding-four');
async function run(args){return execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perf-instrument',...args],{cwd:root,windowsHide:true,maxBuffer:5*1024*1024,timeout:120000})}
const trials=[];
try{
  await run(['open','about:blank','--browser=chrome','--headed']);
  for(const timers of [true,false,false,true]){
    const spec={...workload,width:1440,height:900,dpr:1,cpuRate:1,origin:'http://127.0.0.1:8101',warmupMs:5000,durationMs:8000,timers,profile_mode:'instrumentation'};
    const file=resolve(out,'instrumentation-active.js');
    writeFileSync(file,`async(page)=>(${source})(page,${JSON.stringify(spec)})`);
    const {stdout}=await run(['run-code',`--filename=${file}`,'--raw']);
    const r=JSON.parse(stdout.trim());
    if(r.status!=='ok'||r.errors.length||r.failures.length)throw Error('Invalid instrumentation comparison');
    const fps=r.trace.rendered_frames*1000/r.trace.elapsed_ms;
    trials.push({timers,fps,elapsed_ms:r.trace.elapsed_ms,frames:r.trace.rendered_frames,frame_intervals_ms:r.trace.frame_intervals_ms});
    console.log(JSON.stringify({timers,fps}));
  }
}finally{await run(['close'])}
const average=enabled=>trials.filter(t=>t.timers===enabled).reduce((sum,r)=>sum+r.fps,0)/2;
const result={scope:'same4livewallscene,5swarmup+8smeasure,on/off/off/on; only optionalGPUqueries differ; other instrumentation remains',trials,on_fps:average(true),off_fps:average(false),relative_fps_difference_pct:100*(average(false)-average(true))/average(false)};
writeFileSync(resolve(out,'instrumentation-check.json'),JSON.stringify(result,null,2)+'\n');
