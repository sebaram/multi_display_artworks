import { readFileSync,writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/performance');
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
const manifest=JSON.parse(readFileSync(resolve(out,'workload-manifest.json'),'utf8'));
function phase(caseName){const targets=JSON.parse(readFileSync(resolve(out,'monitor-targets.json'),'utf8'));writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({...targets,case:caseName,phase:caseName}))}
async function run(name,argument){
  phase(name);
  const source=readFileSync(resolve(import.meta.dirname,name==='cpu-calibration'?'cpu_calibration.js':'lifecycle.js'),'utf8');
  const active=resolve(out,'extra-active.js');
  writeFileSync(active,`async(page)=>(${source})(page,${JSON.stringify(argument)})`);
  const {stdout}=await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perf','run-code',`--filename=${active}`,'--raw'],{cwd:root,windowsHide:true,timeout:210000,maxBuffer:5*1024*1024});
  const result=JSON.parse(stdout.trim());
  writeFileSync(resolve(out,name+'.json'),JSON.stringify(result,null,2)+'\n');
  console.log(name,JSON.stringify(name==='cpu-calibration'?result:{cycles:result.rows.length,errors:result.errors}));
}
await run('cpu-calibration',manifest.cases.find(c=>c.slug==='images-shared-L30-N0').room_path);
await run('lifecycle',manifest.cases.find(c=>c.profile==='binding-four'));
await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perf','goto','about:blank'],{cwd:root,windowsHide:true});
phase('api-load');
const api=await execute(resolve(root,'.venv/Scripts/python.exe'),[resolve(import.meta.dirname,'api_load.py')],{cwd:root,windowsHide:true,timeout:210000,maxBuffer:5*1024*1024});
console.log(api.stdout.trim());
phase('finished');
