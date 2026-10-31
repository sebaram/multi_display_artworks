import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./device_probe.js',import.meta.url),'utf8');
for(const immersive of [false,true])test(`device collector counts main frames only (${immersive?'mock XR loop':'mock window loop'})`,async()=>{
  let now=0,windowCalls=0,xrCalls=0;
  const object3D={},gl={isContextLost:()=>false,getExtension:()=>null,getParameter:()=> 'test-only',drawingBufferWidth:100,drawingBufferHeight:100};
  const renderer={info:{render:{calls:1,triangles:2},memory:{textures:1,geometries:1}},getContext:()=>gl};
  renderer.render=function(scene){if(scene===object3D){renderer.render({internal:true});renderer.render({internal:true});}};
  const tick=callback=>queueMicrotask(()=>{now+=1000;renderer.render(object3D);callback(now);});
  renderer.xr={getSession:()=>immersive?{frameRate:90,requestAnimationFrame:callback=>{xrCalls++;tick(callback);}}:null};
  const context={window:{},document:{visibilityState:'visible',querySelector:()=>({renderer,object3D}),createElement:()=>({addEventListener(){}}),body:{append(){}}},navigator:{userAgent:'mock test'},location:{pathname:'/test',search:''},performance:{now:()=>now},console:{log(){}},requestAnimationFrame:callback=>{windowCalls++;tick(callback);},setTimeout,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}};
  const result=await runInNewContext(source,context);
  assert.ok(result.render_fps>1&&result.render_fps<1.1,`internal passes inflated FPS: ${result.render_fps}`);
  assert.equal(result.cpu_utilization_pct,null);assert.equal(result.total_app_ram_bytes,null);
  assert.equal(immersive?windowCalls:xrCalls,0);
});
