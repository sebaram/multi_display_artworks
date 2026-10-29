async function measureCase(page, spec) {
  // Used through playwright-cli run-code. No synthetic renderer replaces the app.
  const cdp = await page.context().newCDPSession(page);
  const browser = await page.context().browser().newBrowserCDPSession();
  const errors = [], failures = [];
  const mediaProperties=[];
  const errorHandler = error => errors.push(String(error));
  const requestHandler = request => failures.push({url:request.url(),error:request.failure()?.errorText});
  page.on('pageerror', errorHandler);
  page.on('requestfailed', requestHandler);
  await cdp.send('Performance.enable');
  try{await cdp.send('Media.enable');cdp.on('Media.playerPropertiesChanged',event=>mediaProperties.push(event))}catch{}
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
  await page.goto('about:blank');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.setViewportSize({width:spec.width,height:spec.height});
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width:spec.width,height:spec.height,deviceScaleFactor:spec.dpr,mobile:!!spec.mobile,
  });
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:spec.cpuRate});
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:!!spec.mobile,maxTouchPoints:5});
  await page.addInitScript(() => {
    window.__perfContextLosses = 0;
    document.addEventListener('webglcontextlost',()=>window.__perfContextLosses++,true);
  });
  await page.bringToFront();
  const navigationStart = Date.now();
  let readiness;
  try {
    await page.goto(spec.origin + spec.room_path,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(expected => {
      const scene=document.querySelector('a-scene');
      if(!scene?.hasLoaded || !scene.renderer || !scene.camera) return false;
      if(document.querySelectorAll('[data-element-id]').length!==expected.element_count)return false;
      const images=[...document.querySelectorAll('.artwork a-image')];
      const models=[...document.querySelectorAll('.artwork [gltf-model]')];
      const splats=[...document.querySelectorAll('.artwork[gaussian_splatting]')];
      if(images.length!==(expected.element_types.image||0)||models.length!==(expected.element_types.gltf||0)||splats.length!==(expected.element_types.gaussian_splat||0))return false;
      if(images.some(el=>!(el.components?.material?.material?.map?.image?.width>0)))return false;
      if(models.some(el=>!el.components?.['gltf-model']?.model))return false;
      if(splats.some(el=>el.components?.gaussian_splatting?.loadedVertexCount!==100000||!el.components.gaussian_splatting.splatMesh))return false;
      if(expected.videoWallCount){
        const videos=[...document.querySelectorAll('a-assets video')];
        if(videos.length!==expected.videoWallCount||videos.some(v=>v.readyState<2||v.paused))return false;
      }
      if(expected.binding_wall_ids?.length){
        if(document.querySelectorAll('.wall-surface').length!==expected.binding_wall_ids.length)return false;
        if([...document.querySelectorAll('.wall-surface')].some(el=>!el.getObject3D('mesh')?.material?.map?.image?.id?.startsWith('design-')))return false;
      }
      return !!document.querySelector('#minimap-canvas');
    },spec,{timeout:120000});
    readiness={ok:true,load_ready_ms:Date.now()-navigationStart};
  } catch(error) {
    const state=await page.evaluate(()=>({text:document.body.innerText.slice(-1200),images:[...document.querySelectorAll('.artwork a-image')].filter(e=>e.components?.material?.material?.map?.image?.width>0).length,models:document.querySelectorAll('.artwork a-gltf-model').length,splats:[...document.querySelectorAll('[gaussian_splatting]')].map(e=>e.components?.gaussian_splatting?.loadedVertexCount)})).catch(()=>null);
    await cdp.detach();await browser.detach();
    page.off('pageerror',errorHandler);page.off('requestfailed',requestHandler);
    return {spec,status:'load_failed',error:String(error),state,errors,failures};
  }
  await page.evaluate(({warmupMs,durationMs,timers})=>{
    const scene=document.querySelector('a-scene'),camera=document.querySelector('#camera');
    const look=camera.components?.['look-controls'];
    const start=performance.now();
    const yaw=()=>{
      const elapsed=performance.now()-start;
      const angle=(elapsed<warmupMs?elapsed/warmupMs:(elapsed-warmupMs)/durationMs)*Math.PI*2;
      if(look?.yawObject)look.yawObject.rotation.y=angle;
      else camera.object3D.rotation.y=angle;
      window.__perfMove=requestAnimationFrame(yaw);
    };
    yaw();
    window.__perfSpec={warmupMs,durationMs,timers};
  },spec);
  // Full yaw warms initially offscreen texture uploads without changing pixel ratio.
  await page.waitForTimeout(spec.warmupMs);
  await cdp.send('HeapProfiler.collectGarbage');
  const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const processesBefore=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
  const startedAt=Date.now()/1000;
  const videoBefore=await page.evaluate(()=>[...document.querySelectorAll('a-assets video')].map(v=>{const q=v.getVideoPlaybackQuality?.();return {time:v.currentTime,total:q?.totalVideoFrames||0,dropped:q?.droppedVideoFrames||0}}));
  const trace=await page.evaluate(async({durationMs,timers})=>{
    const scene=document.querySelector('a-scene'),renderer=scene.renderer,gl=renderer.getContext();
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const ext=timers?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
    const intervals=[],renderCpu=[],gpuMs=[],draws=[],longTasks=[],visibility=[];
    let frames=0,last,raf,query,pending=[],disjoint=0,gpuDisjoint=false;
    const start=performance.now();
    const original=renderer.render;
    const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));
    try{observer.observe({type:'longtask',buffered:false})}catch{}
    renderer.render=function(...args){
      const at=performance.now();
      if(ext){
        gpuDisjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
        if(gpuDisjoint){
          disjoint++;
          for(const q of pending)gl.deleteQuery(q);
          pending=[];
        }
        const remaining=[];
        for(const q of pending){
          if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){
            gpuMs.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
            gl.deleteQuery(q);
          }else remaining.push(q);
        }
        pending=remaining;
      }
      query=null;
      if(ext&&!gpuDisjoint&&frames%12===0&&pending.length<8){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}
      try{return original.apply(this,args)}finally{
        if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query)}
        renderCpu.push(performance.now()-at);frames++;
      }
    };
    const tick=now=>{
      if(last!==undefined)intervals.push(now-last);last=now;
      if(intervals.length%30===0){
        const i=renderer.info;
        draws.push({at:now-start,calls:i.render.calls,triangles:i.render.triangles,points:i.render.points,geometries:i.memory.geometries,textures:i.memory.textures,programs:i.programs?.length});
        visibility.push(document.visibilityState);
      }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    await new Promise(resolve=>setTimeout(resolve,durationMs));
    const elapsed=performance.now()-start;
    renderer.render=original;cancelAnimationFrame(raf);cancelAnimationFrame(window.__perfMove);observer.disconnect();
    for(const q of pending)gl.deleteQuery(q);
    const stats=scene.renderer.info;
    return {elapsed_ms:elapsed,rendered_frames:frames,frame_intervals_ms:intervals,render_submit_cpu_ms:renderCpu,
      gpu_main_scene_ms:gpuMs,gpu_timer_supported:!!ext,gpu_disjoint_samples:disjoint,gpu_disjoint_policy:'discard_all_pending_v2',draw_samples:draws,long_tasks:longTasks,
      visibility,device_pixel_ratio:devicePixelRatio,renderer_pixel_ratio:renderer.getPixelRatio(),drawing_buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],
      renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webgl_version:gl.getParameter(gl.VERSION),
      context_losses:window.__perfContextLosses||0,webgl_context_lost:gl.isContextLost(),dom_nodes:document.querySelectorAll('*').length,
      design_canvas_sizes:[...document.querySelectorAll('canvas[id^="design-"]')].map(c=>[c.width,c.height]),
      videos:[...document.querySelectorAll('a-assets video')].map(v=>{const q=v.getVideoPlaybackQuality?.();return {width:v.videoWidth,height:v.videoHeight,currentTime:v.currentTime,paused:v.paused,ready:v.readyState,total:q?.totalVideoFrames||0,dropped:q?.droppedVideoFrames||0}}),
      final_memory_counts:stats.memory,resource_timings:performance.getEntriesByType('resource').filter(r=>r.name.includes('/scene?')||r.name.includes(':8767')).map(r=>({url:r.name,duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize,decodedBodySize:r.decodedBodySize})),
      xr_presenting:renderer.xr.isPresenting,immersive_vr_supported:await navigator.xr?.isSessionSupported('immersive-vr').catch(()=>false),
    };
  },spec);
  const endedAt=Date.now()/1000;
  const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const processesAfter=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
  if(spec.screenshot){await page.screenshot({path:spec.screenshot,type:'jpeg',quality:82})}
  await cdp.detach();await browser.detach();
  page.off('pageerror',errorHandler);page.off('requestfailed',requestHandler);
  const software=/swiftshader|llvmpipe|software/i.test(trace.renderer);
  const invalid=software||trace.context_losses>0||trace.webgl_context_lost||trace.visibility.some(v=>v!=='visible')||trace.rendered_frames<2;
  return {spec,status:invalid?'invalid':'ok',readiness,started_at:startedAt,ended_at:endedAt,before,after,processes_before:processesBefore,processes_after:processesAfter,video_before:videoBefore,media_properties:mediaProperties,trace,errors,failures};
}
