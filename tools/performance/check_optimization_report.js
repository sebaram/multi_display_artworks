async function checkOptimizationReport(page, spec) {
  await page.goto('about:blank');
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [], requests = [];
  const onError = error => errors.push(error.message);
  const onRequest = request => { if (/^https?:/.test(request.url())) requests.push(request.url()); };
  page.on('pageerror', onError);
  page.on('request', onRequest);
  try {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:1});
  await cdp.send('Emulation.setTouchEmulationEnabled', {enabled:false});
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewportSize({width:1440,height:900});
  await page.goto(spec.url, {waitUntil:'load'});
  const initial = await page.evaluate(async () => {
    const data = JSON.parse(document.getElementById('comparison-data').textContent);
    const images = [...document.querySelectorAll('#gallery img')];
    await Promise.all(images.map(async image => { image.loading='eager'; await image.decode(); }));
    return {trials:data.trials.length, rows:document.querySelectorAll('#comparison-body tr').length,
      images:images.length, allDecoded:images.every(image=>image.naturalWidth>0),
      documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,
      sourceRevisions:data.metadata.optimized_source_revisions,
      assessment:document.getElementById('evaluation-summary').textContent,
      checks:document.getElementById('check-summary').textContent};
  });
  assert(initial.trials===46&&initial.rows===23, 'Expected 46 trials and 23 groups');
  assert(initial.images===25&&initial.allDecoded, 'All 25 embedded screenshots must decode');
  assert(initial.documentWidth<=initial.viewport, 'Desktop overflow');
  assert(initial.sourceRevisions.length===1, 'All optimized trials must use the final revision');
  assert(initial.assessment.includes('남은 병목'), 'Remaining performance bottleneck must be visible');
  await page.selectOption('#profile-filter','mobile-stress');
  const mobileGroups=await page.locator('#comparison-body tr').count();
  assert(mobileGroups===8, 'Mobile filter must show 8 groups');
  await page.selectOption('#workload-filter','mixed-L30-N300');
  assert(await page.locator('#comparison-body tr').count()===2, 'Mixed paired comparison');
  await page.locator('#comparison-body .row-button').first().click();
  assert(await page.locator('#case-detail').isVisible(), 'Case details must open');
  assert((await page.locator('#case-detail').textContent()).includes('끝 시점 로딩 중'), 'Pending asset snapshot must be visible');
  await page.click('#reset');
  await page.fill('#search','no-such-gallery-case');
  assert(await page.locator('#comparison-body .empty').count()===1, 'Empty search state');
  await page.click('#reset');
  await page.locator('#gallery [data-shot]').first().click();
  assert(await page.locator('#zoom').isVisible(), 'Image zoom must open');
  await page.keyboard.press('Escape');
  assert(!await page.locator('#zoom').isVisible(), 'Escape must close zoom');
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:spec.desktopScreenshot});
  await page.setViewportSize({width:390,height:844});
  const mobile = await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
  assert(mobile.documentWidth<=mobile.width, '390px document must not overflow');
  await page.screenshot({path:spec.mobileScreenshot});
  await page.setViewportSize({width:1440,height:900});
  const browser = await page.context().browser().newBrowserCDPSession();
  let download;
  try {
    await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:spec.downloadDirectory});
    const [item] = await Promise.all([page.waitForEvent('download',{timeout:15000}),page.click('#download')]);
    const failure=await item.failure();
    if(failure) download={status:'blocked',failure};
    else { await item.saveAs(spec.downloadPath); download={status:'saved',filename:item.suggestedFilename()}; }
  } finally { await browser.detach(); }
  assert(download?.status==='saved', 'The actual JSON download must complete');
  await cdp.detach();
  assert(errors.length===0, 'Report page errors');
  assert(requests.every(url=>url===spec.url), 'Report must request no external resources');
  return {at:new Date().toISOString(),status:'pass',initial,mobile,mobileGroups,
    filtering:true,emptySearch:true,caseDetails:true,imageZoomAndEscape:true,
    download,requests,errors};
  } finally {
    page.off('pageerror',onError);
    page.off('request',onRequest);
  }
}
