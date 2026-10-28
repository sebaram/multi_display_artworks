import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const frontendRequire=createRequire(join(root,'frontend/package.json'));
let chromium;
try { ({chromium}=frontendRequire('playwright')); }
catch { ({chromium}=createRequire(join(root,'flask_server/package.json'))('playwright')); }
const output=resolve(root,process.env.WALL_ENGINE_SPIKE_OUTPUT||'frontend/test-results/wall-engine-spike');mkdirSync(output,{recursive:true});
const scratch=join(root,'.superpowers/sdd/2026-10-29-fastapi-react-interactive-walls');
const sourceCandidate=process.env.WALL_SOURCE_REFERENCE||join(scratch,'reference');
const sourceReference=existsSync(join(sourceCandidate,'wall.html'))?resolve(sourceCandidate):null;
const aframeCandidate=process.env.WALL_AFRAME_SCRIPT||[join(root,'frontend/node_modules/aframe/dist/aframe-master.min.js'),join(scratch,'runtime/aframe-1.6.0.min.js')].find(existsSync);
const aframeScript=aframeCandidate&&existsSync(aframeCandidate)?resolve(aframeCandidate):null;
if(process.env.WALL_SOURCE_REFERENCE&&!sourceReference)throw new Error('WALL_SOURCE_REFERENCE must point to the pinned source checkout containing wall.html');
if(process.env.WALL_AFRAME_SCRIPT&&!aframeScript)throw new Error('WALL_AFRAME_SCRIPT must point to A-Frame 1.6.0 JavaScript');
if(!existsSync(join(root,'frontend/tests/fixtures/media/video.mp4')))throw new Error('Generate the MP4 fixture first: see frontend/tests/fixtures/README.md');
if(!sourceReference)console.log('SKIP original-source comparison: set WALL_SOURCE_REFERENCE to the pinned upstream checkout');
if(!aframeScript)console.log('SKIP A-Frame texture comparison: set WALL_AFRAME_SCRIPT to local A-Frame 1.6.0 JavaScript');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ttf':'font/ttf','.mp4':'video/mp4'};
const server=createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;background:#111"><canvas id="wall" width="960" height="540"></canvas></body></html>');return;}
 let url=decodeURIComponent(req.url.split('?')[0]);if(url.startsWith('/wall-reference/'))url='/frontend/public'+url;if(url.startsWith('/wall-presets/'))url='/frontend/public'+url;
 let allowedRoot=root,file=resolve(root,'.'+url);if(url.startsWith('/__wall_reference__/')&&sourceReference){allowedRoot=sourceReference;file=resolve(sourceReference,'.'+url.slice('/__wall_reference__'.length));}if(url==='/__wall_aframe.js'&&aframeScript)file=aframeScript;
 if(!(file===aframeScript||file.startsWith(allowedRoot+sep))||!existsSync(file)){res.statusCode=404;res.end();return;}
 const body=readFileSync(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Access-Control-Allow-Origin','*');
 const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);if(range){const start=+range[1],end=range[2]?Math.min(+range[2],body.length-1):body.length-1;res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${body.length}`);res.setHeader('Accept-Ranges','bytes');res.end(body.subarray(start,end+1));}else res.end(body);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url);
 const results=await page.evaluate(async()=>{
  const {createWallRenderer,normalizeWallLook,pointerFromUV}=await import('/frontend/src/wall-engine/index.js');
  const canvas=document.querySelector('#wall'),errors=[];window.spikeErrors=errors;const originalGetContext=HTMLCanvasElement.prototype.getContext;window.sourceCanvases=[];HTMLCanvasElement.prototype.getContext=function(kind,...args){const result=originalGetContext.call(this,kind,...args);if(kind==='webgl2'&&result&&!window.sourceCanvases.includes(this))window.sourceCanvases.push(this);return result;};
  const raw={variant:0,brightness:100,branding:true,headlines:true,interactive:true,screens:[{id:'front',width:1920,height:1080,mode:'raster'}],authored:{0:{objects:[{id:'object-1',type:'text',screen:'front',x:25,y:20,textHtml:'<p><strong style="color:#ff0000">Rich</strong> <em>text</em></p>',textSize:180}],edits:{}}},showVideo:true,videoLayers:[{id:'video-1',assetId:'fixture',x:65,y:65,width:28}]};
  let look=normalizeWallLook(raw);window.spikeLook=look;
  const renderer=createWallRenderer({canvas,config:look,assetResolver:id=>id==='fixture'?'/frontend/tests/fixtures/media/video.mp4':Promise.reject(new Error('Missing fixture asset')),onError:e=>errors.push(e)});window.renderer=renderer;
  const pixels=()=>new Uint8Array(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
  const diff=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>20)count++;return count;};
  const draw=()=>renderer.render(12,{positionSeconds:1.5,playing:false,rate:1});
  for(let i=0;i<100;i++){draw();if(renderer.getStats().media[0]?.ready>=2)break;await new Promise(r=>setTimeout(r,50));}
  await document.fonts.ready;await new Promise(r=>setTimeout(r,100));draw();
  const all=pixels(),stats=renderer.getStats(),videoPick=renderer.pick(.65,.65),videoManifest=renderer.getElements().some(e=>e.id==='media:video-1');
  const noVideo=structuredClone(look);noVideo.state.showVideo=false;renderer.setConfig(noVideo);draw();const videoDiff=diff(all,pixels());
  const noLogo=structuredClone(noVideo);noLogo.state.branding=false;renderer.setConfig(noLogo);draw();const logoDiff=diff(pixels(),(()=>{renderer.setConfig(noVideo);draw();return pixels();})());
  const noText=structuredClone(noVideo);noText.state.authored[0].objects[0].visible=false;renderer.setConfig(noText);draw();const textDiff=diff(pixels(),(()=>{renderer.setConfig(noVideo);draw();return pixels();})());
  const list=structuredClone(noVideo);list.state.authored[0].objects[0].textHtml='<ol><li>List</li></ol>';renderer.setConfig(list);draw();const listPixels=pixels();list.state.authored[0].objects[0].visible=false;renderer.setConfig(list);draw();const listBase=pixels();let listMarkerDiff=0;for(let y=108;y<170;y++)for(let x=250;x<292;x++){const i=(y*960+x)*4;if(Math.abs(listPixels[i]-listBase[i])+Math.abs(listPixels[i+1]-listBase[i+1])+Math.abs(listPixels[i+2]-listBase[i+2])>20)listMarkerDiff++;}
  const dark=structuredClone(look);dark.state.brightness=50;renderer.setConfig(dark);for(let i=0;i<100;i++){draw();if(renderer.getStats().media[0]?.ready>=2)break;await new Promise(r=>setTimeout(r,20));}await new Promise(r=>setTimeout(r,40));draw();const dim=pixels();let sumA=0,sumB=0;for(let i=0;i<all.length;i+=4){sumA+=all[i]+all[i+1]+all[i+2];sumB+=dim[i]+dim[i+1]+dim[i+2];}
  renderer.setConfig(look);draw();const sameA=pixels();renderer.render(20,{positionSeconds:1.5,playing:false,rate:1});const animationDiff=diff(sameA,pixels());draw();const repeatDiff=diff(sameA,pixels());
  window.spikePixels=pixels();
  return {stats,listMarkerDiff,videoPick,videoManifest,errors,videoDiff,logoDiff,textDiff,brightnessRatio:sumB/sumA,animationDiff,repeatDiff,elementCount:renderer.getElements().length,pointer: pointerFromUV({u:0,v:1})};
 });
 writeFileSync(join(output,'composition.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 assert.ok(results.listMarkerDiff>20,'ordered list marker is composited');assert.equal(results.videoPick?.id,'media:video-1');assert.equal(results.videoManifest,true);assert.equal(results.errors.length,0);assert.ok(results.videoDiff>3000,'video layer appears');assert.ok(results.logoDiff>100,'logo appears');assert.ok(results.textDiff>100,'rich text appears');assert.ok(results.brightnessRatio>.45&&results.brightnessRatio<.55,'brightness applies to all layers');assert.ok(results.animationDiff>1000,'source animation renders');assert.equal(results.repeatDiff,0,'same source time repeats exactly');
 await page.screenshot({path:join(output,'composition.png')});
 // Actual isolated A-Frame consumes the output canvas as its own THREE CanvasTexture.
 let texture=null;
 if(aframeScript){
 await page.addScriptTag({url:url+'/__wall_aframe.js'});
 texture=await page.evaluate(async()=>{
  const scene=document.createElement('a-scene');scene.setAttribute('embedded','');scene.setAttribute('vr-mode-ui','enabled:false');scene.setAttribute('renderer','colorManagement:true;antialias:true');scene.style.cssText='display:block;width:960px;height:540px';
  scene.innerHTML='<a-entity camera position="0 0 3"></a-entity><a-plane id="surface" width="4.8" height="2.7" rotation="0 12 0" material="shader:flat;side:double"></a-plane>';
  document.body.append(scene);await new Promise(r=>scene.addEventListener('loaded',r,{once:true}));
  const mesh=scene.querySelector('#surface').getObject3D('mesh'),texture=new AFRAME.THREE.CanvasTexture(document.querySelector('#wall'));texture.colorSpace=AFRAME.THREE.SRGBColorSpace;mesh.material.map=texture;mesh.material.needsUpdate=true;texture.needsUpdate=true;
  await new Promise(r=>setTimeout(r,800));scene.renderer.render(scene.object3D,scene.camera);const gl=scene.renderer.getContext(),data=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);
  window.spikeScene=scene;window.spikeTexture=texture;
  return {canvasBoundary:texture.image===document.querySelector('#wall'),width:texture.image.width,height:texture.image.height,center:[...data],aframe:AFRAME.version};
 });
 console.log('A-Frame texture',texture);assert.equal(texture.canvasBoundary,true);assert.equal(texture.aframe,'1.6.0');assert.ok(texture.center[0]+texture.center[1]+texture.center[2]>0);
 await page.screenshot({path:join(output,'aframe-texture.png'),fullPage:true});
 }
 const catalogs=await page.evaluate(async()=>{
  const manifest=await fetch('/wall-presets/manifest.json').then(r=>r.json()),output=[],atlas=document.createElement('canvas');atlas.width=960;atlas.height=8*114;const ac=atlas.getContext('2d');ac.fillStyle='#111';ac.fillRect(0,0,atlas.width,atlas.height);
  for(const entry of manifest.presets){const preset=await fetch('/wall-presets/'+entry.file).then(r=>r.json());window.renderer.setConfig(preset.config);window.renderer.render(12,{positionSeconds:0,playing:false,rate:1});const i=output.length,x=i%6*160,y=Math.floor(i/6)*114;ac.drawImage(document.querySelector('#wall'),x,y,160,90);ac.fillStyle='#fff';ac.font='10px sans-serif';ac.fillText(entry.name,x+2,y+103,156);output.push({key:entry.source_key,elements:window.renderer.getElements().length,animated:window.renderer.getStats().animatedObjects});}
  window.catalogAtlas=atlas.toDataURL();return output;
 });
 writeFileSync(join(output,'all-44-source-presets.png'),Buffer.from((await page.evaluate(()=>window.catalogAtlas)).split(',')[1],'base64'));assert.equal(catalogs.length,44);assert.ok(catalogs.every(p=>p.elements>0&&p.animated>0));writeFileSync(join(output,'catalogs.json'),JSON.stringify(catalogs,null,2));
 const fidelity=[];
 if(sourceReference){
 const original=await browser.newPage({viewport:{width:960,height:540}});
 await original.goto(url);
 for(let variant=0;variant<12;variant++){
  const raw={variant,cue:0,brightness:100,branding:false,headlines:false,interactive:false,showVideo:false,paused:true,offset:12,epoch:0,screens:[{id:'front',width:1920,height:1080,mode:'raster'}],authored:{},appearance:{[variant]:{mode:'solid',backgroundColor:'#123456'}}};
  await original.evaluate(raw=>localStorage.setItem('gsmv-interview-walls-v1',JSON.stringify(raw)),raw);
  await original.goto(url+'/__wall_reference__/wall.html?view=front&capture=1');
  await original.waitForFunction(()=>window.META?.renderedTime===12);
  const expected=await original.evaluate(()=>{const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(document.querySelector('#scene'),0,0);return c.toDataURL();});
  const compare=await page.evaluate(async({raw,expected})=>{
   const image=new Image();image.src=expected;await image.decode();const c=document.createElement('canvas');c.width=960;c.height=540;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const a=ctx.getImageData(0,0,960,540).data;
   const {normalizeWallLook}=await import('/frontend/src/wall-engine/config.js');window.renderer.setConfig(normalizeWallLook(raw));window.renderer.render(12,{positionSeconds:0,playing:false,rate:1});const b=document.querySelector('#wall').getContext('2d').getImageData(0,0,960,540).data;
   let diff=0,max=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])diff++;max=Math.max(max,Math.abs(a[i]-b[i]));}return {variant:raw.variant,differentChannels:diff,maxDifference:max};
  },{raw,expected});fidelity.push(compare);
 }
 await original.close();console.log('Original source fidelity',JSON.stringify(fidelity));assert.ok(fidelity.every(r=>r.differentChannels===0),'all original preset WebGL pixels match');
 }
 const recovery=await page.evaluate(async()=>{
  const {createWallRenderer,normalizeWallLook}=await import('/frontend/src/wall-engine/index.js');
  const primary=window.renderer,canvas=document.querySelector('#wall');
  const base=structuredClone(window.spikeLook);base.state.showVideo=false;
  primary.setConfig(base);primary.render(12,{positionSeconds:0,playing:false,rate:1});
  const before=canvas.toDataURL();
  const other=document.createElement('canvas');other.width=960;other.height=540;
  const second=createWallRenderer({canvas:other,config:base,onError:e=>window.spikeErrors.push(e)});
  await new Promise(r=>setTimeout(r,150));second.render(12,{positionSeconds:0,playing:false,rate:1});
  const independentSame=before===other.toDataURL();second.dispose();
  const ext=window.sourceCanvases[0].getContext('webgl2').getExtension('WEBGL_lose_context');
  ext.loseContext();for(let i=0;i<20&&!primary.getStats().contextLost;i++)await new Promise(r=>setTimeout(r,20));
  const lost=primary.getStats().contextLost;await new Promise(r=>setTimeout(r,100));ext.restoreContext();
  for(let i=0;i<100&&primary.getStats().contextLost;i++)await new Promise(r=>setTimeout(r,20));
  primary.render(12,{positionSeconds:0,playing:false,rate:1});const recovered=before===canvas.toDataURL();
  primary.resize(480,270);primary.render(12,{positionSeconds:0,playing:false,rate:1});const resized=[canvas.width,canvas.height];primary.resize(960,540);primary.render(12,{positionSeconds:0,playing:false,rate:1});const resizeRepeat=before===canvas.toDataURL();
  const youtube=structuredClone(base);youtube.state.videoLayers=[{id:'youtube-1',youtube:{id:'dQw4w9WgXcQ',start:3,title:'Separate player'},x:50,y:50,width:30}];youtube.state.showVideo=true;primary.setConfig(youtube);primary.render(20,{positionSeconds:8,playing:true,rate:1});const descriptors=primary.getYouTubeLayers();
  const missing=structuredClone(base);missing.state.videoLayers=[{id:'missing',assetId:'missing'}];missing.state.showVideo=true;primary.setConfig(missing);primary.render(12,{positionSeconds:0,playing:false,rate:1});await new Promise(r=>setTimeout(r,50));
  const assetFailure=window.spikeErrors.some(e=>e.code==='video-load'&&e.layerId==='missing');primary.setConfig(base);primary.render(12,{positionSeconds:0,playing:false,rate:1});
  const seedLook=normalizeWallLook({variant:5,screens:[{id:'front',width:1920,height:1080}],brightness:100,branding:false,authored:{5:{objects:[],edits:{'preset-logo-front':{randomness:1}}}}});seedLook.seed=42;primary.setConfig(seedLook);primary.render(4);const seedA=canvas.toDataURL();seedLook.seed=43;primary.setConfig(seedLook);primary.render(4);const seedDistinct=seedA!==canvas.toDataURL();seedLook.seed=42;primary.setConfig(seedLook);primary.render(4);const seedRepeat=seedA===canvas.toDataURL();
  for(let i=0;i<10;i++){const c=document.createElement('canvas');c.width=320;c.height=180;const r=createWallRenderer({canvas:c,config:base});r.render(12,{positionSeconds:0,playing:false,rate:1});r.dispose();}await new Promise(r=>setTimeout(r,30));const layoutsAfterReentry=document.querySelectorAll('[data-wall-layout]').length;
  return {independentSame,lost,recovered,resized,resizeRepeat,descriptors,assetFailure,seedDistinct,seedRepeat,layoutsAfterReentry,errors:window.spikeErrors};
 });
 console.log('Recovery and adapters',JSON.stringify(recovery));assert.equal(recovery.independentSame,true);assert.equal(recovery.lost,true);assert.equal(recovery.recovered,true);assert.deepEqual(recovery.resized,[480,270]);assert.equal(recovery.resizeRepeat,true);assert.equal(recovery.descriptors[0].composited,false);assert.equal(recovery.descriptors[0].playback.positionSeconds,8);assert.equal(recovery.assetFailure,true);assert.equal(recovery.seedDistinct,true);assert.equal(recovery.seedRepeat,true);assert.equal(recovery.layoutsAfterReentry,1);
 const cleanup=await page.evaluate(()=>{window.spikeTexture?.dispose();window.spikeScene?.renderer.dispose();window.spikeScene?.remove();window.renderer.dispose();window.renderer.dispose();return {layouts:document.querySelectorAll('[data-wall-layout]').length,stats:window.renderer.getStats(),size:[document.querySelector('#wall').width,document.querySelector('#wall').height]};});
 assert.equal(cleanup.layouts,0);assert.equal(cleanup.stats.disposed,true);assert.equal(cleanup.stats.media.length,0);assert.deepEqual(cleanup.size,[1,1]);assert.deepEqual(errors,[]);
 writeFileSync(join(output,'result.json'),JSON.stringify({results,texture,catalogs,fidelity,recovery,cleanup,optionalFixtures:{source:!!sourceReference,aframe:!!aframeScript},pageErrors:errors},null,2));console.log('PASS managed composition, UV, absolute-time repeatability, all 44 source configs and disposal; optional fixture results saved');
}finally{await browser.close();server.close();}
