async function lifecycle(page,spec){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await page.setViewportSize({width:1440,height:900});
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await page.goto('http://127.0.0.1:8101'+spec.room_path);
  const errors=[];const errorHandler=e=>errors.push(String(e));page.on('pageerror',errorHandler);
  const rows=[];
  for(let cycle=1;cycle<=10;cycle++){
    await page.waitForFunction(()=>document.querySelectorAll('.wall-surface').length===4&&[...document.querySelectorAll('.wall-surface')].every(e=>e.getObject3D('mesh')?.material?.map?.image?.id?.startsWith('design-')),{timeout:30000});
    await page.waitForTimeout(1000);
    await page.getByRole('link',{name:'← 전시 목록',exact:true}).click();
    await page.getByRole('heading',{name:'지금 열려 있는 공간',exact:true}).waitFor();
    await page.waitForTimeout(1000);
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const dom=await page.evaluate(()=>({scenes:document.querySelectorAll('a-scene').length,design_canvases:document.querySelectorAll('canvas[id^="design-"]').length,video_count:document.querySelectorAll('video').length,dom_nodes:document.querySelectorAll('*').length}));
    rows.push({cycle,at:Date.now()/1000,metrics,dom});
    if(cycle<10)await page.getByRole('link',{name:spec.room_name+' 입장',exact:true}).click();
  }
  page.off('pageerror',errorHandler);await cdp.detach();
  return{mode:'10 SPA room/catalog round-trips,4livewalls,1second settle then forcedGC for retained-heap comparison',rows,errors};
}
