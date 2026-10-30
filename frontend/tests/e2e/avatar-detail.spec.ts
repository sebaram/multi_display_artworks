import {test,expect,Page} from '@playwright/test';
const room=process.env.AVATAR_TRACKING_ROOM || 'aabbccddeeff00112233aa01';
async function enter(page:Page) {
  await page.goto(`/room?room_id=${room}`);
  await expect(page.getByRole('button',{name:'Visitor',exact:true})).toBeVisible({timeout:20000});
  return page.evaluate(()=>JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')!));
}
async function customize(page:Page,color:string) {
  await page.getByRole('button',{name:'Visitor',exact:true}).click();
  await page.getByRole('button',{name:'Customize',exact:true}).click();
  await page.getByLabel('Avatar preset',{exact:true}).selectOption('casual');
  await page.getByLabel('top color',{exact:true}).fill(color);
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'My avatar'})).toHaveCount(0);
}
async function position(page:Page,x:number,z:number,yaw=0) {
  await page.locator('#camera').evaluate((el:any,p:any)=>{
    el.object3D.position.set(p.x,1.64,p.z);
    el.object3D.rotation.set(0,p.yaw,0);
    const look=el.components['look-controls'];if(look){look.yawObject.rotation.y=p.yaw;look.pitchObject.rotation.x=0;}
    el.emit('avatar-teleport');
  },{x,z,yaw});
}
test('moving hidden peer restores newest appearance and joints, near/far meshes switch, SPA reentry releases old avatars',async({page,context})=>{
  test.setTimeout(90000);
  const actor=await context.newPage();const who=await enter(actor);await customize(actor,'#ff6633');
  await enter(page);await position(page,0,6);await position(actor,0,12,Math.PI);
  const peer=()=>page.locator(`#camera-${who.visitorId} .remote-avatar`);
  await expect.poll(()=>peer().evaluate((el:any)=>el.avatarInstance?.root.visible)).toBe(false);
  const hiddenBones=await peer().evaluate((el:any)=>el.avatarInstance.root.getObjectByName('head').quaternion.toArray());
  await customize(actor,'#2266ff');await position(actor,2,13,Math.PI/2);
  await page.waitForTimeout(350);
  expect(await peer().evaluate((el:any)=>el.avatarInstance.root.getObjectByName('head').quaternion.toArray())).toEqual(hiddenBones);
  await position(actor,1,1,Math.PI);
  await expect.poll(()=>peer().evaluate((el:any)=>el.avatarInstance?.root.visible)).toBe(true);
  await expect.poll(()=>peer().evaluate((el:any)=>el.avatarInstance.root.position.x)).toBeCloseTo(1,1);
  expect(await peer().evaluate((el:any)=>el.avatarInstance.root.getObjectByName('Body').material.userData.avatarColors.top.value.getHexString())).toBe('2266ff');
  await page.screenshot({path:'../output/playwright/avatar-evaluation/after-lod-near.png'});
  // Observer outside the room bound is a controlled display test; owner inputs remain untouched.
  await page.locator('#camera').evaluate((el:any)=>el.removeAttribute('boundary-clamp'));
  await position(page,0,45);
  await expect.poll(()=>peer().evaluate((el:any)=>el.avatarInstance.root.getObjectByName('BodyLow').visible)).toBe(true);
  expect(await peer().evaluate((el:any)=>el.avatarInstance.root.getObjectByName('Body').visible)).toBe(false);
  for(let i=0;i<2;i++) {
    await peer().evaluate((el:any)=>{(window as any).__oldAvatar=el.avatarInstance;});
    await page.evaluate(()=>{history.pushState({},'', '/');dispatchEvent(new PopStateEvent('popstate'));});
    await expect(page.locator('a-scene')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).__oldAvatar.root.parent)).toBeNull();
    await page.evaluate((id)=>{history.pushState({},'',`/room?room_id=${id}`);dispatchEvent(new PopStateEvent('popstate'));},room);
    await expect(page.getByRole('button',{name:'Visitor',exact:true})).toBeVisible();
    await expect.poll(()=>peer().evaluate((el:any)=>!!el.avatarInstance)).toBe(true);
  }
  await actor.close();await expect(peer()).toHaveCount(0);
});
