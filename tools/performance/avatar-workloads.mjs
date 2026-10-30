// Real Socket.IO producers and the frozen application's real renderer. Never seeds a DB.
import {readFileSync,writeFileSync,appendFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
const root=resolve(import.meta.dirname,'../..'), run=promisify(execFile);
const require=createRequire(resolve(root,'frontend/package.json')), {io}=require('socket.io-client');
const {Decoder,Encoder}=require('socket.io-parser');
const parser={Encoder,Decoder:class extends Decoder{constructor(){super({maxAttachments:64});}}};
const out=resolve(root,'output/playwright/avatar-evaluation');mkdirSync(out,{recursive:true});
const origin=process.env.AVATAR_PERF_ORIGIN||'http://127.0.0.1:8013';
if(!/^http:\/\/127\.0\.0\.1:8013$/.test(origin))throw Error('Only the dedicated local performance API8013 is supported.');
const mode=process.argv[2]||'selfcheck', filter=process.argv[3];
const sha=data=>createHash('sha256').update(data).digest('hex');
const quantile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)]??null;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const manifest=JSON.parse(readFileSync(resolve(root,'output/playwright/performance/workload-manifest.json'),'utf8'));
const catalog=JSON.parse(readFileSync(resolve(root,'frontend/public/avatars/catalog.fixture.json'),'utf8'));
const rooms={10:'29be153ffa8219a8bbe3c898',30:'1e16d75d527a22bd1caba95b',100:'a8df9de199a51c6d6fc3b3b5',image:'5fc6fbf17e7c25091b767fe0',splat:'6dc62c8b9b140cdea2964f74',mixed:'69a35d2057e1bc5be6eaa6de'};
const caseList=[];
for(const profile of ['desktop','pc-390-4x'])for(const size of [10,30,100])for(const models of ['shared','mixed-models'])for(const n of [1,5,10,20,50])caseList.push({profile,size,models,n,roomId:rooms[size],coload:'empty'});
for(const profile of ['desktop','pc-390-4x'])for(const coload of ['image','splat','mixed'])for(const n of [10,50])caseList.push({profile,size:30,models:'shared',n,roomId:rooms[coload],coload});
for(const models of ['hidden','legacy-robot'])caseList.push({profile:'desktop',size:10,models,n:10,roomId:rooms[10],coload:'empty'});
const key=c=>`${c.profile}-L${c.size}-N${c.n}-${c.models}-${c.coload}`;
function placement(spec,i) {
  const cols=Math.min(10,Math.ceil(Math.sqrt(spec.n))),row=Math.floor(i/cols),rows=Math.ceil(spec.n/cols);
  const distance=spec.size*(.35+.1*row/Math.max(1,rows-1));
  // Conservative portrait frustum; all agents are in view, with count and actual distances recorded.
  const width=distance*(spec.profile==='pc-390-4x'?.28:1.05);
  return {x:((i%cols+.5)/cols-.5)*width,z:spec.size*.45-distance,distance};
}
function posePacket(sequence,spec,i) {
  const at=Date.now(),p=placement(spec,i),values=new Float32Array(98);
  values[0]=p.x;values[2]=p.z;values[4]=1; // root faces observer (+Z)
  for(let j=0;j<22;j++)values[13+4*j]=1;
  // Deterministic prerecorded joint fixture, not another owner IK solve or sensor tracking.
  const moving=spec.motion==='all-joints'?Array.from({length:22},(_,bone)=>[bone,bone%2?-1:1]):[[7,1],[11,-1],[14,-1],[18,1]];
  for(const [bone,sign] of moving) {
    const angle=Math.sin(sequence*.16+i*.2)*.25*sign;
    values[10+bone*4]=Math.sin(angle/2);values[13+bone*4]=Math.cos(angle/2);
  }
  return {version:2,rigVersion:'humanoid-v1',sequence,sampleTime:at,bodyScale:1,tracking:{head:true,left:false,right:false},teleport:sequence===0,floats:Buffer.from(values.buffer)};
}
function profileFor(spec,i) {
  const id=spec.models==='hidden'?'none':spec.models==='legacy-robot'?'robot':spec.models==='mixed-models'?['casual','robot','shiba','rigged-simple'][i%4]:'casual';
  const preset=catalog.presets.find(p=>p.id===id),color=['#E86B50','#4587C4','#8B9B5B','#AD67B3','#D4A847'][i%5];
  return {displayName:`Synthetic ${String(i+1).padStart(2,'0')}`,avatarId:id,color,...(preset.defaultAppearance?{appearance:{...preset.defaultAppearance,colors:{...preset.defaultAppearance.colors,top:color}}}:{})};
}
export async function producers(spec) {
  const clients=[],latencies=[],seen=new Map(),disconnects=[],transportClosures=[],sentKeys=new Set(),knownIds=new Set();
  const lag=monitorEventLoopDelay({resolution:20});lag.enable();let elu=performance.eventLoopUtilization();
  let received=0,sent=0,actualSent=0,receivedCohort=0,bytesIn=0,bytesOut=0,latestArrivalAgeMs=null,interval;
  for(let i=0;i<spec.n;i++) {
    const capability=await (await fetch(origin+'/visitor-capability',{method:'POST'})).json();
    const socket=io(origin,{parser,transports:['websocket'],auth:{visitorCapability:capability.capability},autoConnect:false,reconnection:false});
    const profile=profileFor(spec,i),p=placement(spec,i);
    const client={socket,profile,visitorId:capability.visitorId,generation:null,sequence:0};clients.push(client);knownIds.add(client.visitorId);
    socket.on('disconnect',reason=>disconnects.push({id:client.visitorId,reason,at:Date.now()}));
    socket.on('avatar_pose',data=>{
      if(!knownIds.has(data.userId))return; // Owner uses a different monotonic time origin.
      received++;latestArrivalAgeMs=Date.now()-data.pose.sampleTime;
      if(mode==='fanout'||mode==='soak'){latencies.push(latestArrivalAgeMs);if(sentKeys.has(`${data.userId}:${data.pose.sequence}`))receivedCohort++;}
      const key=data.userId;seen.set(key,(seen.get(key)||0)+1);
    });
    socket.on('position_update',()=>received++);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('producer join timeout')),15000);
      socket.on('connect_error',reject);
      socket.on('room_state',data=>{client.generation=data.generation;client.initialUsers=data.users.map(u=>u.userId);clearTimeout(timeout);resolve();});
      socket.on('connect',()=>socket.emit('join_position_room',{room_id:spec.roomId,profile,position:{x:p.x,y:1.64,z:p.z},rotation:{x:0,y:180,z:0}}));socket.connect();
    });
    socket.io.engine.on('packet',packet=>{if(packet.type==='message')bytesIn+=typeof packet.data==='string'?Buffer.byteLength(packet.data):packet.data?.byteLength||0;});
    socket.io.engine.transport.ws.on('close',(code,reason)=>transportClosures.push({id:client.visitorId,code,reason:String(reason),at:Date.now()}));
    socket.io.engine.on('packetCreate',packet=>{if(packet.type==='message'){
      bytesOut+=typeof packet.data==='string'?Buffer.byteLength(packet.data):packet.data?.byteLength||0;
      if(typeof packet.data==='string'&&packet.data.includes('["avatar_pose",')){const [,value]=JSON.parse(packet.data.slice(packet.data.indexOf('[')));actualSent++;if(mode==='fanout'||mode==='soak')sentKeys.add(`${client.visitorId}:${value.pose.sequence}`);}
    }});
  }
  const tick=()=>clients.forEach((client,i)=>{
    if(client.profile.appearance)client.socket.volatile.emit('avatar_pose',{room_id:spec.roomId,generation:client.generation,pose:posePacket(client.sequence++,spec,i)});
    else {const p=placement(spec,i);client.socket.volatile.emit('position_update',{room_id:spec.roomId,position:{x:p.x,y:1.64,z:p.z},rotation:{x:0,y:180+Math.sin(client.sequence++*.16)*10,z:0}});}
    sent++;
  });
  tick();interval=setInterval(tick,50);
  return {clients, reset(){received=sent=actualSent=receivedCohort=bytesIn=bytesOut=0;latestArrivalAgeMs=null;latencies.length=0;seen.clear();sentKeys.clear();lag.reset();elu=performance.eventLoopUtilization();}, snapshot(){return {received,sent,actualSent,receivedCohort,bytesIn,bytesOut,latencies,latestArrivalAgeMs,connected:clients.filter(c=>c.socket.connected).length,disconnects,transportClosures,eventLoop:performance.eventLoopUtilization(elu),lagMs:{mean:lag.mean/1e6,p95:lag.percentile(95)/1e6,p99:lag.percentile(99)/1e6,max:lag.max/1e6},receivedPerSender:Object.fromEntries(seen)};}, async close(){
    clearInterval(interval);lag.disable();const started=Date.now();
    const states=await Promise.all(clients.map(async c=>{const engine=c.socket.io.engine,transport=engine?.transport,ws=transport?.ws;let closeEvent=ws?.readyState===3;
      const closed=new Promise(resolve=>{if(closeEvent||!ws)return resolve();let timer=setTimeout(resolve,5000);ws.once('close',()=>{closeEvent=true;clearTimeout(timer);resolve();});});
      c.socket.disconnect();await closed;const forced=!!ws&&ws.readyState!==3;
      if(forced){await new Promise(resolve=>{const timer=setTimeout(resolve,5000);ws.once('close',()=>{closeEvent=true;clearTimeout(timer);resolve();});ws.terminate();});}
      return {id:c.visitorId,engine:engine?.readyState,transport:transport?.readyState,webSocket:ws?.readyState,closeEvent,forced};}));
    return {elapsedMs:Date.now()-started,allClosed:states.every(s=>s.engine==='closed'&&s.webSocket===3&&s.closeEvent),states};
  }};
}
const cli='C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js';
export async function browserCode(source,name='active-avatar.js') {
  const file=resolve(out,name);writeFileSync(file,source);
  const {stdout}=await run(process.execPath,[cli,'--offline','--yes','--package','@playwright/cli','playwright-cli','-s=avatar-eval','run-code',`--filename=${file}`,'--raw'],{cwd:root,windowsHide:true,maxBuffer:20*1024*1024,timeout:180000});
  return JSON.parse(stdout.trim());
}
export async function provenance() {
  const product=['frontend/src','frontend/public','frontend/package.json','frontend/package-lock.json','backend/metamuseum'];
  const git=async args=>(await run('git',args,{cwd:root,windowsHide:true})).stdout.trim();
  assert.equal(await git(['status','--porcelain','--',...product]),'','Product source must be committed before timing.');
  const files=readdirSync(resolve(root,'frontend/dist/assets')).sort().map(name=>({name,sha256:sha(readFileSync(resolve(root,'frontend/dist/assets',name)))}));
  return {productCommit:await git(['log','-1','--format=%H','--',...product]),frontendCommit:await git(['log','-1','--format=%H','--',...product.slice(0,4)]),relayCommit:await git(['log','-1','--format=%H','--','backend/metamuseum/realtime']),head:await git(['rev-parse','HEAD']),bundles:files,modelSha256:sha(readFileSync(resolve(root,'frontend/dist/avatars/common-humanoid.glb'))),harnessSha256:sha(readFileSync(import.meta.filename)),collectorSha256:sha(readFileSync(resolve(import.meta.dirname,'avatar-measure-case.js'))),fixtureVersion:manifest.fixture_version,origin,settings:{db:'metamuseum_perf_20261029',poseHz:20,visualBufferMs:100,transport:'websocket',tls:false,network:'loopback'}};
}
function sameFrozenSource(a,b) {
  return ['productCommit','frontendCommit','relayCommit','modelSha256','harnessSha256','collectorSha256','bundles'].every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
}
async function gpuSnapshot(pids) {
  const script=`$taskIds=@(${pids.join(',')}); @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and $taskIds -contains [int]$Matches[1] } | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted) | ConvertTo-Json -Compress`;
  try {return JSON.parse((await run('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,maxBuffer:1024*1024})).stdout.trim()||'[]');}catch(error){return {unavailable:String(error)};}
}
function systemWindow(start,end) {
  const file=resolve(out,'system-samples.jsonl');
  return existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(s=>s.at>=start&&s.at<=end):[];
}
export async function waitForQuiescence(roomId,id) {
  const start=Date.now()/1000,attempts=[];
  while(Date.now()/1000-start<120) {
    const probe=await producers({n:1,size:10,profile:'desktop',models:'hidden',roomId});
    const users=probe.clients[0].initialUsers,closed=await probe.close();
    const idleStart=Date.now()/1000;await wait(6000);const idleEnd=Date.now()/1000,samples=systemWindow(idleStart,idleEnd);
    const first=samples[0],last=samples.at(-1),old=new Map(first?.server?.map(p=>[p.pid,p.cpu_seconds]));
    const sameProcesses=first?.server?.length>0&&last?.server?.length===first.server.length&&last.server.every(p=>old.has(p.pid));
    const serverCpuCorePct=samples.length>=3&&sameProcesses?last.server.reduce((sum,p)=>sum+Math.max(0,p.cpu_seconds-old.get(p.pid)),0)/(last.at-first.at)*100:null;
    attempts.push({at:idleStart,users,closed,serverCpuCorePct,systemSamples:samples});
    if(!users.length&&closed.allClosed&&serverCpuCorePct!==null&&serverCpuCorePct<5) {
      const result={id,success:true,elapsedSeconds:Date.now()/1000-start,attempts};appendFileSync(resolve(out,'quiescence.jsonl'),JSON.stringify(result)+'\n');return result;
    }
  }
  const result={id,success:false,elapsedSeconds:Date.now()/1000-start,attempts};appendFileSync(resolve(out,'quiescence.jsonl'),JSON.stringify(result)+'\n');
  throw Error(`Room did not become empty and idle after ${result.elapsedSeconds}s: ${id}`);
}
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename) {
if(mode==='selfcheck') {
  assert.equal(caseList.length,74);assert.equal(posePacket(1,{n:10,size:10,profile:'desktop'},0).floats.length,392);
  const active=new Float32Array(posePacket(1,{n:10,size:10,profile:'desktop',motion:'all-joints'},0).floats.buffer);
  assert.ok(Array.from({length:22},(_,j)=>active[10+j*4]).every(v=>v!==0));
  assert.equal(new Set(caseList.map(key)).size,caseList.length);
  assert.ok(!sameFrozenSource({frontendCommit:'same',relayCommit:'old'},{frontendCommit:'same',relayCommit:'new'}));
  assert.ok(!sameFrozenSource({collectorSha256:'old'},{collectorSha256:'new'}));
  for(const c of caseList)for(let i=0;i<c.n;i++)assert.ok(Number.isFinite(placement(c,i).x));
  console.log('Avatar workload selfcheck: 74 distinct cases; finite placement; 392-byte 22-joint packets.');
} else {
  const source=await provenance();writeFileSync(resolve(out,'measurement-provenance.json'),JSON.stringify(source,null,2));
  if(mode==='fanout'||mode==='soak') {
    for(const repeat of mode==='soak'?[1]:[1,2])for(const n of mode==='soak'?[50]:repeat===1?[1,5,10,20,50]:[50,20,10,5,1]) {
      const spec={n,size:30,profile:'desktop',models:'shared',roomId:rooms[30]},id=`${mode}-N${n}-r${repeat}`;
      console.log('START',id);const bots=await producers(spec);
      try {
        assert.deepEqual(bots.clients[0].initialUsers,[],'Old participants remain before the relay trial');
        writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({case:id,phase:'fanout',browser_pids:[],server_pids:[Number(process.env.AVATAR_SERVER_PID)],generator_pid:process.pid}));
        await wait(2000);bots.reset();const start=Date.now()/1000,cpu=process.cpuUsage(),memory=process.memoryUsage();
        const seconds=mode==='soak'?65:8,history=[];
        for(let second=0;second<seconds;second++){await wait(1000);const v=bots.snapshot();history.push({at:Date.now()/1000,connected:v.connected,attempted:v.sent,actualSent:v.actualSent,received:v.received,receivedCohort:v.receivedCohort,latestArrivalAgeMs:v.latencies.at(-1)??null});}
        const end=Date.now()/1000,network=bots.snapshot(),used=process.cpuUsage(cpu);
        const row={id,spec,repeat,status:network.connected===n?'connected':'disconnected',source,started_at:start,ended_at:end,actualParticipants:n,history,network,latencyP95:quantile(network.latencies,.95),inBps:network.bytesIn/(end-start),outBps:network.bytesOut/(end-start),expectedDeliveries:network.actualSent*(n-1),nominalDeliveries:n*(n-1)*20*(end-start),uncompressedNumericPayloadBps:n*(n-1)*20*392,node:{cpuCorePct:(used.user+used.system)/1e6/(end-start)*100,memoryBefore:memory,memoryAfter:process.memoryUsage()},system_samples:systemWindow(start,end)};
        appendFileSync(resolve(out,`${mode}-raw.jsonl`),JSON.stringify(row)+'\n');console.log('END',id,row.status,network.received,'p95',row.latencyP95);
      } finally {const cleanup=await bots.close();appendFileSync(resolve(out,'transport-cleanup.jsonl'),JSON.stringify({id,...cleanup})+'\n');assert.ok(cleanup.allClosed,'Producer WebSockets did not close.');await waitForQuiescence(spec.roomId,id);}
    }
  } else if(mode==='render'||mode==='dry'||mode==='active') {
    const chrome=await browserCode('async(page)=>{const c=await page.context().browser().newBrowserCDPSession();const p=(await c.send("SystemInfo.getProcessInfo")).processInfo;const info=await c.send("SystemInfo.getInfo");await c.detach();return {processes:p,info};}','browser-hardware.js');
    writeFileSync(resolve(out,'browser-hardware.json'),JSON.stringify(chrome,null,2));
    const browserPid=chrome.processes.find(p=>p.type==='browser')?.id;
    const cases=mode==='active'?[{profile:'desktop',size:10,models:'shared',n:10,roomId:rooms[10],coload:'empty',motion:'all-joints'}]:filter?caseList.filter(c=>key(c).includes(filter)):caseList;
    const raw=resolve(out,'render-raw.jsonl'), completed=existsSync(raw)?readFileSync(raw,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const measure=readFileSync(resolve(import.meta.dirname,'avatar-measure-case.js'),'utf8');
    for(const repeat of ['dry','active'].includes(mode)?[0]:[1,2])for(const spec0 of repeat===2?[...cases].reverse():cases) {
      const spec={...spec0,id:key(spec0)+(mode==='active'?'-all-joints':'')+`-r${repeat}`,repeat,origin,warmupMs:2000,durationMs:6000,width:spec0.profile==='desktop'?1440:390,height:spec0.profile==='desktop'?900:844};
      if(mode==='dry'&&spec0!==cases[0])break;
      if(completed.some(r=>r.id===spec.id&&r.status==='ok'&&sameFrozenSource(r.source,source)))continue;
      console.log('START',spec.id);
      const roomCase=manifest.cases.find(c=>c.room_id===spec.roomId);spec.elementCount=roomCase.element_count;
      const bots=await producers(spec);spec.producers=bots.clients.map(c=>({id:c.visitorId,profile:c.profile}));
      try {
        assert.deepEqual(bots.clients[0].initialUsers,[],'Old participants remain before the render trial');
        writeFileSync(resolve(out,'monitor-targets.json'),JSON.stringify({case:spec.id,phase:'render',browser_root_pid:browserPid,server_pids:[Number(process.env.AVATAR_SERVER_PID)],generator_pid:process.pid}));
        bots.reset();const start=Date.now()/1000,cpu=process.cpuUsage(),memory=process.memoryUsage();
        const row=await browserCode(`async(page)=>{return (${measure})(page,${JSON.stringify(spec)});}`);
        const used=process.cpuUsage(cpu),end=Date.now()/1000;row.source=source;row.id=spec.id;row.botNetworkWindow={start,end,...bots.snapshot()};row.node={cpuCorePct:(used.user+used.system)/1e6/(end-start)*100,memoryBefore:memory,memoryAfter:process.memoryUsage()};
        row.system_samples=systemWindow(row.started_at,row.ended_at);row.gpu_process_memory=await gpuSnapshot(row.processes_after.map(p=>p.id));
        if(['dry','active'].includes(mode))writeFileSync(resolve(out,mode==='active'?'active-joints-diagnostic.json':'dry-render.json'),JSON.stringify(row,null,2));else appendFileSync(raw,JSON.stringify(row)+'\n');
        console.log('END',spec.id,row.status,'fps',row.fps,'poseP95',row.poseP95,'ownerP95',row.ownerP95);
        if(row.status!=='ok')throw Error(JSON.stringify({errors:row.errors,failures:row.failures,readiness:row.readiness}));
      }finally{await browserCode('async(page)=>{await page.goto("about:blank");return {closedObserver:true};}');const cleanup=await bots.close();appendFileSync(resolve(out,'transport-cleanup.jsonl'),JSON.stringify({id:spec.id,...cleanup})+'\n');assert.ok(cleanup.allClosed,'Producer WebSockets did not close.');await waitForQuiescence(spec.roomId,spec.id);}
    }
  }else throw Error('Use selfcheck, dry, render, or fanout.');
}
}
