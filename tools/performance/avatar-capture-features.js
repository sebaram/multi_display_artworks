async page => {
  const dir='C:/dev/multi_display_artworks/output/playwright/avatar-evaluation';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:900},recordVideo:{dir:dir+'/raw-final-features',size:{width:1440,height:900}}});
  const url='http://127.0.0.1:8000/room?room_id=aabbccddeeff00112233aa01', actors=[],errors=[];
  for(const [i,preset] of ['casual','sporty','explorer','humanoid-robot'].entries()) {
    const actor=await context.newPage();actor.on('pageerror',e=>errors.push(e.message));await actor.goto(url);
    await actor.getByRole('button',{name:'Visitor',exact:true}).click();await actor.getByRole('button',{name:'Edit',exact:true}).click();
    await actor.locator('#profile-display-name').fill(preset);await actor.getByRole('button',{name:'Save',exact:true}).click();
    await actor.getByRole('button',{name:'Visitor',exact:true}).click();await actor.getByRole('button',{name:'Customize',exact:true}).click();
    await actor.getByLabel('Avatar preset',{exact:true}).selectOption(preset);
    if(i===0){
      await actor.waitForTimeout(800);await actor.screenshot({path:dir+'/after-final-editor.png'});
      await actor.getByRole('button',{name:'Apply',exact:true}).scrollIntoViewIfNeeded();await actor.screenshot({path:dir+'/after-final-editor-actions.png'});
      await actor.setViewportSize({width:390,height:844});await actor.getByLabel('Avatar preset',{exact:true}).scrollIntoViewIfNeeded();await actor.screenshot({path:dir+'/after-final-editor-mobile.png'});
      await actor.setViewportSize({width:1440,height:900});
    }
    await actor.getByRole('button',{name:'Apply',exact:true}).click();await actor.getByRole('dialog',{name:'My avatar'}).waitFor({state:'detached'});
    await actor.locator('#camera').evaluate((c,i)=>{c.object3D.position.set(-1.8+i*1.2,1.64,-2);c.components['look-controls'].yawObject.rotation.y=Math.PI;c.emit('avatar-teleport');},i);
    actors.push(actor);
  }
  const observer=await context.newPage();observer.on('pageerror',e=>errors.push(e.message));await observer.goto(url);
  await observer.getByRole('button',{name:'Visitor',exact:true}).waitFor();
  await observer.locator('#camera').evaluate(c=>{c.object3D.position.set(0,1.64,2.3);c.components['look-controls'].yawObject.rotation.y=0;c.emit('avatar-teleport');});
  await observer.waitForFunction(()=>[...document.querySelectorAll('.remote-avatar')].filter(el=>el.avatarInstance).length===4);
  await observer.bringToFront();await observer.waitForTimeout(1500);await observer.screenshot({path:dir+'/after-final-presets.png'});
  const actor=actors[0];await actor.locator('#camera').evaluate(c=>{c.object3D.position.set(-1.8,1.64,-.6);c.emit('avatar-teleport');});
  await actor.evaluate(()=>{const c=document.querySelector('#camera');let start=performance.now();window.__walk=setInterval(()=>{c.object3D.position.x=-1.8+Math.min(3.6,(performance.now()-start)/1400);},30);});
  await observer.waitForTimeout(4800);await actor.evaluate(()=>clearInterval(window.__walk));
  await observer.screenshot({path:dir+'/after-final-walk.png'});
  const video=observer.video();await observer.close();await video.saveAs(dir+'/after-final-walk.webm');
  for(const actor of actors)await actor.close();await context.close();
  return {errors,label:'Final frozen product, actual scene and four Socket.IO actors; scripted desktop movement, no physical XR',media:['after-final-editor.png','after-final-presets.png','after-final-walk.webm']};
}
