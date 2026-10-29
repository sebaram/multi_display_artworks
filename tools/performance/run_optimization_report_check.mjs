import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const execute=promisify(execFile),root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'output/playwright/render-optimization');
const spec={url:'http://127.0.0.1:8099/render-optimization.html',
  desktopScreenshot:resolve(out,'report-desktop.png'),mobileScreenshot:resolve(out,'report-mobile.png'),
  downloadDirectory:resolve(out,'downloads'),downloadPath:resolve(out,'downloads/render-optimization-comparison.json')};
mkdirSync(spec.downloadDirectory,{recursive:true});
const source=readFileSync(resolve(import.meta.dirname,'check_optimization_report.js'),'utf8');
const script=resolve(out,'active-report-qa.js');
writeFileSync(script,`async(page)=>{return (${source})(page,${JSON.stringify(spec)});}`);
const {stdout}=await execute(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js','--offline','--yes','--package','@playwright/cli','playwright-cli','-s=perfopt','run-code',`--filename=${script}`,'--raw'],{cwd:root,maxBuffer:1024*1024,windowsHide:true,timeout:120000});
const result=JSON.parse(stdout.trim());
if(result.download.status==='saved') {
  const downloaded=JSON.parse(readFileSync(spec.downloadPath,'utf8'));
  assert.equal(downloaded.trials.length,46);
  assert.equal(downloaded.screenshots.filter(shot=>shot.data_uri).length,25);
  result.download.contentValidated=true;
}
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
result.html_sha256=sha(resolve(root,'docs/reports/render-optimization.html'));
result.results_sha256=sha(resolve(root,'docs/reports/render-optimization-results.json'));
const validationPath=resolve(root,'docs/reports/render-optimization-validation.json');
writeFileSync(validationPath,JSON.stringify(result,null,2)+'\n');
const data=JSON.parse(readFileSync(resolve(root,'docs/reports/render-optimization-results.json'),'utf8'));
const artifact={created_at:result.at,html:'render-optimization.html',
  html_bytes:readFileSync(resolve(root,'docs/reports/render-optimization.html')).length,
  html_sha256:result.html_sha256,results:'render-optimization-results.json',results_sha256:result.results_sha256,
  validation:'render-optimization-validation.json',validation_sha256:sha(validationPath),
  baseline_commit:data.metadata.baseline_commit,optimized_commit:data.metadata.optimized_commit,
  attempts:data.metadata.attempts_total,selected_trials:data.trials.length,excluded_trials:data.metadata.excluded_trials,
  screenshots:data.screenshots.length,actual_phone:false,actual_quest3:false,
  evidence_hashes:data.evidence_hashes};
writeFileSync(resolve(root,'docs/reports/render-optimization-artifact.json'),JSON.stringify(artifact,null,2)+'\n');
console.log(JSON.stringify(result));
