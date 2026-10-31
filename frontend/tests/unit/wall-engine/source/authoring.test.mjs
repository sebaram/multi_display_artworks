import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize} from '../../../../src/wall-engine/reference/state.js';
import {addElement,patchElement,removeElement,presetEdits,resetElement} from '../../../../src/wall-engine/reference/authoring.js';
import * as authoringTools from '../../../../src/wall-engine/reference/authoring.js';

test('fresh backgrounds are unmodified presets',()=>{
 assert.deepEqual(sanitize().authored,{});assert.equal(sanitize().editElements,false);
});
test('individual objects can be duplicated across screens and reset without changing another preset',()=>{
 let state=addElement(sanitize({variant:1}),'logo',{screen:'front',x:80,size:2});
 const first=state.activeElement;state=addElement(state,'copy',{screen:'left',x:20,size:.4},first);
 const second=state.activeElement;assert.notEqual(first,second);assert.equal(presetEdits(state).objects[0].size,2);assert.equal(presetEdits(state).objects[1].size,.4);
 state=patchElement(state,'preset-main',{x:15,size:.5});assert.equal(presetEdits(state).edits['preset-main'].x,15);
 state=resetElement(state,'preset-main');assert.equal(presetEdits(state).edits['preset-main'],undefined);
 assert.deepEqual(presetEdits({...state,variant:5}),{edits:{},objects:[]});
 state=removeElement(state,first);assert.ok(presetEdits(state).objects.some(o=>o.id===second));assert.ok(presetEdits(state).objects.find(o=>o.id===first).archived);
 state=removeElement(state,second);assert.equal(presetEdits(state).objects.length,0);
});
test('authoring transforms are bounded and independent for each preset and screen',()=>{
 const s=sanitize({authored:{1:{edits:{main:{screen:'front',x:80,y:40,size:2,visible:true},companion:{screen:'left',x:20,y:65,size:.4,visible:false}},objects:[]},5:{edits:{main:{screen:'front',x:2000,size:-3}},objects:[]}}});
 assert.equal(s.authored[1].edits.main.size,2);assert.equal(s.authored[1].edits.companion.size,.4);
 assert.equal(s.authored[5].edits.main.x,150);assert.equal(s.authored[5].edits.main.size,.05);
});
import * as T from '../../../../src/wall-engine/reference/vendor/three.module.js';
import {authoringScene} from '../../../../src/wall-engine/reference/authoring-scene.js';
import {encodeLook,decodeLook} from '../../../../src/wall-engine/reference/look-url.js';
import {createLogoSculpture} from '../../../../src/wall-engine/reference/logo-scene.js';
import {recordMotion,applySample,motionContext} from '../../../../src/wall-engine/reference/object-motion.js';

function fixture(){
 globalThis.innerWidth=1280;globalThis.innerHeight=720;
 globalThis.document={getElementById:()=>({style:{}})};
 const state=sanitize({variant:1}),group=new T.Group(),hero=new T.Group();hero.position.set(4,1,0);group.add(hero);
 const ribbon=new T.Mesh(new T.TorusGeometry(1,.1,6,12),new T.MeshBasicMaterial({color:'#0066b3'}));ribbon.position.set(1,0,0);hero.add(ribbon);
 const sphere=new T.Mesh(new T.SphereGeometry(.3,8,6),new T.MeshBasicMaterial({color:'#ed1c24'}));sphere.position.set(-1,1,0);hero.add(sphere);
 const camera=new T.OrthographicCamera(-20,20,5,-5,.1,140);camera.position.set(0,3.8,32);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 return {state,group,hero,ribbon,sphere,camera};
}
function makeAuthor(f,state=f.state){return authoringScene(f.group,f.camera,state,{hero:f.hero,view:'front',preview:false,createObject:()=>null});}
function matrix(object){object.updateWorldMatrix(true,false);return object.matrixWorld.elements;}
function closeMatrix(a,b){a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`matrix component ${i}: ${v} != ${b[i]}`));}

test('generic animated copies sample their own clocks independently of a frozen source',()=>{
 const f=fixture();recordMotion(f.ribbon,{type:'orbit',base:[0,0,0],phase:0});let state=patchElement(f.state,'preset-main',{motionSpeed:0});state=addElement(state,'copy',{},'preset-main');const author=makeAuthor(f,state);let copy;f.group.traverse(o=>{if(o.isMesh&&o!==f.ribbon&&o.geometry===f.ribbon.geometry)copy=o;});assert.ok(copy);
 const draw=time=>{const clock=motionContext(f.ribbon,time,1);applySample(f.ribbon,clock.time,clock.amount);author.draw(time,1);};draw(2);const source=matrix(f.ribbon).slice(),first=matrix(copy).slice();draw(5);closeMatrix(source,matrix(f.ribbon));assert.notDeepEqual(first,matrix(copy));
 state=patchElement(state,'preset-main',{motionSpeed:1});state=patchElement(state,'object-1',{motionSpeed:0});author.apply(state);draw(7);const held=matrix(copy).slice();draw(10);closeMatrix(held,matrix(copy));assert.notDeepEqual(source,matrix(f.ribbon));
});

test('copying a moving leaf again retains its original ancestor coordinate frame',()=>{
 const f=fixture();recordMotion(f.ribbon,{type:'float',y:0,phase:0});let state=addElement(f.state,'copy',{},'preset-main-part-1');state=addElement(state,'copy',{},'object-1');const author=makeAuthor(f,state),copies=[];f.group.traverse(o=>{if(o.isMesh&&o!==f.ribbon&&o.geometry===f.ribbon.geometry)copies.push(o);});assert.equal(copies.length,2);author.draw(10,1);closeMatrix(matrix(copies[0]),matrix(copies[1]));
});

test('preset groups expose semantic, stable paths for each nested part without changing defaults',()=>{
 const f=fixture(),before=matrix(f.ribbon).slice(),author=makeAuthor(f),part=author.manifest.find(e=>e.parentId==='preset-main');
 assert.ok(part,'nested part appears in the element registry');assert.equal(part.id,'preset-main-part-1');assert.match(part.name,/Main sculpture.*Orbital ring/);assert.equal(part.depth,1);
 closeMatrix(matrix(f.ribbon),before);
 const second=makeAuthor(fixture()).manifest.find(e=>e.parentId==='preset-main');assert.equal(part.id,second.id);
});

test('editing a part composes with animated parent motion and leaves siblings untouched',()=>{
 const f=fixture(),author=makeAuthor(f),id=author.manifest.find(e=>e.parentId==='preset-main')?.id;
 assert.ok(id,'nested part can be addressed');const sibling=matrix(f.sphere).slice();
 let state=patchElement(f.state,id,{size:2,rotation:45,visible:false});author.apply(state);
 closeMatrix(matrix(f.sphere),sibling);assert.equal(f.ribbon.parent.visible,false);assert.equal(f.ribbon.parent.scale.x,2);
 const wrapper=f.ribbon.parent,local=wrapper.matrix.clone();f.hero.rotation.z=.4;author.draw();closeMatrix(wrapper.matrix.elements,local.elements);
 author.apply(resetElement(state,id));assert.equal(wrapper.visible,true);assert.equal(wrapper.scale.x,1);assert.equal(wrapper.rotation.z,0);
});

test('a copied leaf has its source world placement and motion with independent authoring',()=>{
 const f=fixture(),first=makeAuthor(f),part=first.manifest.find(e=>e.parentId==='preset-main');assert.ok(part,'leaf is copyable');
 let state=addElement(f.state,'copy',{screen:part.screen,x:part.x,y:part.y},part.id);
 // Rebuild exactly as the production scene does when the object list changes.
 const g=fixture(),author=makeAuthor(g,state),copy=author.manifest.find(e=>e.id==='object-1');assert.ok(copy);
 const clone=g.group.children.find(w=>w.children[0]!==g.hero)?.children[0];assert.ok(clone);
 author.draw();closeMatrix(matrix(clone),matrix(g.ribbon));
 g.hero.rotation.z=.7;g.ribbon.rotation.y=.3;author.draw();closeMatrix(matrix(clone),matrix(g.ribbon));
 author.apply(patchElement(state,part.id,{visible:false}));assert.equal(clone.parent.visible,true);
});

test('copied groups retain independent child edits through portable URLs',()=>{
 let state=patchElement(sanitize({variant:1}),'preset-main-part-2',{size:.45,rotation:30,visible:false});
 state=addElement(state,'copy',{x:25,screen:'left'},'preset-main');
 assert.deepEqual(presetEdits(state).edits['object-1-part-2'],{size:.45,rotation:30,visible:false});
 state=patchElement(state,'object-1-part-2',{visible:true});assert.equal(presetEdits(state).edits['preset-main-part-2'].visible,false);
 assert.deepEqual(decodeLook(encodeLook(state)).authored,sanitize(state).authored);
});

test('removing a custom group preserves sources of copied descendants and clears orphaned part edits',()=>{
 let state=addElement(sanitize(),'orbits');state=patchElement(state,'object-1-part-2',{size:2});state=addElement(state,'copy',{},'object-1-part-2');
 state=removeElement(state,'object-1');assert.equal(presetEdits(state).objects.find(o=>o.id==='object-1')?.archived,true);
 state=removeElement(state,'object-2');assert.equal(presetEdits(state).objects.length,0);assert.equal(presetEdits(state).edits['object-1-part-2'],undefined);
});

test('a portable preset retains edits after the 160th network part',()=>{
 const edits=Object.fromEntries(Array.from({length:250},(_,i)=>['network-part-'+i,{size:.5+i/100,rotation:i%180}]));
 const state=sanitize({variant:3,authored:{3:{edits,objects:[]}}}),restored=decodeLook(encodeLook(state));
 assert.equal(Object.keys(restored.authored[3].edits).length,250);assert.deepEqual(restored.authored[3].edits['network-part-249'],edits['network-part-249']);
});

test('copying a nested subgroup remaps deeper child edits to its new root',()=>{
 let state=patchElement(sanitize({variant:1}),'preset-main-part-2-3',{size:.7});
 state=addElement(state,'copy',{},'preset-main-part-2');
 assert.deepEqual(presetEdits(state).edits['object-1-part-3'],{size:.7});
});

test('semantic part labels preserve legacy top-level element IDs in saved looks',()=>{
 const f=fixture(),line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(1,1,0)]),new T.LineBasicMaterial());f.group.add(line);
 const author=makeAuthor(f),entry=author.manifest.find(e=>e.name.startsWith('Connection line'));
 assert.ok(entry);assert.match(entry.id,/-sculptural-element-1$/);
});

test('added and duplicated MV sculptures receive independent persisted variation seeds',()=>{
 let state=addElement(sanitize({variant:5}),'logo');const first=state.authored[5].objects[0];
 assert.ok(first.seed>0);assert.equal(first.randomness,1);
 state=addElement(state,'copy',{},first.id);const copy=state.authored[5].objects[1];assert.notEqual(first.seed,copy.seed);assert.equal(copy.randomness,1);
 assert.deepEqual(decodeLook(encodeLook(state)).authored,sanitize(state).authored);
 assert.equal(typeof authoringTools.randomizeElement,'function');
 const changed=authoringTools.randomizeElement(state,copy.id);assert.notEqual(changed.authored[5].objects[1].seed,copy.seed);assert.equal(changed.authored[5].objects[0].seed,first.seed);
 const bounded=sanitize(patchElement(changed,copy.id,{seed:1e9,randomness:100}));assert.equal(bounded.authored[5].objects[1].seed,999999);assert.equal(bounded.authored[5].objects[1].randomness,2);
});
test('whole MV copies own their animation geometry and preserve independently editable facets',()=>{
 const state=addElement(sanitize({variant:5}),'copy',{x:25,screen:'left'},'preset-logo-front'),f=fixture(),systems=[];
 function makeLogo(){const system=createLogoSculpture(c=>new T.MeshBasicMaterial({color:c}));system.root.name='MV sculpture';systems.push(system);return system.root;}
 f.group.clear();const original=makeLogo();original.userData.authorId='preset-logo-front';f.group.add(original);
 const author=authoringScene(f.group,f.camera,state,{view:'front',preview:false,createObject:makeLogo});assert.equal(systems.length,2);
 const originalFacet=systems[0].root.children[0].children[0],copyFacet=systems[1].root.children[0].children[0];
 assert.notEqual(originalFacet.geometry,copyFacet.geometry);
 systems.forEach(s=>s.update(3,1,s.root.userData.mvSettings));author.draw();
 assert.notDeepEqual([...originalFacet.geometry.attributes.position.array],[...copyFacet.geometry.attributes.position.array]);
 assert.ok(author.manifest.find(e=>e.id==='object-1').mv);assert.equal(author.manifest.find(e=>e.id==='object-1-part-1').mv,false);
 author.apply(patchElement(state,'object-1-part-1',{visible:false}));assert.equal(copyFacet.parent.visible,false);assert.equal(originalFacet.parent.visible,true);
});

test('deleting a preset part removes it from the editable scene and persists in the URL',()=>{
 const f=fixture(),author=makeAuthor(f),part=author.manifest.find(e=>e.parentId==='preset-main');
 let state={...f.state,activeElement:part.id};state=removeElement(state,part.id);
 assert.equal(state.authored[1].edits[part.id].deleted,true);assert.equal(state.activeElement,null);
 author.apply(state);assert.ok(!author.manifest.some(e=>e.id===part.id));assert.ok(author.manifest.some(e=>e.id==='preset-main'));
 assert.equal(decodeLook(encodeLook(state)).authored[1].edits[part.id].deleted,true);
 author.apply(resetElement(state,part.id));assert.ok(author.manifest.some(e=>e.id===part.id));
});
test('deleting a preset group removes its descendants while independent copies survive',()=>{
 const f=fixture();let state=addElement(f.state,'copy',{screen:'left'},'preset-main');
 const author=makeAuthor(f,state);state=removeElement({...state,activeElement:'object-1'},'preset-main');author.apply(state);author.draw();
 assert.ok(!author.manifest.some(e=>e.id==='preset-main'||e.id.startsWith('preset-main-part-')));assert.ok(author.manifest.some(e=>e.id==='object-1'));
 assert.equal(state.activeElement,'object-1');
});
test('deleting another custom element preserves the current selection',()=>{
 let state=addElement(sanitize(),'sphere');state=addElement(state,'arch');state={...state,activeElement:'object-1'};
 assert.equal(removeElement(state,'object-2').activeElement,'object-1');
});
test('repeated custom deletion cannot hide a later object reusing that ID',()=>{
 let state=addElement(sanitize(),'sphere');state=removeElement(state,'object-1');state=removeElement(state,'object-1');state=addElement(state,'arch');
 assert.equal(state.authored[4].objects[0].id,'object-1');assert.equal(authoringTools.isElementDeleted(state,'object-1'),false);
});

test('clipboard keeps child edits as they were copied and can paste after the source is deleted',()=>{
 assert.equal(typeof authoringTools.copyElement,'function');assert.equal(typeof authoringTools.pasteElement,'function');
 let state=addElement(sanitize({variant:1}),'network',{x:25,size:.7});state=patchElement(state,'object-1-part-1',{x:32,visible:false});
 const clip=authoringTools.copyElement(state,{id:'object-1',screen:'front',x:25,y:50,size:.7,rotation:0});
 state=patchElement(state,'object-1-part-1',{x:80,visible:true});state=removeElement(state,'object-1');state=addElement(state,'arch');
 state=authoringTools.pasteElement(state,clip);const pasted=state.activeElement,preset=presetEdits(state),copy=preset.objects.find(o=>o.id===pasted);
 assert.equal(copy.type,'copy');assert.equal(copy.x,30);assert.equal(copy.size,.7);assert.notEqual(copy.source,'object-1');
 assert.equal(preset.objects.find(o=>o.id===copy.source).type,'network');assert.equal(preset.objects.find(o=>o.id===copy.source).archived,true);
 assert.deepEqual(preset.edits[pasted+'-part-1'],{x:32,visible:false});assert.equal(preset.objects.find(o=>o.id==='object-1').type,'arch');
 assert.equal(authoringTools.pasteElement({...state,variant:2},clip).variant,2);assert.deepEqual(presetEdits({...state,variant:2}),{edits:{},objects:[]});
 assert.equal(authoringTools.copyElement(state,{id:'branding-front',dom:true}),null);
});

test('clipboard restores copied-part dependencies and does not partially paste at the object limit',()=>{
 assert.equal(typeof authoringTools.copyElement,'function');
 let state=addElement(sanitize({variant:1}),'network');state=addElement(state,'copy',{},'object-1-part-1');
 const clip=authoringTools.copyElement(state,{id:'object-2',screen:'left',x:40,y:45,size:1,rotation:0});
 state=removeElement(state,'object-1');state=removeElement(state,'object-2');state=authoringTools.pasteElement(state,clip);
 const objects=presetEdits(state).objects,copy=objects.find(o=>o.id===state.activeElement),source=objects.find(o=>o.id===copy.source);
 assert.equal(objects.length,3);assert.equal(source.archived,true);assert.match(source.source,/-part-1$/);assert.equal(copy.screen,'left');
 let full=sanitize({variant:1});for(let i=0;i<31;i++)full=addElement(full,'sphere');assert.equal(authoringTools.pasteElement(full,clip),full);
});

test('authoring history groups a drag, supports redo, and leaves playback and screens intact',()=>{
 assert.equal(typeof authoringTools.authoringHistory,'function');
 const history=authoringTools.authoringHistory();let state=sanitize({variant:1});history.observe(state);
 history.begin();let next=patchElement(state,'preset-main',{x:20});history.record(state,next);state=next;next=patchElement(state,'preset-main',{x:25});history.record(state,next);state=next;history.end();
 state={...state,brightness:60,paused:true};state=history.undo(state);assert.deepEqual(state.authored,{});assert.equal(state.brightness,60);assert.equal(state.paused,true);assert.equal(history.canUndo,false);assert.equal(history.canRedo,true);
 state=history.redo(state);assert.equal(state.authored[1].edits['preset-main'].x,25);history.observe(state);
 next=removeElement(state,'preset-main');history.record(state,next);state=next;assert.equal(history.canRedo,false);
 history.observe({...state,authored:{}});assert.equal(history.canUndo,false);
});

test('history survives normal state sanitization after adding an object',()=>{
 const history=authoringTools.authoringHistory(),before=sanitize({variant:1}),next=addElement(before,'sphere');history.observe(before);history.record(before,next);history.observe(sanitize(next));assert.equal(history.canUndo,true);assert.deepEqual(history.undo(sanitize(next)).authored,{});
});

test('clipboard duplicates still give MV sculptures a fresh independent variation',()=>{
 const state=addElement(sanitize({variant:5}),'logo'),element={...presetEdits(state).objects[0],mv:true},next=authoringTools.pasteElement(state,authoringTools.copyElement(state,element)),copy=presetEdits(next).objects.find(o=>o.id===next.activeElement);
 assert.notEqual(copy.seed,element.seed);assert.equal(copy.randomness,1);
});

test('pasted MV parts retain their copied source variation after editing or reusing its ID',()=>{
 for(const reuse of [false,true]){
  let state=addElement(sanitize({variant:5}),'logo'),original=presetEdits(state).objects[0];
  const clip=authoringTools.copyElement(state,{id:original.id+'-part-1',screen:'front',x:40,y:40,size:1,rotation:0});
  if(reuse){state=removeElement(state,original.id);state=addElement(state,'logo');}
  state=patchElement(state,original.id,{seed:999,randomness:2});state=authoringTools.pasteElement(state,clip);
  const objects=presetEdits(state).objects,copy=objects.find(o=>o.id===state.activeElement),source=objects.find(o=>copy.source===o.id+'-part-1');
  assert.notEqual(source.id,original.id);assert.equal(source.seed,original.seed);assert.equal(source.randomness,original.randomness);assert.equal(source.archived,true);
 }
});

test('clipboard freezes a preset MV part’s source variation',()=>{
 let state=patchElement(sanitize({variant:5}),'preset-logo-front',{seed:17,randomness:.8});
 const clip=authoringTools.copyElement(state,{id:'preset-logo-front-part-1',screen:'front',x:50,y:50,size:1,rotation:0});state=patchElement(state,'preset-logo-front',{seed:99,randomness:2});state=authoringTools.pasteElement(state,clip);
 const objects=presetEdits(state).objects,copy=objects.find(o=>o.id===state.activeElement),source=objects.find(o=>copy.source===o.id+'-part-1');assert.ok(source);assert.equal(source.seed,17);assert.equal(source.randomness,.8);assert.equal(source.source,'preset-logo-front');
});

test('group editing protects descendants until explicitly ungrouped, including nested groups',()=>{
 assert.equal(typeof authoringTools.elementEditTarget,'function');
 const elements=[{id:'preset-main',parentId:null},{id:'preset-main-part-1',parentId:'preset-main'},{id:'preset-main-part-1-1',parentId:'preset-main-part-1'}];
 let state=sanitize({variant:1});assert.equal(authoringTools.elementEditTarget(state,elements,elements[2].id),'preset-main');
 state=patchElement(state,'preset-main',{ungrouped:true});assert.equal(authoringTools.elementEditTarget(state,elements,elements[2].id),'preset-main-part-1');
 state=patchElement(state,'preset-main-part-1',{ungrouped:true});assert.equal(authoringTools.elementEditTarget(state,elements,elements[2].id),elements[2].id);
 assert.equal(decodeLook(encodeLook(state)).authored[1].edits['preset-main'].ungrouped,true);
 state=patchElement(state,'preset-main',{ungrouped:false});assert.equal(authoringTools.elementEditTarget(state,elements,elements[2].id),'preset-main');
});
