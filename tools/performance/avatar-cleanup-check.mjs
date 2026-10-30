// >=65s real-app N50 gate, then explicit teardown/idle public roster and N1.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {producers,browserCode,provenance,waitForQuiescence} from './avatar-workloads.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'output/playwright/avatar-evaluation');
const source=await provenance(),result={source,startedAt:Date.now()/1000,cases:[],closures:[]};
const chrome=await browserCode('async(page)=>{const c=await page.context().browser().newBrowserCDPSession();const p=(await c.send("SystemInfo.getProcessInfo")).processInfo;await c.detach();return p;}');
writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({case:'relay-soak-N50-N1',phase:'relay-soak',browser_root_pid:chrome.find(p=>p.type==='browser').id,server_pids:[Number(process.env.AVATAR_SERVER_PID)]}));
const measure=readFileSync(resolve(import.meta.dirname,'avatar-measure-case.js'),'utf8');
result.baseline=await waitForQuiescence('29be153ffa8219a8bbe3c898','relay-soak-baseline');
for(const n of [50,1]) {
  const spec={n,size:10,profile:'desktop',models:'shared',roomId:'29be153ffa8219a8bbe3c898',coload:'empty',id:`relay-soak-N${n}`,repeat:0,origin:'http://127.0.0.1:8013',warmupMs:2000,durationMs:n===50?65000:6000,width:1440,height:900,elementCount:0};
  const bots=await producers(spec);assert.deepEqual(bots.clients[0].initialUsers,[],'Previous room participants remain');
  spec.producers=bots.clients.map(c=>({id:c.visitorId,profile:c.profile}));
  const history=[],cpu=process.cpuUsage(),nodeStart=Date.now()/1000;
  const timer=setInterval(()=>{const v=bots.snapshot();history.push({at:Date.now()/1000,connected:v.connected,attempted:v.sent,actualSent:v.actualSent,received:v.received,latestArrivalAgeMs:v.latestArrivalAgeMs,eventLoop:v.eventLoop,lagMs:v.lagMs,memory:process.memoryUsage(),cpu:process.cpuUsage()});},1000);
  try {
    const row=await browserCode(`async(page)=>(${measure})(page,${JSON.stringify(spec)})`);
    row.generator=structuredClone(bots.snapshot());row.generatorHistory=history;const used=process.cpuUsage(cpu),nodeEnd=Date.now()/1000;
    row.nodeWindow={start:nodeStart,end:nodeEnd,cpuCorePct:(used.user+used.system)/1e6/(nodeEnd-nodeStart)*100,memory:process.memoryUsage()};
    row.allRigsThroughWindow=!!row.trace&&row.trace.samples.every(s=>s.full+s.low+s.hidden===n);
    result.cases.push(row);
    console.log(`N${n}: ${row.status}, connected=${row.generator.connected}, load=${row.loadReadyMs}, failures=${JSON.stringify(row.failures)}`);
  } finally {
    clearInterval(timer);
    await browserCode('async(page)=>{await page.goto("about:blank");return {observerClosed:true};}');
    const closed=await bots.close();result.closures.push({n,at:Date.now()/1000,...closed,transportClosures:structuredClone(bots.snapshot().transportClosures)});assert.ok(closed.allClosed);
    writeFileSync(resolve(out,'relay-soak.json'),JSON.stringify(result,null,2));
    result.closures.at(-1).quiescence=await waitForQuiescence(spec.roomId,spec.id);
    writeFileSync(resolve(out,'relay-soak.json'),JSON.stringify(result,null,2));
  }
}
const probe=await producers({n:1,size:10,profile:'desktop',models:'shared',roomId:'29be153ffa8219a8bbe3c898'});
result.finalPublicRoster=probe.clients[0].initialUsers;assert.deepEqual(result.finalPublicRoster,[]);result.finalProbeClose=await probe.close();
result.endedAt=Date.now()/1000;
result.systemSamples=readFileSync(resolve(out,'system-samples.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(s=>s.at>=result.startedAt&&s.at<=result.endedAt);
writeFileSync(resolve(out,'relay-soak.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({cases:result.cases.map(c=>c.status),closures:result.closures.map(c=>c.allClosed),emptyFinalRoster:result.finalPublicRoster.length===0}));
assert.ok(result.cases.every(c=>c.status==='ok'&&c.generator.connected===c.spec.n&&c.allRigsThroughWindow),'Sustained real-app readiness/roster failed; keep evidence and investigate before primary timing.');
