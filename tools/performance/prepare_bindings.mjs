// Prepare only deterministically named synthetic live-wall cases on the local lab.
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/performance');
const manifest=JSON.parse(readFileSync(resolve(out,'workload-manifest.json'),'utf8'));
const cases=manifest.cases.filter(c=>c.binding_wall_ids?.length);
if(cases.some(c=>!c.slug.startsWith('binding-L30-')))throw Error('Unexpected binding fixture');
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
function run(args){return execFileSync(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perf-setup',...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024})}
const callback=async(page,cases)=>{
  await page.getByLabel('이메일',{exact:true}).fill('admin@migration.invalid');
  await page.getByLabel('비밀번호',{exact:true}).fill('Migration-local-123!');
  await page.getByRole('button',{name:'로그인 →',exact:true}).click();
  await page.getByRole('heading',{name:'공간 관리',exact:true}).waitFor();
  return page.evaluate(async cases=>{
    const {csrf_token}=await(await fetch('/api/v1/auth/csrf')).json();
    const headers={'Content-Type':'application/json','X-CSRF-Token':csrf_token};
    const config=(await(await fetch('/wall-presets/builtin-0.json')).json()).config;
    Object.assign(config.state,{paused:false,interactive:true,showVideo:false,videoLayers:[],brightness:70});
    const results=[];
    for(const c of cases)for(const id of c.binding_wall_ids){
      const wall=await(await fetch('/api/v1/walls/'+id)).json();
      if(!wall.name?.startsWith('perf20261029-')||wall.room?.id!==c.room_id)throw Error('Refusing nonfixture wall');
      const patched=await fetch('/api/v1/admin/walls/'+id,{method:'PATCH',headers,body:JSON.stringify({width:10.6666666667,height:6})});
      if(!patched.ok)throw Error(await patched.text());
      const path='/api/v1/walls/'+id+'/design',prev=await(await fetch(path)).json();
      const response=await fetch(path,{method:'PUT',headers,body:JSON.stringify({config,expected_revision:prev?.revision||0})});
      if(!response.ok)throw Error(await response.text());
      results.push({wall:id,status:response.status,revision:(await response.json()).revision});
    }
    return results;
  },cases);
};
const file=resolve(out,'prepare-bindings-active.js');
writeFileSync(file,`async(page)=>(${callback})(page,${JSON.stringify(cases)})`);
try{
  run(['open','http://127.0.0.1:8101/signin?next=/kwanri','--browser=chrome']);
  const result=run(['run-code',`--filename=${file}`,'--raw']);
  JSON.parse(result);
  writeFileSync(resolve(out,'binding-proof.json'),result);
  for(const c of cases){c.design_wall_dimensions_m=[10.6666666667,6];c.design_canvas_expected=[1024,576]}
  writeFileSync(resolve(out,'workload-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(result.trim());
}finally{run(['close'])}
