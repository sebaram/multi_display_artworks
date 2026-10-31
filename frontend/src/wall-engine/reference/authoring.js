import {cleanTextProperties,textDefaults,textPropertyKeys} from './text-content.js';
import {sanitizeLayers} from './video-layers.js';
import {researchObjectTypes} from './research-objects.js';
import {PRESET_COUNT} from './preset-catalog.js';
export const objectTypes=[['logo','MV sculpture'],['ribbons','Real / virtual ribbons'],['orbits','Orbital sculpture'],['network','Research network'],['sphere','Sculptural sphere'],['arch','Architectural arch'],...researchObjectTypes,['text','Text element']];
const limit=(v,min,max)=>Math.min(max,Math.max(min,+v));
export function cleanTransform(raw={}){
 const out={...cleanTextProperties(raw)};for(const [key,min,max] of [['x',-50,150],['y',-50,150],['size',.05,6],['rotation',-180,180],['seed',0,999999],['randomness',0,2],['motionSpeed',0,3],['motionAmount',0,2],['motionAnchor',-1e10,1e10],['motionOffset',-1e10,1e10]])if(raw[key]!==undefined&&Number.isFinite(+raw[key]))out[key]=key==='seed'?Math.floor(limit(raw[key],min,max)):limit(raw[key],min,max);
 if(typeof raw.screen==='string')out.screen=raw.screen.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50);
 if('visible' in raw)out.visible=raw.visible!==false;if('deleted' in raw)out.deleted=Boolean(raw.deleted);if('ungrouped' in raw)out.ungrouped=raw.ungrouped===true;return out;
}
export function sanitizeAuthored(raw={}){
 const out={};for(let i=0;i<PRESET_COUNT;i++){
  const preset=raw?.[i];if(!preset||typeof preset!=='object')continue;
  const edits={};for(const [id,patch] of Object.entries(preset.edits||{}).slice(0,4096))if(/^[a-zA-Z0-9_-]{1,160}$/.test(id)&&patch&&typeof patch==='object')edits[id]=cleanTransform(patch);
  const ids=new Set(),objects=(Array.isArray(preset.objects)?preset.objects:[]).slice(0,32).filter(o=>o&&typeof o==='object'&&[...objectTypes.map(t=>t[0]),'copy'].includes(o.type)).map((o,i)=>{let id=String(o.id||'object-'+(i+1)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);while(ids.has(id))id+='-2';ids.add(id);return {id,type:o.type,source:typeof o.source==='string'?o.source.slice(0,160):null,archived:Boolean(o.archived),...cleanTransform(o)};});
  out[i]={edits,objects};
 }return out;
}
export function presetEdits(state){return state.authored[state.variant]||{edits:{},objects:[]};}
export function elementEditTarget(state,elements,id){
 const byId=elements instanceof Map?elements:new Map(elements.map(e=>[e.id,e]));let entry=byId.get(id);if(!entry)return null;
 const preset=presetEdits(state),seen=new Set();let target=id;
 while(entry?.parentId&&!seen.has(entry.parentId)){seen.add(entry.parentId);entry=byId.get(entry.parentId);if(!entry)break;const settings=entry.custom?preset.objects.find(o=>o.id===entry.id):preset.edits[entry.id];if(!settings?.ungrouped)target=entry.id;}
 return target;
}
export function inElementSubtree(id,root){return typeof id==='string'&&(id===root||id.startsWith(root+(root.includes('-part-')?'-':'-part-')));}
export function isElementDeleted(state,id){const preset=presetEdits(state);return Object.entries(preset.edits).some(([root,patch])=>patch.deleted&&inElementSubtree(id,root))||preset.objects.some(o=>(o.archived||o.deleted)&&inElementSubtree(id,o.id));}
export function isLogoElement(state,id){if(!id||id.includes('-part-'))return false;const seen=new Set(),objects=presetEdits(state).objects;while(id&&!seen.has(id)){if(id.startsWith('preset-logo-'))return true;seen.add(id);const object=objects.find(o=>o.id===id);if(object?.type==='logo')return true;id=object?.type==='copy'?object.source:null;}return false;}
export function nextLogoSeed(state){const values=Object.values(state.authored).flatMap(p=>[...p.objects,...Object.values(p.edits)]);const used=new Set(values.map(o=>o.seed||0));let seed=((Math.max(0,...used)+1)%1000000)||1;while(used.has(seed))seed=seed%999999+1;return seed;}
export function randomizeElement(state,id){const preset=presetEdits(state),settings=preset.objects.find(o=>o.id===id)||preset.edits[id]||{};return patchElement(state,id,{seed:nextLogoSeed(state),randomness:settings.randomness>0?settings.randomness:1});}
export function patchElement(state,id,patch){const preset=presetEdits(state),custom=preset.objects.some(o=>o.id===id);return {...state,authored:{...state.authored,[state.variant]:custom?{...preset,objects:preset.objects.map(o=>o.id===id?{...o,...cleanTransform(patch)}:o)}:{...preset,edits:{...preset.edits,[id]:{...preset.edits[id],...cleanTransform(patch)}}}}};}
export function addElement(state,type,transform={},source=null){
 const preset=presetEdits(state);if(preset.objects.length>=32)return state;let n=1;while(preset.objects.some(o=>o.id==='object-'+n))n++;const id='object-'+n,edits=Object.fromEntries(Object.entries(preset.edits).filter(([part])=>!inElementSubtree(part,id)));
 // Descendant edits are copied once so each duplicate can be authored independently.
 if(type==='copy'&&source){const prefix=source+(source.includes('-part-')?'-':'-part-');for(const [part,patch] of Object.entries(preset.edits))if(part.startsWith(prefix))edits[id+'-part-'+part.slice(prefix.length)]={...patch};}
 const variation=type==='logo'||type==='copy'&&isLogoElement(state,source)?{seed:nextLogoSeed(state),randomness:1}:{};
 return {...state,authored:{...state.authored,[state.variant]:{...preset,edits,objects:[...preset.objects,{id,type,source,screen:state.screens[0].id,x:type==='text'?7:50,y:50,size:1,rotation:0,visible:true,...variation,...(type==='text'?textDefaults():{}),...cleanTransform(transform)}]}},activeElement:id,editElements:true,editVideos:false};
}
export function removeElement(state,id){
 if(isElementDeleted(state,id))return state;
 if(/^object-\d+(?:$|-part-)/.test(id)&&!presetEdits(state).objects.some(o=>inElementSubtree(id,o.id)))return state;
 const preset=presetEdits(state),activeElement=inElementSubtree(state.activeElement,id)?null:state.activeElement;if(!preset.objects.some(o=>o.id===id))return {...patchElement(state,id,{visible:false,deleted:true}),activeElement};
 const dependsOn=(object,root)=>object.source===root||object.source?.startsWith(root+'-part-');
 let objects=preset.objects.some(o=>dependsOn(o,id))?preset.objects.map(o=>o.id===id?{...o,archived:true,visible:false}:o):preset.objects.filter(o=>o.id!==id);
 let changed=true;while(changed){const previous=objects.length;objects=objects.filter(o=>!o.archived||objects.some(child=>dependsOn(child,o.id)));changed=objects.length!==previous;}
 const removed=preset.objects.filter(o=>!objects.some(remaining=>remaining.id===o.id)),edits=Object.fromEntries(Object.entries(preset.edits).filter(([part])=>!removed.some(o=>part===o.id||part.startsWith(o.id+'-part-'))));
 return {...state,activeElement,authored:{...state.authored,[state.variant]:{...preset,edits,objects}}};
}
export function resetElement(state,id){const preset=presetEdits(state),edits={...preset.edits};delete edits[id];return {...state,authored:{...state.authored,[state.variant]:{...preset,edits}}};}

export function resetTextElement(state,id){
 const preset=presetEdits(state),strip=value=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>!textPropertyKeys.includes(key)));
 return {...state,authored:{...state.authored,[state.variant]:{...preset,edits:{...preset.edits,...(!preset.objects.some(o=>o.id===id)?{[id]:strip(preset.edits[id])}:{})},objects:preset.objects.map(o=>o.id===id?strip(o):o)}}};
}

// The clipboard stays in this editor tab. Its snapshot survives source deletion.
export function copyElement(state,element){
 if(!element||element.dom&&!element.text||isElementDeleted(state,element.id))return null;
 return structuredClone({variant:state.variant,element,preset:presetEdits(state)});
}
export function pasteElement(state,clipboard){
 if(!clipboard||clipboard.variant!==state.variant)return state;
 if(clipboard.element.text){const e=clipboard.element;return addElement(state,'text',{...cleanTransform(e),x:Math.min(140,e.x+4),visible:true});}
 const snapshot=clipboard.preset,preset=presetEdits(state),objects=[...preset.objects],edits={...preset.edits},mapped=new Map();
 const freeId=()=>{let n=1;while(objects.some(o=>o.id==='object-'+n))n++;return 'object-'+n;};
 function ensureSource(id){
  const owner=snapshot.objects.find(o=>inElementSubtree(id,o.id));
  if(!owner){
   const root=id.split('-part-')[0],before=snapshot.edits[root]||{},now=preset.edits[root]||{};
   if(id.includes('-part-')&&root.startsWith('preset-logo-')&&((before.seed||0)!==(now.seed||0)||(before.randomness||0)!==(now.randomness||0))){
    if(!mapped.has(root)){const nextId=freeId();objects.push({id:nextId,type:'copy',source:root,archived:true,visible:false,seed:before.seed||0,randomness:before.randomness||0});mapped.set(root,nextId);}
    return mapped.get(root)+id.slice(root.length);
   }
   return id;
  }
  if(!mapped.has(owner.id)){
   const source=owner.type==='copy'?ensureSource(owner.source):owner.source;
   const existing=objects.find(o=>o.id===owner.id&&o.type===owner.type&&o.source===source&&(o.seed||0)===(owner.seed||0)&&(o.randomness||0)===(owner.randomness||0));
   if(existing)mapped.set(owner.id,existing.id);
   else {
    const nextId=freeId();
    objects.push({...owner,id:nextId,source,archived:true,visible:false});mapped.set(owner.id,nextId);
    for(const [part,patch] of Object.entries(snapshot.edits))if(inElementSubtree(part,owner.id))edits[nextId+part.slice(owner.id.length)]={...patch};
   }
  }
  return mapped.get(owner.id)+id.slice(owner.id.length);
 }
 const source=ensureSource(clipboard.element.id);if(objects.length>=32)return state;
 const element=clipboard.element;
 let next=addElement({...state,authored:{...state.authored,[state.variant]:{objects,edits}}},'copy',{screen:element.screen,x:Math.min(140,element.x+5),y:element.y,size:element.size,rotation:element.rotation,visible:true,...Object.fromEntries(['motionSpeed','motionAmount','motionAnchor','motionOffset'].filter(k=>element[k]!==undefined).map(k=>[k,element[k]]))},source);
 const nextPreset=presetEdits(next),id=next.activeElement,prefix=clipboard.element.id+(clipboard.element.id.includes('-part-')?'-':'-part-');
 nextPreset.edits=Object.fromEntries(Object.entries(nextPreset.edits).filter(([part])=>!inElementSubtree(part,id)));
 for(const [part,patch] of Object.entries(snapshot.edits))if(part.startsWith(prefix))nextPreset.edits[id+'-part-'+part.slice(prefix.length)]={...patch};
 return next;
}

export function authoringHistory(){
 let past=[],future=[],observed=null,grouped=false,recorded=false;
 const stamp=state=>JSON.stringify([sanitizeAuthored(state.authored),sanitizeLayers(state.videoLayers),!!state.showVideo]),snapshot=state=>structuredClone({authored:sanitizeAuthored(state.authored),videoLayers:sanitizeLayers(state.videoLayers),showVideo:!!state.showVideo,activeVideoLayer:state.activeVideoLayer,variant:state.variant,activeElement:state.activeElement,editElements:state.editElements,editVideos:state.editVideos});
 function observe(state){const key=stamp(state);if(observed!==null&&key!==observed){past=[];future=[];grouped=false;recorded=false;}observed=key;}
 function restore(state,from,to){if(!from.length)return state;to.push(snapshot(state));const saved=from.pop(),next={...state,...saved};observed=stamp(next);grouped=false;recorded=false;return next;}
 return {observe,accept(state){observed=stamp(state);},begin(){grouped=true;recorded=false;},end(){grouped=false;recorded=false;},record(before,after){observe(before);if(stamp(before)===stamp(after))return;if(!grouped||!recorded){past.push(snapshot(before));if(past.length>40)past.shift();}recorded=true;future=[];observed=stamp(after);},undo(state){observe(state);return restore(state,past,future);},redo(state){observe(state);return restore(state,future,past);},get canUndo(){return past.length>0;},get canRedo(){return future.length>0;}};
}
