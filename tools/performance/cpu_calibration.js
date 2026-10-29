async function calibrate(page,roomPath){
  const cdp=await page.context().newCDPSession(page),results=[];
  try{
    for(const rate of [1,4,1,4]){
      await page.goto('about:blank');
      await cdp.send('Emulation.setCPUThrottlingRate',{rate});
      await page.goto('http://127.0.0.1:8101'+roomPath);
      await page.waitForFunction(()=>document.querySelector('a-scene')?.hasLoaded);
      const sample=await page.evaluate(iterations=>{
        let total=0;const start=performance.now();
        for(let i=0;i<iterations;i++)total=(total+(i^(i>>>4)))|0;
        return{iterations,checksum:total,elapsed_ms:performance.now()-start};
      },120000000);
      results.push({rate,...sample});
    }
  }finally{await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach()}
  const average=rate=>results.filter(r=>r.rate===rate).reduce((s,r)=>s+r.elapsed_ms,0)/2;
  return{procedure:'same CPU arithmetic loop; rate set before full app navigation; alternating1x/4x;2repeats',results,slowdown_ratio:average(4)/average(1),checksums_match:results.every(r=>r.checksum===results[0].checksum)};
}
