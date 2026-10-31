async function measureAvatar(page, spec) {
  const cdp=await page.context().newCDPSession(page), browser=await page.context().browser().newBrowserCDPSession();
  const errors=[],failures=[],network={received:0,sent:0,messagesReceived:0,messagesSent:0,poseHeaderLatencies:[],poseServerArrivalAges:[],webSocketClosures:0};
  const error=e=>errors.push(String(e)),failed=r=>failures.push({url:r.url(),error:r.failure()?.errorText});
  page.on('pageerror',error);page.on('requestfailed',failed);
  let measuring=false,phase='start';
  const bytes=frame=>frame.opcode===2?Buffer.from(frame.payloadData,'base64').byteLength:Buffer.byteLength(frame.payloadData);
  cdp.on('Network.webSocketFrameReceived',e=>{if(measuring){network.received+=bytes(e.response);network.messagesReceived++;
    if(e.response.opcode===1){const data=e.response.payloadData;const start=data.indexOf('[');if(start>=0)try{const [event,value]=JSON.parse(data.slice(start));if(event==='avatar_pose'&&spec.producers.some(p=>p.id===value.userId)){const now=Date.now();network.poseHeaderLatencies.push(now-value.pose.sampleTime);if(Number.isFinite(value.serverTime))network.poseServerArrivalAges.push(now-value.serverTime);}}catch{}}
  }});
  cdp.on('Network.webSocketClosed',()=>{if(measuring)network.webSocketClosures++;});
  cdp.on('Network.webSocketFrameSent',e=>{if(measuring){network.sent+=bytes(e.response);network.messagesSent++;}});
  try {
    await cdp.send('Performance.enable');await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:spec.profile==='pc-390-4x'?4:1});
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:spec.width,height:spec.height,deviceScaleFactor:1,mobile:spec.profile==='pc-390-4x'});
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:spec.profile==='pc-390-4x',maxTouchPoints:5});
    await page.setViewportSize({width:spec.width,height:spec.height});await page.bringToFront();
    const load=Date.now();await page.goto(spec.origin+`/room?room_id=${spec.roomId}`,{waitUntil:'domcontentloaded',timeout:90000});
    phase='owner';await page.getByRole('button',{name:'Visitor',exact:true}).waitFor({timeout:30000});
    if(!await page.evaluate(()=>document.querySelector('a-scene')?.object3D.getObjectByName('avatar-owner'))) {
      // Establish the observer through the real public editor and signed-owner save flow.
      await page.getByRole('button',{name:'Visitor',exact:true}).click();
      await page.getByRole('button',{name:'Customize',exact:true}).click();
      await page.getByLabel('Avatar preset',{exact:true}).selectOption('casual');
      await page.getByRole('button',{name:'Apply',exact:true}).click();
      await page.getByRole('dialog',{name:'My avatar'}).waitFor({state:'detached'});
    }
    phase='avatars';await page.waitForFunction(spec=>{
      const s=document.querySelector('a-scene');
      if(!s?.renderer||!s.avatarPerformance||!s.object3D.getObjectByName('avatar-owner')||document.querySelectorAll('[data-element-id]').length!==spec.elementCount||document.querySelectorAll('[id^="camera-"]').length!==spec.producers.length)return false;
      return spec.producers.every(p=>{const el=document.querySelector(`#camera-${p.id} .remote-avatar`);if(p.profile.avatarId==='none')return !!document.getElementById(`camera-${p.id}`);if(!el)return false;if(p.profile.appearance)return !!el.avatarInstance;if(p.profile.avatarId==='robot')return !!el.querySelector('a-box')?.getObject3D('mesh');return !!el.components?.['gltf-model']?.model;});
    },spec,{timeout:90000});
    await page.evaluate(spec=>{
      const s=document.querySelector('a-scene'),camera=document.querySelector('#camera'),look=camera.components['look-controls'];
      s.galleryPerformance.setFixedQuality(0);camera.object3D.position.set(0,1.64,spec.size*.45);
      camera.emit('avatar-teleport');
      window.__avatarSetYaw=angle=>{look.yawObject.rotation.y=angle;look.pitchObject.rotation.x=0;};
      window.__avatarSetYaw(0);
      const start=performance.now();const warm=()=>{window.__avatarSetYaw((performance.now()-start)/spec.warmupMs*Math.PI*2);window.__avatarWarm=requestAnimationFrame(warm);};warm();
    },spec);
    await page.waitForTimeout(spec.warmupMs);
    await page.evaluate(()=>{cancelAnimationFrame(window.__avatarWarm);window.__avatarSetYaw(0);});
    phase='artworks';await page.waitForFunction(()=>[...document.querySelectorAll('.resident-artwork')].every(el=>el.dataset.elementType==='gaussian_splat'?el.components?.gaussian_splatting?.loadedVertexCount>0:el.querySelector('[data-loaded="true"]')),undefined,{timeout:60000});
    await page.waitForTimeout(1000);
    await cdp.send('HeapProfiler.collectGarbage');
    const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
    const processBefore=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
    const started_at=Date.now()/1000;measuring=true;phase='timing';
    const trace=await page.evaluate(async spec=>{
      const scene=document.querySelector('a-scene'),renderer=scene.renderer,gl=renderer.getContext(),original=renderer.render;
      const samples=[],intervals=[],visibility=[];let last,frames=0;
      const changed=()=>visibility.push(document.visibilityState);document.addEventListener('visibilitychange',changed);
      renderer.render=function(...args){
        const result=original.apply(this,args);
        if(args[0]===scene.object3D){const now=performance.now();if(last!==undefined)intervals.push(now-last);last=now;frames++;
          samples.push({at:now,...scene.avatarPerformance,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}
        return result;
      };
      const start=performance.now();await new Promise(resolve=>setTimeout(resolve,spec.durationMs));const elapsed=performance.now()-start;
      renderer.render=original;document.removeEventListener('visibilitychange',changed);
      const T=window.AFRAME.THREE,camera=scene.camera.getWorldPosition(new T.Vector3());
      const avatars=spec.producers.map(p=>{const el=document.querySelector(`#camera-${p.id} .remote-avatar`),root=el?.avatarInstance?.root||el?.object3D;return {id:p.id,exists:!!document.getElementById(`camera-${p.id}`),model:p.profile.avatarId,humanoid:!!el?.avatarInstance,visible:root?.visible??false,distance:root?.getWorldPosition(new T.Vector3()).distanceTo(camera)??null,fallback:el?.dataset.avatarFallback??false,low:!!root?.getObjectByName('BodyLow')?.visible};});
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      return {frames,elapsed,intervals,samples,visibility,avatars,quality:JSON.parse(JSON.stringify(scene.galleryPerformance)),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],contextLost:gl.isContextLost(),textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,ownerVisible:scene.object3D.getObjectByName('avatar-owner').visible,
        residentArtworks:document.querySelectorAll('.resident-artwork').length,splat:scene.components['gaussian-splatting-system']?.statistics??null};
    },spec);
    measuring=false;const ended_at=Date.now()/1000;
    const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
    const processes_after=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
    const q=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)]??null;};
    const cpu=new Map(processBefore.map(p=>[p.id,p.cpuTime]));const elapsed=after.Timestamp-before.Timestamp;
    const cpuProcessSetsEqual=JSON.stringify(processBefore.map(p=>p.id).sort())===JSON.stringify(processes_after.map(p=>p.id).sort());
    const unexpected=failures.filter(f=>!f.error?.includes('ERR_ABORTED'));
    const expectedHumanoids=spec.producers.filter(p=>p.profile.appearance).length;
    const rosterStable=trace.samples.every(s=>s.full+s.low+s.hidden===expectedHumanoids);
    const invalid=errors.length||unexpected.length||trace.contextLost||/SwiftShader|software|llvmpipe/i.test(trace.renderer)||trace.visibility.includes('hidden')||trace.avatars.some(a=>a.fallback||!a.exists)||trace.ownerVisible!==false||trace.frames<2||!rosterStable;
    trace.rosterStable=rosterStable;
    trace.motion={remote:spec.motion==='all-joints'?'22 rotating joints including head':'4 rotating limb joints; head/root static',owner:'desktop idle after yaw warmup; no tracked arms',actualSocketParticipants:spec.n+1,localOwners:1};
    if(spec.repeat<=1)await page.screenshot({path:`${spec.screenshotDir||'C:/dev/multi_display_artworks/output/playwright/avatar-evaluation'}/${spec.id}.jpg`,type:'jpeg',quality:80});
    const {owner,...publicSpec}=spec; // A signed visitor capability is never evidence/export data.
    return {spec:publicSpec,status:invalid?'invalid':'ok',started_at,ended_at,loadReadyMs:(started_at*1000-load),fps:trace.frames*1000/trace.elapsed,p95Ms:q(trace.intervals,.95),ownerP95:q(trace.samples.map(s=>s.ownerMs),.95),poseP95:q(trace.samples.map(s=>s.poseMs),.95),poseActiveP95:q(trace.samples.filter(s=>s.applied>0).map(s=>s.poseMs),.95),remoteTotalP95:q(trace.samples.map(s=>s.remoteMs),.95),drawCalls:q(trace.samples.map(s=>s.drawCalls),.5),cpuProcessSetsEqual,chromeCpuCorePct:cpuProcessSetsEqual?processes_after.reduce((sum,p)=>sum+(cpu.has(p.id)?Math.max(0,p.cpuTime-cpu.get(p.id)):0),0)/elapsed*100:null,threadCpuCorePct:(after.ThreadTime-before.ThreadTime)/elapsed*100,jsHeapMiB:after.JSHeapUsedSize/1048576,network,networkInBps:network.received/(ended_at-started_at),networkOutBps:network.sent/(ended_at-started_at),errors,failures,before,after,processes_before:processBefore,processes_after,trace};
  }catch(error){
    return {spec,status:'setup_error',error:String(error),phase,errors,failures,processes_after:(await browser.send('SystemInfo.getProcessInfo')).processInfo,readiness:await page.evaluate(spec=>({url:location.href,owner:!!document.querySelector('a-scene')?.object3D?.getObjectByName('avatar-owner'),artworks:document.querySelectorAll('[data-element-id]').length,expected:spec.producers.map(p=>({id:p.id,exists:!!document.querySelector('#camera-'+p.id),avatar:!!document.querySelector('#camera-'+p.id+' .remote-avatar')?.avatarInstance,fallback:document.querySelector('#camera-'+p.id+' .remote-avatar')?.dataset.avatarFallback})),text:document.body.innerText.slice(0,500)}),spec)};
  }finally{page.off('pageerror',error);page.off('requestfailed',failed);await cdp.detach();await browser.detach();}
}
