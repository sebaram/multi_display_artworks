import {youtubeSource,videoTitle} from './youtube-source.js';
// Coordinates describe the physical display, independent of its input raster.
const number=(v,fallback,min,max)=>Number.isFinite(+v)?Math.min(max,Math.max(min,+v)):fallback;
const rect=raw=>({x:number(raw.x,70,0,100),y:number(raw.y,48,0,100),width:number(raw.width,36,5,100),enabled:raw.enabled!==false});
export function sanitizeLayers(raw=[]){
 const ids=new Set();return (Array.isArray(raw)?raw:[]).slice(0,8).map((value,i)=>{
  const layer=value&&typeof value==='object'?value:{};
  let id=String(layer.id||'video-'+(i+1)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)||'video-'+(i+1);while(ids.has(id))id+='-2';ids.add(id);
  const screens={};for(const [key,value] of Object.entries(layer.screens||{}).slice(0,8)){if(!value||typeof value!=='object')continue;const normalized=rect(value);screens[key]={};for(const k of ['x','y','width','enabled'])if(k in value)screens[key][k]=normalized[k];}
  const out={id,videoId:typeof layer.videoId==='string'?layer.videoId.slice(0,60):null,sourceAspect:number(layer.sourceAspect,16/9,.1,32),...rect(layer),screens};
  if(Array.isArray(layer.targets))out.targets=[...new Set(layer.targets.filter(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,50}$/.test(id)))].slice(0,8);
  if(typeof layer.name==='string'&&layer.name.trim())out.name=layer.name.trim().slice(0,160);
  for(const [key,fallback,min,max] of [['motionSpeed',1,0,3],['motionAnchor',0,-1e10,1e10],['motionOffset',0,-1e10,1e10]])if(key in layer)out[key]=number(layer[key],fallback,min,max);
  if(typeof layer.assetId==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(layer.assetId))out.assetId=layer.assetId;
  if(layer.customClip&&typeof layer.customClip.url==='string')out.customClip={url:layer.customClip.url,name:String(layer.customClip.name||'Local video').slice(0,160)};
  const fileName=layer.fileName||(out.customClip?.url.startsWith('blob:')?out.customClip.name:null);if(typeof fileName==='string'&&fileName.trim())out.fileName=fileName.slice(0,160);
  const youtube=youtubeSource(layer.youtube);if(youtube){out.youtube=youtube;delete out.customClip;}
  return out;
 });
}
export function addLayer(state,clip,customClip){
 if(state.videoLayers.length>=8)return state;
 let n=1;while(state.videoLayers.some(l=>l.id==='video-'+n))n++;
 const layer={id:'video-'+n,videoId:clip.id,x:70,y:48,width:36,enabled:true,screens:{}};
 if(customClip)layer.customClip=customClip;
 return {...state,videoLayers:[...state.videoLayers,layer],activeVideoLayer:layer.id,activeElement:videoElementId(layer.id),showVideo:true,editVideos:true,editElements:false};
}
export function patchLayer(state,id,patch,screen='all'){
 return {...state,videoLayers:state.videoLayers.map(layer=>{
  if(layer.id!==id)return layer;
  if(screen!=='all')return {...layer,screens:{...layer.screens,[screen]:{...layer.screens[screen],...patch}}};
  const screens=Object.fromEntries(Object.entries(layer.screens).map(([key,value])=>{const next={...value};for(const k of Object.keys(patch))delete next[k];return [key,next];}));
  return {...layer,...patch,screens};
 })};
}
export const videoElementId=id=>'media:'+id;
export function selectVideoElement(state,id){if(!state.videoLayers.some(l=>l.id===id))return state;return {...state,activeVideoLayer:id,activeElement:videoElementId(id),editVideos:true,editElements:false};}
export function removeLayer(state,id){const videoLayers=state.videoLayers.filter(l=>l.id!==id);return {...state,videoLayers,activeElement:state.activeElement===videoElementId(id)?null:state.activeElement,activeVideoLayer:videoLayers.some(l=>l.id===state.activeVideoLayer)?state.activeVideoLayer:videoLayers.at(-1)?.id||null,showVideo:videoLayers.length>0&&state.showVideo,editVideos:videoLayers.length>0&&state.editVideos};}
export function duplicateVideo(state,source){
 if(!source||state.videoLayers.length>=8)return state;let next=addLayer(state,{id:source.videoId},source.customClip);const id=next.activeVideoLayer;next.videoLayers=next.videoLayers.map(l=>l.id===id?{...structuredClone(source),id,x:Math.min(90,source.x+3),y:Math.min(90,source.y+3)}:l);return selectVideoElement(next,id);
}
export function assignVideoSource(state,id,source){
 if(!source)return state;const cleaned=sanitizeLayers([source])[0],keys=['videoId','assetId','customClip','fileName','youtube','sourceAspect'];let enabledBlank=false;const videoLayers=state.videoLayers.map(layer=>{if(layer.id!==id)return layer;const out={...layer};if(!layer.videoId&&!layer.assetId&&!layer.customClip&&!layer.youtube&&!layer.fileName){out.enabled=true;enabledBlank=true;}for(const key of keys){delete out[key];if(key in cleaned)out[key]=structuredClone(cleaned[key]);}return out;});return {...state,videoLayers,showVideo:enabledBlank||state.showVideo};
}
export function assignVideoScreens(state,id,ids){
 const enabled=new Set(ids.filter(id=>state.screens.some(sc=>sc.id===id))),all=state.screens.every(sc=>enabled.has(sc.id));return {...state,showVideo:enabled.size>0||state.showVideo,videoLayers:state.videoLayers.map(l=>{if(l.id!==id)return l;const screens=Object.fromEntries(Object.entries(l.screens).map(([id,{enabled,...settings}])=>[id,settings]));const next={...l,enabled:enabled.size>0,screens};if(all)delete next.targets;else next.targets=[...enabled];return next;})};
}
export function videoVisibleOn(layer,id){return (!layer.targets||layer.targets.includes(id))&&(layer.screens[id]?.enabled??layer.enabled)!==false;}
export function videoElements(state,clips=[]){return state.videoLayers.map((l,i)=>{const assigned=state.screens.filter(sc=>videoVisibleOn(l,sc.id));return {id:videoElementId(l.id),layerId:l.id,video:true,name:'Video '+(i+1)+' · '+videoTitle(l,clips),parentId:null,depth:0,screen:assigned.length===1?assigned[0].id:'all',screenLabel:assigned.map(sc=>sc.name).join(', ')||'No screens',visible:state.showVideo&&assigned.length>0,motionSpeed:l.motionSpeed??1,sourceKind:l.youtube?'YouTube':l.fileName?'File':'Video'};});}
function playbackLayers(state,playing){return state.videoLayers.map(layer=>({...layer,enabled:playing(layer.id),screens:Object.fromEntries(Object.entries(layer.screens||{}).map(([id,{enabled,...placement}])=>[id,placement]))}));}
export function videoNeedsFile(layer){return !layer.youtube&&!layer.assetId&&!layer.customClip?.url&&(!layer.videoId||!!layer.fileName);}
export function playVideo(state,id){if(!state.videoLayers.some(l=>l.id===id&&!videoNeedsFile(l)))return state;return {...state,activeVideoLayer:id,activeElement:videoElementId(id),editElements:false,showVideo:true,videoLayers:playbackLayers(state,current=>current===id)};}
export function playVideosTogether(state){const ready=new Set(state.videoLayers.filter(l=>!videoNeedsFile(l)).map(l=>l.id));if(!ready.size)return state;return {...state,showVideo:true,videoLayers:playbackLayers(state,id=>ready.has(id))};}
export function placement(layer,screenId,physicalAspect,sourceAspect=layer.sourceAspect||16/9){
 const r={...layer,...layer.screens?.[screenId]},width=Math.min(r.width,100*sourceAspect/physicalAspect),height=width*physicalAspect/sourceAspect;
 return {...r,enabled:videoVisibleOn(layer,screenId),width,height,x:Math.min(100-width/2,Math.max(width/2,r.x)),y:Math.min(100-height/2,Math.max(height/2,r.y))};
}
export function portableLook(state){return {...state,customClip:undefined,editVideos:false,editElements:false,activeElement:null,videoLayers:state.videoLayers.map(({customClip,...layer})=>customClip&&!customClip.url.startsWith('blob:')?{...layer,customClip}:layer)};}
