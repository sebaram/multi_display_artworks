// Run through playwright-cli run-code --filename (simulated XR, no headset attached).
async page => {
  const dir='C:/dev/multi_display_artworks/output/playwright/avatar-evaluation';
  const context=await page.context().browser().newContext({viewport:{width:1440,height:900},recordVideo:{dir:dir+'/raw-task5-final',size:{width:1440,height:900}}});
  const actor=await context.newPage(),errors=[];
  actor.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:8000/room?room_id=aabbccddeeff00112233aa01';
  await actor.goto(url);await actor.getByRole('button',{name:'Visitor',exact:true}).click();await actor.getByRole('button',{name:'Customize',exact:true}).click();
  await actor.getByLabel('Avatar preset',{exact:true}).selectOption('casual');await actor.getByLabel('top color',{exact:true}).fill('#327bba');
  await actor.getByRole('button',{name:'Apply',exact:true}).click();await actor.getByRole('dialog',{name:'My avatar'}).waitFor({state:'detached'});
  const id=await actor.evaluate(()=>JSON.parse(sessionStorage.getItem('metamuseum.tab-visitor.v1')).visitorId);
  await actor.locator('#camera').evaluate(c=>{c.setAttribute('position','-.5 1.64 -2');c.components['look-controls'].yawObject.rotation.y=Math.PI;});
  await actor.waitForTimeout(100);
  await actor.evaluate(()=>{
    const scene=document.querySelector('a-scene'),xr=scene.renderer.xr;
    const m=window.avatarXRMock={head:[0,1.64,0],left:[-.32,1.26,-.25],right:[.32,1.26,-.25],lost:false,active:true,endCalls:0,reference:{},original:{getSession:xr.getSession,getFrame:xr.getFrame,getReferenceSpace:xr.getReferenceSpace}};
    const pose=p=>({transform:{position:{x:p[0],y:p[1],z:p[2]},orientation:{x:0,y:0,z:0,w:1}}});
    const session=new EventTarget();session.end=()=>{m.endCalls++};
    Object.defineProperty(session,'inputSources',{get:()=>m.lost?[]:['left','right'].map(side=>({handedness:side,hand:new Map([['wrist',{side}]])}))});
    m.session=session;m.frame={session,getViewerPose:()=>pose(m.head),getJointPose:s=>pose(m[s.side])};
    // Capture the desktop spawn before mirroring the pinned renderer's pose-target write.
    scene.emit('enter-vr');
    window.AFRAME.registerComponent('task5-final-simulated-pose-target',{tick(){const c=document.querySelector('#camera').object3D;if(m.active){c.position.fromArray(m.head);c.quaternion.identity();c.updateMatrix();}}});
    xr.getSession=()=>m.active?session:null;xr.getFrame=()=>m.frame;xr.getReferenceSpace=()=>m.reference;
    scene.setAttribute('task5-final-simulated-pose-target','');
  });
  const observer=await context.newPage();observer.on('pageerror',e=>errors.push(e.message));await observer.goto(url);await observer.getByRole('button',{name:'Visitor',exact:true}).waitFor();
  await observer.locator('#camera').evaluate(c=>{c.setAttribute('position','-.5 1.6 1.8');c.components['look-controls'].yawObject.rotation.y=0;});
  await observer.waitForFunction(id=>document.querySelector('#camera-'+id+' .remote-avatar')?.avatarInstance,id);
  await observer.bringToFront();
  const measure=()=>observer.locator('#camera-'+id+' .remote-avatar').evaluate(e=>{
    const root=e.avatarInstance.root,T=window.AFRAME.THREE;root.updateWorldMatrix(true,true);
    const point=n=>root.getObjectByName(n).getWorldPosition(new T.Vector3()).toArray();
    return {root:root.position.toArray(),scale:root.scale.x,eye:point('HeadAnchor'),left:point('leftHand'),right:point('rightHand'),shoulder:point('leftUpperArm'),foot:point('leftFoot'),hips:point('hips')};
  });
  const samples=[];
  async function capture(state){await observer.waitForTimeout(800);samples.push({state,...await measure()});await observer.screenshot({path:dir+'/task5-final-simulated-xr-'+state+'.png'});}
  await capture('standing-tracked');
  await actor.evaluate(()=>{window.avatarXRMock.lost=true;});await capture('tracking-loss');
  await actor.evaluate(()=>{window.avatarXRMock.lost=false;});await capture('recovered');
  await actor.evaluate(()=>{const m=window.avatarXRMock;m.head[1]=1.05;m.left[1]=.85;m.right[1]=.85;document.querySelector('a-scene').emit('avatar-calibration',{posture:'seated'},false);});await capture('seated');
  await actor.evaluate(()=>{const m=window.avatarXRMock;m.head[1]=1.64;m.left[1]=1.26;m.right[1]=1.26;document.querySelector('a-scene').emit('avatar-calibration',{posture:'standing'},false);});await capture('standing-again');
  const actorView=await actor.evaluate(()=>{const s=document.querySelector('a-scene'),T=window.AFRAME.THREE,c=document.querySelector('#camera').object3D;return {camera:c.getWorldPosition(new T.Vector3()).toArray(),ownerHeadScale:s.object3D.getObjectByName('avatar-owner').getObjectByName('head').scale.x};});
  await actor.screenshot({path:dir+'/task5-final-simulated-xr-actor-first-person.png'});
  await actor.evaluate(()=>{const m=window.avatarXRMock,s=document.querySelector('a-scene');m.active=false;m.session.dispatchEvent(new Event('end'));s.emit('exit-vr');s.removeAttribute('task5-final-simulated-pose-target');Object.assign(s.renderer.xr,m.original);});
  const endCalls=await actor.evaluate(()=>window.avatarXRMock.endCalls);
  const video=observer.video();await observer.close();await video.saveAs(dir+'/task5-final-simulated-xr-observer.webm');
  await actor.close();await context.close();
  return {label:'SIMULATED WebXR: actual A-Frame scene, no physical headset',samples,actorView,endCalls,errors,video:dir+'/task5-final-simulated-xr-observer.webm'};
}

