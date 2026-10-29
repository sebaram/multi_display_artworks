async function measureOptimization(page, spec) {
  const cdp = await page.context().newCDPSession(page);
  const browser = await page.context().browser().newBrowserCDPSession();
  const errors = [], failures = [];
  const errorHandler = error => errors.push(String(error));
  const requestHandler = request => failures.push({url:request.url(), error:request.failure()?.errorText});
  page.on('pageerror', errorHandler); page.on('requestfailed', requestHandler);
  try {
    if (!page.__optimizationInitInstalled) {
      page.__optimizationInitInstalled=true;
      await page.addInitScript(()=>{window.__optimizationContextLosses=0;document.addEventListener('webglcontextlost',()=>window.__optimizationContextLosses++,true);});
    }
    await cdp.send('Performance.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
    await page.goto('about:blank');
    await cdp.send('HeapProfiler.collectGarbage');
    await page.setViewportSize({width:spec.width,height:spec.height});
    await cdp.send('Emulation.setDeviceMetricsOverride', {width:spec.width,height:spec.height,deviceScaleFactor:1,mobile:spec.profile==='mobile-stress'});
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:spec.profile==='mobile-stress'?4:1});
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:spec.profile==='mobile-stress',maxTouchPoints:5});
    await page.bringToFront();
    const loadStart = Date.now();
    await page.goto(spec.origin+spec.room_path, {waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(count => {
      const scene=document.querySelector('a-scene');
      if(!scene?.hasLoaded||!scene.renderer||!scene.camera||document.querySelectorAll('[data-element-id]').length!==count)return false;
      if(scene.galleryPerformance) {
        return [...document.querySelectorAll('.resident-artwork')].every(el=> {
          if(el.dataset.elementType==='gaussian_splat')return el.components?.gaussian_splatting?.loadedVertexCount>0;
          return el.querySelector('[data-loaded="true"]');
        });
      }
      return [...document.querySelectorAll('.artwork a-image')].every(el=>el.components?.material?.material?.map?.image?.width>0)
        && [...document.querySelectorAll('.artwork [gltf-model]')].every(el=>el.components?.['gltf-model']?.model)
        && [...document.querySelectorAll('.artwork[gaussian_splatting]')].every(el=>el.components?.gaussian_splatting?.loadedVertexCount>0);
    },spec.element_count,{timeout:90000});
    const loadReadyMs=Date.now()-loadStart;
    await page.evaluate(spec=> {
      const scene=document.querySelector('a-scene');
      if(spec.variant==='optimized-fixed')scene.galleryPerformance.setFixedQuality(0);
      // One main-scene buffer in every fixed comparison; LOD remains part of the change.
      scene.renderer.setPixelRatio(1);
      const camera=document.querySelector('#camera'),look=camera.components?.['look-controls'];
      window.__optimizationCamera={look,camera};
      const setAngle=angle=>{if(look?.yawObject)look.yawObject.rotation.y=angle;else camera.object3D.rotation.y=angle;};
      window.__optimizationSetAngle=setAngle;
      const begin=performance.now();
      const yaw=()=>{setAngle((performance.now()-begin)/spec.warmupMs*Math.PI*2);window.__optimizationMove=requestAnimationFrame(yaw);};
      yaw();
    },spec);
    await page.waitForTimeout(spec.warmupMs);
    await page.evaluate(()=>{cancelAnimationFrame(window.__optimizationMove);window.__optimizationSetAngle(0);});
    await page.waitForTimeout(spec.stationary?5000:500);
    await cdp.send('HeapProfiler.collectGarbage');
    const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
    const processesBefore=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
    const startedAt=Date.now()/1000;
    const trace=await page.evaluate(async spec=> {
      const scene=document.querySelector('a-scene'),renderer=scene.renderer,gl=renderer.getContext();
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      const original=renderer.render;
      const intervals=[], samples=[], visibility=[];
      let frames=0,last,raf;
      renderer.render=function(...args){
        const main=args[0]===scene.object3D;
        const result=original.apply(this,args);
        if(main) {
          const now=performance.now(); if(last!==undefined)intervals.push(now-last);last=now;frames++;
          if(frames%10===0) {
            const state=scene.galleryPerformance;
            samples.push({at:now,draw_calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
              textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,
              resident_artworks:state?.residentArtworks,wall_rendered:state?.wallsRendered,wall_skipped:state?.wallsSkipped,
              level:state?.level,settings:state?.settings,
              image_lod:[...document.querySelectorAll('.image-source')].map(el=>{const image=el.getObject3D('mesh')?.material?.map?.image;return image?[image.width,image.height]:null;}).filter(Boolean),
              splat_stats:scene.components['gaussian-splatting-system']?.statistics});
          }
        }
        return result;
      };
      const visibilityHandler=()=>visibility.push(document.visibilityState);
      document.addEventListener('visibilitychange',visibilityHandler);
      const start=performance.now();
      const yaw=()=>{if(!spec.stationary)window.__optimizationSetAngle((performance.now()-start)/spec.durationMs*Math.PI*2);raf=requestAnimationFrame(yaw);};
      yaw();
      await new Promise(resolve=>setTimeout(resolve,spec.durationMs));
      const elapsed=performance.now()-start;
      renderer.render=original;cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',visibilityHandler);
      const buffer={width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
      const info=renderer.info;
      return {frames,elapsed_ms:elapsed,intervals,samples,visibility,buffer,
        wall_sources:[...document.querySelectorAll('canvas[id^="design-"]')].map(canvas=>({width:canvas.width,height:canvas.height})),
        renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
        webgl_context_lost:gl.isContextLost(),context_losses:window.__optimizationContextLosses||0,textures:info.memory.textures,geometries:info.memory.geometries,
        root_count:document.querySelectorAll('[data-element-id]').length,
        pending_residents:[...document.querySelectorAll('.resident-artwork')].filter(el=>el.dataset.elementType==='gaussian_splat'?!el.components?.gaussian_splatting?.loadedVertexCount:!el.querySelector('[data-loaded="true"]')).map(el=>el.dataset.elementId),
        aframe:window.AFRAME.version,three:window.AFRAME.THREE.REVISION,
        image_lod_stats:samples.length?samples.at(-1).image_lod:[],
        splat_stats:scene.components['gaussian-splatting-system']?.statistics,
        performance:scene.galleryPerformance?JSON.parse(JSON.stringify(scene.galleryPerformance)):null};
    },spec);
    const endedAt=Date.now()/1000;
    const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));
    const processesAfter=(await browser.send('SystemInfo.getProcessInfo')).processInfo;
    if(spec.screenshot)await page.screenshot({path:spec.screenshot,type:'jpeg',quality:82});
    const quantile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;};
    const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
    const oldCpu=new Map(processesBefore.map(p=>[p.id,p.cpuTime]));
    const cpuSeconds=processesAfter.reduce((sum,p)=>sum+(oldCpu.has(p.id)?Math.max(0,p.cpuTime-oldCpu.get(p.id)):0),0);
    const counterSeconds=after.Timestamp-before.Timestamp;
    const processSetsEqual=JSON.stringify(processesBefore.map(p=>p.id).sort())===JSON.stringify(processesAfter.map(p=>p.id).sort());
    const unexpected=failures.filter(f=>!/ERR_ABORTED/.test(f.error||''));
    const invalid=/SwiftShader|software|llvmpipe/i.test(trace.renderer)||trace.webgl_context_lost||trace.context_losses||trace.visibility.includes('hidden')||trace.frames<2||errors.length||unexpected.length||!processSetsEqual;
    return {source_commit:spec.source_commit,variant:spec.variant,profile:spec.profile,workload:spec.workload,repeat:spec.repeat,status:invalid?'invalid':'ok',
      fps:trace.frames*1000/trace.elapsed_ms,p95_ms:quantile(trace.intervals,.95),p99_ms:quantile(trace.intervals,.99),
      cpu_core_pct:cpuSeconds/counterSeconds*100,js_heap_mib:after.JSHeapUsedSize/1048576,
      draw_calls:mean(trace.samples.map(s=>s.draw_calls)),triangles:mean(trace.samples.map(s=>s.triangles)),
      wall_rendered_mean:mean(trace.samples.map(s=>s.wall_rendered).filter(Number.isFinite)),wall_skipped_mean:mean(trace.samples.map(s=>s.wall_skipped).filter(Number.isFinite)),
      resident_artworks:trace.performance?.residentArtworks,textures:trace.textures,geometries:trace.geometries,
      buffer:trace.buffer,wall_sources:trace.wall_sources,image_lod_stats:trace.image_lod_stats,splat_stats:trace.splat_stats,
      load_ready_ms:loadReadyMs,
      errors,failures,started_at:startedAt,ended_at:endedAt,before,after,cpu_counter_seconds:counterSeconds,cpu_process_sets_equal:processSetsEqual,processes_before:processesBefore,processes_after:processesAfter,trace,spec};
  } finally {
    page.off('pageerror',errorHandler);page.off('requestfailed',requestHandler);
    await cdp.detach();await browser.detach();
  }
}
