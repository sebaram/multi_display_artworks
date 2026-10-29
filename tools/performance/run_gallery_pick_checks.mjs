import { readFileSync,writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/render-optimization');
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
const source=readFileSync(resolve(import.meta.dirname,'check_gallery_pick.js'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(root,'output/playwright/performance/workload-manifest.json'),'utf8'));
const results=[];
for(const [type,profile,count] of [['image','images-shared',1000],['gltf','gltf',100],['gaussian_splat','gaussian_splat',8],['webpage','webpage',20]]) {
  const workload=manifest.cases.find(c=>c.profile===profile&&c.element_count===count&&c.room_side_m===30);
  if(!workload)throw Error(`Missing ${profile}`);
  const script=resolve(out,'pick-active.js');writeFileSync(script,`async(page)=>{return (${source})(page,${JSON.stringify({origin:'http://127.0.0.1:8102',room_path:workload.room_path,type})});}`);
  const {stdout}=await execute(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perfopt','run-code',`--filename=${script}`,'--raw'],{cwd:root,maxBuffer:1024*1024,windowsHide:true});
  const result=JSON.parse(stdout.trim());results.push(result);console.log(`${type} ${result.status}`);
}
writeFileSync(resolve(out,'picking-validation.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));
