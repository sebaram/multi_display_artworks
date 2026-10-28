import * as T from './vendor/three.module.js';
import {panorama,screenAspect,timeline,cues} from './state.js';
import {presetEdits,objectTypes,isElementDeleted,elementEditTarget} from './authoring.js';
import {motionContext,applySample,sampledWorld} from './object-motion.js';
import {textDefaults,textPropertyKeys} from './text-content.js';


// Animation remains inside a wrapper; authored transforms never overwrite it.
export function authoringScene(group,camera,state,{background,hero,secondary,createObject,view,preview}){
 const entries=[],copies=[],copyRoots=new Map(),wrappers=new Set(),p=panorama(state),full=camera.clone();full.clearViewOffset();full.left=-p.width/p.height*5;full.right=-full.left;full.updateProjectionMatrix();full.updateMatrixWorld();
 let current=state,currentTime=0;const counts=new Map();
 const screenFor=x=>p.screens.find(sc=>x>=sc.x&&x<sc.x+sc.width)||p.screens.at(-1);
 // Existing root IDs are part of saved URLs, independent of improved display labels.
 function legacyName(object){if(object===hero)return 'Main sculpture';if(object===secondary)return 'Companion sculpture';if(object.name)return object.name;const type=object.geometry?.type||object.type;return ({SphereGeometry:'Accent sphere',TorusGeometry:'Orbital ring',TubeGeometry:'Connecting ribbon',CylinderGeometry:'Pedestal',ExtrudeGeometry:'Architectural arch',Line:'Connection line',Group:'Research network',PlaneGeometry:object.material?.map?'Soft shadow':'Stage floor'})[type]||'Sculptural element';}
 function defaultName(object,parent){if(state.variant>=8&&(object===hero||object===secondary))return object.name;if(object===hero)return 'Main sculpture';if(object===secondary)return 'Companion sculpture';if(object.name)return object.name;
  const type=object.geometry?.type||object.type,color=object.material?.color?.getHexString(),tint=color==='0066b3'?'Blue':color==='ed1c24'?'Red':'';
  if(parent?.object.name==='MV sculpture'||parent?.kind==='logo')return object.isLine?'MV connection link':(tint?tint+' ':'')+'MV facet';
  if(object.isLine)return parent?'Network link':'Connection line · floor grid';
  if(type==='TubeGeometry'&&!parent)return 'Long line · '+(object.material.color.r>object.material.color.b?'Red':'Blue')+' ribbon';
  return ({SphereGeometry:parent?.kind==='network'?'Network node':'Accent sphere',TorusGeometry:'Orbital ring',TorusKnotGeometry:'Central knot',TubeGeometry:'Connecting ribbon',CylinderGeometry:'Pedestal',ExtrudeGeometry:'Architectural arch',Group:'Research network',PlaneGeometry:object.material?.map?'Soft shadow':'Stage floor',BufferGeometry:(tint?tint+' ':'')+'Interwoven ribbon'})[type]||'Sculptural element';
 }
 function register(object,custom=null,parent=null,path=[]){
  group.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(object),anchor=bounds.getCenter(new T.Vector3());if(!Number.isFinite(anchor.x))anchor.copy(object.position);
  const ndc=anchor.clone().project(full),pixel=(ndc.x+1)/2*p.width,sc=screenFor(pixel),name=defaultName(object,parent),key=(parent?.id||sc.id)+'-'+(parent?name:legacyName(object)).toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const n=(counts.get(key)||0)+1;counts.set(key,n);
  const rootId=parent?.rootId||parent?.id,id=parent?rootId+'-part-'+path.join('-'):custom?.id||object.userData.authorId||(object===hero?'preset-main':object===secondary?'preset-companion':key+'-'+n);
  const defaults={screen:sc.id,x:(pixel-sc.x)/sc.width*100,y:(1-ndc.y)/2*100,size:1,rotation:0,visible:true,motionSpeed:1,motionAmount:1,motionAnchor:0,motionOffset:0};
  const originalParent=object.parent||group,parentMatrix=originalParent.matrixWorld.clone(),localAnchor=anchor.clone().applyMatrix4(parentMatrix.clone().invert()),wrap=new T.Group();originalParent.add(wrap);wrap.add(object);wrappers.add(wrap);
  const label=custom?(custom.type==='copy'?'Copy of '+(entries.find(e=>e.id===custom.source)?.name||'element'):objectTypes.find(t=>t[0]===custom.type)?.[1]||name):name+(n>1?' '+n:'');
  const entry={id,label,name:parent?parent.name+' / '+label:label,parentId:parent?.id||null,rootId:rootId||id,depth:parent?parent.depth+1:0,kind:(custom?.type==='copy'?entries.find(e=>e.id===custom.source)?.kind:custom?.type)||((object.name==='MV sculpture')?'logo':name==='Research network'?'network':null),object,wrap,anchor,localAnchor,parentMatrix,defaults,custom:!!custom,owner:parent?.owner||custom?.id||null};if(entry.kind==='logo'&&!parent){defaults.seed=state.seed??0;defaults.randomness=0;}entries.push(entry);return entry;
 }
 function registerTree(object,custom=null,parent=null,path=[]){const children=[...object.children],entry=register(object,custom,parent,path);for(const [i,child] of children.entries())if(child.isMesh||child.isLine||child.isGroup)registerTree(child,null,entry,[...path,i+1]);return entry;}
 for(const object of [...group.children])if(object!==background)registerTree(object);
 // Ignore authoring wrappers when cloning: original animation nodes remain paired,
 // while each copy gets its own authoring wrappers and descendant edit IDs.
 function cloneAnimated(source){
  const pairs=[];
  function cloneNode(object){if(wrappers.has(object))return cloneNode(object.children[0]);const clone=object.clone(false);pairs.push([object,clone]);for(const child of object.children)clone.add(cloneNode(child));return clone;}
  const clone=cloneNode(source);copies.push({pairs,source,clone});copyRoots.set(clone,source);baseWorld(source).decompose(clone.position,clone.quaternion,clone.scale);return clone;
 }
 function baseWorld(object){const chain=[];for(let node=object;node&&node!==group;node=node.parent)if(!wrappers.has(node))chain.unshift(node);const matrix=new T.Matrix4();for(const node of chain){node.updateMatrix();matrix.multiply(node.matrix);}return matrix;}
 for(const custom of presetEdits(state).objects){
  if(custom.type==='text'){
   const el={id:'authored-'+custom.id};
   entries.push({id:custom.id,name:'Text element',domId:el.id,text:true,textKind:'text',custom:true,rootId:custom.id,depth:0,defaults:{screen:custom.screen||state.screens[0].id,x:50,y:50,size:1,rotation:0,visible:true,...textDefaults()}});continue;
  }
  if(custom.type==='copy'){
   const source=entries.find(e=>e.id===custom.source);if(!source)continue;
   const independentMV=source.kind==='logo'&&!source.parentId;
   const clone=independentMV?createObject('logo'):cloneAnimated(source.object);
   if(independentMV){clone.position.copy(source.object.position);clone.quaternion.copy(source.object.quaternion);clone.scale.copy(source.object.scale);}
   group.add(clone);const entry=registerTree(clone,custom);entry.defaults={...source.defaults,size:1,rotation:0,visible:true};
  }else {const object=createObject(custom.type);if(object)registerTree(object,custom);}
 }
 for(const sc of p.screens)for(const [domId,name,y] of [['branding','Department signature',9],['headline','Research titles',70],['wall-caption','Topic footer',90]]){
  const kind=domId==='branding'?'signature':domId==='headline'?'headline':'footer';
  entries.push({id:domId+'-'+sc.id,name,domId,text:true,textKind:kind,custom:false,defaults:{screen:sc.id,x:7,y,size:1,rotation:0,visible:true,...textDefaults(kind,cues[state.cue])}});
 }
 function resolved(entry){const preset=presetEdits(current),patch=entry.custom?preset.objects.find(o=>o.id===entry.id):preset.edits[entry.id];return {...entry.defaults,...patch};}
 function target(r,z){
  const sc=p.screens.find(sc=>sc.id===r.screen)||p.screens[0],x=(sc.x+sc.width*r.x/100)/p.width*2-1,y=1-r.y/50;
  const near=new T.Vector3(x,y,-1).unproject(full),far=new T.Vector3(x,y,1).unproject(full),direction=far.sub(near);return near.addScaledVector(direction,(z-near.z)/direction.z);
 }
 function domEnabled(entry,r){const edited=entry.custom?r:presetEdits(current).edits[entry.id]||{};return r.visible&&!r.deleted&&(entry.custom||edited.visible===true||textPropertyKeys.some(key=>Object.hasOwn(edited,key))||(entry.domId==='headline'?current.headlines:current.branding));}
 function apply(next){current=next;for(const entry of entries){if(entry.domId){entry.defaults.textHtml=textDefaults(entry.textKind,cues[current.cue]).textHtml;continue;}const r=resolved(entry),rotation=r.rotation*Math.PI/180;
  if(entry.kind==='logo'&&!entry.parentId)entry.object.userData.mvSettings={seed:r.seed||0,randomness:r.randomness||0};
  entry.object.userData.authorMotion={motionSpeed:r.motionSpeed??1,motionAmount:r.motionAmount??1,motionAnchor:r.motionAnchor||0,motionOffset:r.motionOffset||0};
  const position=r.x===entry.defaults.x&&r.y===entry.defaults.y&&r.screen===entry.defaults.screen?entry.localAnchor.clone():target(r,entry.anchor.z).applyMatrix4(entry.parentMatrix.clone().invert());
  const anchor=entry.localAnchor.clone().multiplyScalar(r.size).applyAxisAngle(new T.Vector3(0,0,1),rotation);entry.wrap.scale.setScalar(r.size);entry.wrap.rotation.z=rotation;entry.wrap.position.copy(position.sub(anchor));entry.wrap.visible=r.visible&&!r.deleted;
 }}
 function draw(time=currentTime,amount=current.motionAmount){currentTime=time;for(const {pairs,source,clone} of copies){for(const [a,b] of pairs){if(b!==clone){const clock=motionContext(b,time,amount);if(a.userData.motionSpec){const spec=b.userData.motionSpec;b.userData.motionSpec=a.userData.motionSpec;applySample(b,clock.time,clock.amount);b.userData.motionSpec=spec;}else{b.position.copy(a.position);b.quaternion.copy(a.quaternion);b.scale.copy(a.scale);}b.visible=a.visible;}}const clock=motionContext(clone,time,amount);sampledWorld(source,clock.time,clock.amount,wrappers,copyRoots).decompose(clone.position,clone.quaternion,clone.scale);}}
 apply(state);return {apply,draw,pick(x,y){
  const raycaster=new T.Raycaster();raycaster.params.Line.threshold=.09;
  group.updateMatrixWorld(true);raycaster.setFromCamera(new T.Vector2(x*2-1,1-y*2),camera);
  const byObject=new Map(entries.filter(e=>e.object?.geometry).map(e=>[e.object,e]));
  const hits=raycaster.intersectObjects([...byObject.keys()],false).filter(hit=>{for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;return true;});
  const hit=hits.find(h=>!['Soft shadow','Stage floor'].includes(byObject.get(h.object).label))||hits[0];
  const id=elementEditTarget(current,entries,byObject.get(hit?.object)?.id);return id?{id,name:entries.find(e=>e.id===id).name}:null;
 },get manifest(){return entries.filter(entry=>!isElementDeleted(current,entry.id)).map(entry=>{let animated=entry.kind==='logo'&&!entry.parentId;entry.object?.traverse(o=>{if(o.userData.motionSpec)animated=true;});return {id:entry.id,name:entry.name,type:entry.kind||entry.object?.geometry?.type||entry.object?.type||entry.textKind,parentId:entry.parentId,rootId:entry.rootId,depth:entry.depth||0,owner:entry.owner,custom:entry.custom,dom:!!entry.domId,text:!!entry.text,textKind:entry.textKind,mv:entry.kind==='logo'&&!entry.parentId,animated,clock:entry.object?motionContext(entry.object,currentTime,current.motionAmount):null,base:entry.defaults,...resolved(entry),...(entry.domId?{visible:domEnabled(entry,resolved(entry))}:{})};});}};
}
