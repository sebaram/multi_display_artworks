async function checkGalleryPick(page, spec) {
  const errors=[];
  const errorHandler=error=>errors.push(String(error));page.on('pageerror',errorHandler);
  try {
    await page.setViewportSize({width:1440,height:900});
    await page.goto(spec.origin+spec.room_path,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(type=>{
      const scene=document.querySelector('a-scene');if(!scene?.hasLoaded)return false;
      return [...document.querySelectorAll(`.artwork[data-element-type="${type}"]`)].some(el=>type==='gaussian_splat'?el.components?.gaussian_splatting?.loadedVertexCount:type==='webpage'?el.querySelector('.artwork-source')?.getObject3D('mesh'):el.querySelector('.artwork-source[data-loaded="true"]'));
    },spec.type,{timeout:60000});
    await page.waitForTimeout(500);
    const target=await page.evaluate(type=>{
      const scene=document.querySelector('a-scene'),T=AFRAME.THREE,rect=scene.canvas.getBoundingClientRect();
      scene.object3D.updateMatrixWorld(true);scene.camera.updateWorldMatrix(true,false);
      const candidates=[];
      for(const root of document.querySelectorAll(`.artwork[data-element-type="${type}"]`)) {
        const node=root.querySelector(type==='gaussian_splat'?'.artwork-pick-target':type==='webpage'?'.artwork-source':'.artwork-source[data-loaded="true"]');
        const mesh=node?.getObject3D('mesh');if(!mesh)continue;
        const point=mesh.getWorldPosition(new T.Vector3()).project(scene.camera);
        if(point.z<0||point.z>1||Math.abs(point.x)>.7||Math.abs(point.y)>.7)continue;
        candidates.push({root,id:root.dataset.elementId,x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2,score:Math.abs(point.x)+Math.abs(point.y)});
      }
      candidates.sort((a,b)=>a.score-b.score);const candidate=candidates[0];
      if(!candidate)return null;
      window.__pickedArtwork=[];
      candidate.root.addEventListener('click',()=>window.__pickedArtwork.push(candidate.id));
      return {id:candidate.id,x:candidate.x,y:candidate.y};
    },spec.type);
    if(!target)throw Error(`No visible ${spec.type} picking target`);
    await page.mouse.move(target.x,target.y);await page.waitForTimeout(120);
    await page.mouse.click(target.x,target.y);await page.waitForTimeout(150);
    const picked=await page.evaluate(()=>window.__pickedArtwork);
    if(!picked.includes(target.id))throw Error(`Real pointer click did not select ${spec.type} ${target.id}`);
    if(errors.length)throw Error(errors.join('\n'));
    return {status:'pass',type:spec.type,target,picked,errors};
  } finally {page.off('pageerror',errorHandler);}
}
