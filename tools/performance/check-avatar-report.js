async function checkAvatarReport(page) {
  const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:8099/'))external.push(r.url());});
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8099/avatar-evaluation.html',{waitUntil:'load',timeout:90000});
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===74);
  const initial=await page.evaluate(()=>({rows:document.querySelectorAll('#rows tr').length,overflow:document.documentElement.scrollWidth>innerWidth,coverage:JSON.parse(document.getElementById('data').textContent).coverage}));
  await page.screenshot({path:'C:/dev/multi_display_artworks/output/playwright/avatar-evaluation/report-desktop.png'});
  await page.locator('#profile').selectOption('pc-390-4x');await page.locator('#models').selectOption('shared');await page.locator('#coload').selectOption('splat');
  const filtered=await page.locator('#rows tr').count();if(filtered!==2)throw Error('Filter mismatch');
  const downloaded=page.waitForEvent('download');await page.locator('#export').click();await (await downloaded).saveAs('C:/dev/multi_display_artworks/output/playwright/avatar-evaluation/report-export.json');
  const media=await page.locator('#media img').first().evaluate(async i=>{await i.decode();return {imageWidth:i.naturalWidth,imageHeight:i.naturalHeight};});
  media.video=await page.locator('video').first().evaluate(async v=>{if(v.readyState<1)await new Promise((resolve,reject)=>{v.addEventListener('loadedmetadata',resolve,{once:true});v.addEventListener('error',reject,{once:true});v.load();});v.muted=true;await v.play();const start=v.currentTime;await new Promise(r=>setTimeout(r,200));v.pause();return {advanced:v.currentTime>start,duration:v.duration,error:v.error?.message??null};});
  if(errors.length||external.length||initial.overflow||!media.video.advanced)throw Error(JSON.stringify({errors,external,initial,media}));
  return {status:'ok',scope:'Brief init/filter/export/one image+one video only; exhaustive/mobile/all-media QA omitted by user request',initial,filtered,media,errors,externalRequests:external,download:'report-export.json'};
}
