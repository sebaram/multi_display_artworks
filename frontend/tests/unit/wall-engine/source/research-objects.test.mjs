import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../../../src/wall-engine/reference/vendor/three.module.js';
import {createResearchObject,researchObjectTypes} from '../../../../src/wall-engine/reference/research-objects.js';
import {relationPose,recordMotion,sampledTransform,motionContext,applySample} from '../../../../src/wall-engine/reference/object-motion.js';
import {sanitize} from '../../../../src/wall-engine/reference/state.js';
import {addElement,patchElement,copyElement,pasteElement,presetEdits} from '../../../../src/wall-engine/reference/authoring.js';
import {authoringScene} from '../../../../src/wall-engine/reference/authoring-scene.js';
import {encodeLook,decodeLook} from '../../../../src/wall-engine/reference/look-url.js';

const pose=(story,part,side,time,extra={})=>relationPose({story,part,side,...extra},time);
test('every research sculpture keeps a visible three-dimensional secondary motion during assembled phases',()=>{
 for(const [type] of researchObjectTypes){
  const moving=[];createResearchObject(type,({o,...spec})=>{recordMotion(o,spec);moving.push(o);});
  for(const start of [0,11,13,16,25]){
   const animated=moving.filter(o=>{
    const a=sampledTransform(o,start),b=sampledTransform(o,start+.75);
    return a.position.distanceTo(b.position)>.07||a.quaternion.angleTo(b.quaternion)>.09;
   });
   assert.ok(animated.length>=4,`${type} pauses at ${start}s: only ${animated.length} clearly moving parts`);
  }
  assert.ok(moving.some(o=>o.userData.motionSpec.part==='turntable'),`${type} needs changing depth, not only planar translation`);
 }
});
test('co-presence brings distinct participants to one workspace and holds their common phase',()=>{
 const distance=t=>pose('presence','participant',1,t).position[0]-pose('presence','participant',-1,t).position[0];
 assert.ok(distance(0)>1);assert.equal(distance(13),0);assert.equal(distance(16),0);
 const left=pose('presence','participant',-1,13),right=pose('presence','participant',1,13);
 assert.equal(left.rotation[1],-right.rotation[1]);assert.equal(left.rotation[0],right.rotation[0]);assert.ok(left.rotation[0]>0);
 assert.equal(distance(27),distance(0));
});
test('spatial registration aligns the two coordinate frames before passage through the opening',()=>{
 const left=pose('registration','frame',-1,13),right=pose('registration','frame',1,13);
 assert.ok(left.position.every((v,i)=>v===right.position[i]));assert.deepEqual(left.rotation.map(Math.abs),right.rotation.map(Math.abs));
 assert.ok(pose('registration','frame',-1,0).position[0]<0);assert.ok(pose('registration','frame',1,0).position[0]>0);
 assert.ok(pose('registration','passage',1,12).position[2]>0);assert.ok(pose('registration','passage',1,15).position[2]<0);
 assert.ok(pose('registration','passage',1,0).scale[0]<.01);
});
test('mutual response travels to the other surface and returns instead of pulsing both at random',()=>{
 const strength=(side,t)=>pose('feedback','fold',side,t,{index:4}).position[2];
 assert.ok(strength(-1,3.5)>.2);assert.equal(strength(1,3.5),0);
 assert.ok(pose('feedback','pulse',-1,6).position[0]<pose('feedback','pulse',-1,8).position[0]);
 assert.ok(strength(1,11)>.2);assert.equal(strength(-1,11),0);
 assert.ok(pose('feedback','pulse',1,17).position[0]>pose('feedback','pulse',1,19).position[0]);
 assert.ok(strength(-1,22)>.2);assert.equal(strength(1,22),0);
});
test('complementary pavilion halves join one roof and remain grounded throughout assembly',()=>{
 for(const side of [-1,1])for(let index=0;index<3;index++){
  const open=pose('cocreation','half',side,0,{index}),joined=pose('cocreation','half',side,14,{index});
  assert.ok(Math.abs(open.position[0])>.7);assert.ok(joined.position[0]===0);assert.ok(joined.rotation[1]===0);
  for(const t of [0,5,10,14,20,27])assert.equal(pose('cocreation','half',side,t,{index}).position[1],0);
 }
 assert.equal(pose('cocreation','shared',1,14).scale[1],1);
});
test('every research sculpture has repeatable finite motion and a still meaningful zero-motion form',()=>{
 for(const [type] of researchObjectTypes){
  const moving=[],root=createResearchObject(type,({o,...spec})=>{recordMotion(o,spec);moving.push(o);});
  assert.ok(moving.length>0);const bounds=new T.Box3().setFromObject(root,true).getSize(new T.Vector3());
  assert.ok(bounds.x<6&&bounds.y<5&&bounds.z<4);
  for(const object of moving){
   assert.deepEqual(sampledTransform(object,5),sampledTransform(object,33));
   assert.deepEqual(sampledTransform(object,0,0),sampledTransform(object,17,0));
   for(const amount of [.35,1,1.7]){
    const end=sampledTransform(object,28-.00001,amount),start=sampledTransform(object,.00001,amount);
    if(Math.max(...end.scale,...start.scale)<.01)continue; // Couriers reset only while fully hidden.
    assert.ok(end.position.distanceTo(start.position)<.001);
    assert.ok(end.quaternion.angleTo(start.quaternion)<.001,'custom movement amount must not introduce a loop-boundary snap');
   }
   for(const amount of [0,1,2])for(const time of [-1,0,6,14,22,28]){
    const sample=sampledTransform(object,time,amount);
    assert.ok([...sample.position,...sample.quaternion,...sample.scale].every(Number.isFinite));
    assert.ok(sample.scale.toArray().every(v=>v>=0));
   }
  }
 }
});
test('semantic objects, child edits and copied groups survive portable looks',()=>{
 for(const [type] of researchObjectTypes){
  let state=addElement(sanitize({variant:6}),type,{x:83,y:67,size:.8});
  state=patchElement(state,'object-1-part-2',{motionSpeed:.6,visible:true});
  const original={...presetEdits(state).objects[0],dom:false};state=pasteElement(state,copyElement(state,original));
  const loaded=decodeLook(encodeLook(state));assert.deepEqual(loaded.authored,sanitize(state).authored);
  assert.equal(loaded.authored[6].objects[0].type,type);assert.equal(loaded.authored[6].objects[1].source,'object-1');
  assert.equal(loaded.authored[6].edits['object-2-part-2'].motionSpeed,.6);
 }
});
test('duplicated relational sculptures own their clocks while original parts stay grouped',()=>{
 globalThis.innerWidth=1280;globalThis.innerHeight=720;globalThis.document={getElementById:()=>({style:{}})};
 let state=addElement(sanitize({screens:[{id:'front',width:1920,height:1080}]}),'feedback');state=patchElement(state,'object-1',{motionSpeed:0});state=addElement(state,'copy',{},'object-1');
 const group=new T.Group(),camera=new T.OrthographicCamera(-10,10,5,-5,.1,140),moving=[];camera.position.set(0,3.8,32);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 let root;
 const author=authoringScene(group,camera,state,{view:'front',preview:false,createObject:type=>{root=createResearchObject(type,({o,...spec})=>{recordMotion(o,spec);moving.push(o);});group.add(root);return root;}});
 const source=root.getObjectByName('Responsive fold 5');let copy;group.traverse(o=>{if(o!==source&&o.geometry===source.geometry)copy=o;});assert.ok(copy);
 const matrix=o=>{o.updateWorldMatrix(true,false);return o.matrixWorld.elements.slice();};
 const draw=t=>{for(const o of moving){const clock=motionContext(o,t);applySample(o,clock.time,clock.amount);}author.draw(t,1);};
 draw(3.5);const first=matrix(source),firstCopy=matrix(copy);draw(7);assert.deepEqual(matrix(source),first);assert.notDeepEqual(matrix(copy),firstCopy);
 state=patchElement(state,'object-2',{motionSpeed:0,motionOffset:4});author.apply(state);draw(8);const held=matrix(copy);draw(18);assert.deepEqual(matrix(copy),held);
 const nested=author.manifest.filter(e=>e.id.startsWith('object-1-part-'));assert.ok(nested.length>10);assert.ok(nested.every(e=>e.rootId==='object-1'));
});
