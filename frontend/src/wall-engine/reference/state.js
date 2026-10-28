import {sanitizeLayers} from './video-layers.js';
import {sanitizeAuthored} from './authoring.js';
import {sanitizeAppearance} from './appearance.js';
import {kineticPresets} from './preset-catalog.js';
export {appearanceFor,patchAppearance} from './appearance.js';
export const KEY='gsmv-interview-walls-v1';
export const variants=Object.freeze([
 {name:'Blue Hour',tag:'ORBITAL / IMMERSIVE',tone:'#90beff',desc:'Sculptural orbits in a deep blue atmosphere. A quiet, confident setting for faculty interviews.',use:'Recommended · faculty & opening'},
 {name:'Common Ground',tag:'REAL ↔ VIRTUAL',tone:'#ff9687',desc:'Red represents the real world; blue represents the virtual. Interwoven ribbons show their continuous exchange.',use:'Real ↔ virtual · shared experiences'},
 {name:'Soft Architecture',tag:'SPATIAL / EDITORIAL',tone:'#ddd3b9',desc:'Warm porcelain forms, architectural depth and soft light. An open, understated research studio.',use:'Spatial design · bright studio look'},
 {name:'Living Research',tag:'RESEARCH / IN MOTION',tone:'#a2ded1',desc:'Your actual research footage suspended in a moving digital gallery on every screen. Choose a video to match the conversation.',use:'Lab interviews · research & innovation'},
 {name:'Shared Reality',tag:'REAL + VIRTUAL + RESEARCH',tone:'#b6baff',desc:'Living research inside Common Ground. Red reality and blue virtual ribbons flow around your research, connecting each screen.',use:'Combined direction · recommended'},
 {name:'MV Symbiosis',tag:'LOGO / TRANSFORMATION',tone:'#91c9f4',desc:'Six facets from the MV symbol become soft forms, exchange shape and position, consolidate into the mark, and unfold together again.',use:'Department identity · real and virtual in symbiosis'},
 {name:'Serein Atelier',tag:'LIMESTONE / BRONZE / LIGHT',tone:'#d5bb92',desc:'A warm limestone atelier with a recessed alcove and slowly turning bronze leaves. Grounded architecture frames a quiet center for seated or standing interviews.',use:'Floor-level LED · warm architectural interview'},
 {name:'MV Light Court',tag:'REAL / VIRTUAL / MATERIAL',tone:'#79b8df',desc:'A graphite light court pairs a grounded red lacquer form with blue optical blades. Restrained material contrast and a calm center give the conversation room.',use:'Floor-level LED · dark material study'},
 ...kineticPresets
].map(Object.freeze));
export const cues=[
 {name:'Space design',ko:'공간을 설계하다',en:'METAVERSE SPACE DESIGN',lab:'01 / SPACE',clip:'P2-S1-02',color:'#388fff'},
 {name:'Telepresence',ko:'사람을 연결하다',en:'3D TELEPRESENCE',lab:'02 / PEOPLE',clip:'P2-S2-02',color:'#7a9fff'},
 {name:'Multimodal AI',ko:'지능을 더하다',en:'MULTIMODAL INTERACTION',lab:'03 / INTELLIGENCE',clip:'P2-S3-01',color:'#8b96ff'},
 {name:'Space × People × AI',ko:'하나로 융합하다',en:'SPACE × PEOPLE × AI',lab:'04 / CONVERGENCE',clip:'P2-S4-01',color:'#df8aa3'},
 {name:'Haptic experience',ko:'경험을 확장하다',en:'HAPTIC FEEDBACK',lab:'05 / EXPERIENCE',clip:'P2-S5-01',color:'#ef8d8d'},
 {name:'Metaverse economics',ko:'함께 살아갈 세계',en:'METAVERSE ECONOMICS',lab:'06 / SOCIETY',clip:null,color:'#80c8c6'}
];
export const defaults={variant:4,cue:0,videoId:null,showVideo:false,brightness:70,speed:1,motionAmount:1,paused:false,epoch:0,offset:0,branding:true,headlines:false,guide:false,calibration:false,interactive:false,frontW:3840,frontH:2160,leftW:3840,leftH:2160,leftShape:'tiles',bezel:0};
let clockOffset=0;
export function setClockOffset(value){clockOffset=value;}
export function currentTime(){return 0+clockOffset;}
const num=(v,d,min,max)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):d;
export function sanitize(raw={}){
 const s={...defaults,...raw};
 for(const k of ['variant','cue']) s[k]=Number.isInteger(s[k])&&s[k]>=0&&s[k]<(k==='variant'?variants.length:6)?s[k]:0;
 for(const k of ['frontW','frontH','leftW','leftH']) s[k]=Number.isFinite(Number(s[k]))&&Number(s[k])>0?Math.round(Math.min(16384,Number(s[k]))):defaults[k];
 s.brightness=num(s.brightness,70,10,100);s.speed=num(s.speed,1,0,3);s.motionAmount=num(s.motionAmount,1,0,2);s.bezel=[0,2,3,4,32].includes(+s.bezel)?+s.bezel:0;s.leftShape=s.leftShape==='raster'?'raster':'tiles';
 s.epoch=num(s.epoch,0,0,1e14);s.offset=num(s.offset,0,0,1e10);
 for(const k of ['paused','branding','headlines','guide','calibration','interactive'])s[k]=Boolean(s[k]);
 s.showVideo=raw.showVideo===true;s.videoId=typeof raw.videoId==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(raw.videoId)?raw.videoId:null;
 s.videoLayers=sanitizeLayers(Array.isArray(raw.videoLayers)?raw.videoLayers:raw.showVideo===true?[{id:'video-1',videoId:s.videoId||cues[s.cue].clip,customClip:raw.customClip}]:[]);
 s.activeVideoLayer=s.videoLayers.some(l=>l.id===raw.activeVideoLayer)?raw.activeVideoLayer:s.videoLayers.at(-1)?.id||null;
 s.editVideos=Boolean(raw.editVideos);
 s.authored=sanitizeAuthored(raw.authored);s.editElements=Boolean(raw.editElements);s.activeElement=typeof raw.activeElement==='string'?raw.activeElement:null;
 s.appearance=sanitizeAppearance(raw.appearance);
 const legacy=[{id:'left',name:'Left tiled wall',width:s.leftW,height:s.leftH,mode:s.leftShape==='tiles'?'tiles':'raster',cols:s.bezel===32?3:s.bezel||3,rows:s.bezel===32?2:s.bezel||2,grid:!!s.bezel},{id:'front',name:'Front LED wall',width:s.frontW,height:s.frontH,mode:'raster',cols:1,rows:1}];
 const incoming=Array.isArray(raw.screens)&&raw.screens.length?raw.screens.slice(0,8):legacy;
 const ids=new Set();s.screens=incoming.map((screen,i)=>{const sc=sanitizeScreen(screen,i);while(ids.has(sc.id))sc.id+='-2';ids.add(sc.id);return sc;});
 const front=s.screens.find(x=>x.id==='front')||s.screens[0],left=s.screens.find(x=>x.id==='left')||s.screens[0];
 s.frontW=front.width;s.frontH=front.height;s.leftW=left.width;s.leftH=left.height;s.leftShape=left.mode==='tiles'?'tiles':'raster';
 return s;
}


export function timeline(s,now=currentTime()){return s.offset+(s.paused?0:Math.max(0,now-s.epoch)/1000*s.speed);}
export function setPaused(s,paused,now=currentTime()){return {...s,offset:timeline(s,now),epoch:now,paused};}
export function setSpeed(s,speed,now=currentTime()){return {...s,offset:timeline(s,now),epoch:now,speed};}
export function leftAspect(s){return s.leftShape==='tiles'?8/3:s.leftW/s.leftH;}
export function sanitizeScreen(raw={},i=0){
 const sc=raw&&typeof raw==='object'?raw:{};
 const positive=(v,d,max=16384)=>Number.isFinite(+v)&&+v>0?Math.min(max,+v):d;
 return {id:String(sc.id||'screen-'+(i+1)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50)||'screen-'+(i+1),name:String(sc.name||'Screen '+(i+1)).slice(0,80),width:Math.round(positive(sc.width,3840)),height:Math.round(positive(sc.height,2160)),mode:['raster','tiles','custom'].includes(sc.mode)?sc.mode:'raster',cols:Math.round(positive(sc.cols,1,32)),rows:Math.round(positive(sc.rows,1,32)),tileW:positive(sc.tileW,16,1000),tileH:positive(sc.tileH,9,1000),aspectW:positive(sc.aspectW,16,1000),aspectH:positive(sc.aspectH,9,1000),grid:Boolean(sc.grid)};
}
export function screenAspect(sc){const a=sc.mode==='tiles'?(sc.cols*sc.tileW)/(sc.rows*sc.tileH):sc.mode==='custom'?sc.aspectW/sc.aspectH:sc.width/sc.height;return Math.min(32,Math.max(.1,a));}
export function createScreen(s){let n=1;while(s.screens.some(sc=>sc.id==='screen-'+n))n++;return sanitize({...s,screens:[...s.screens,{id:'screen-'+n,name:'Screen '+(s.screens.length+1),width:3840,height:2160,mode:'raster',cols:1,rows:1}]});}
export function updateScreen(s,id,patch){return sanitize({...s,screens:s.screens.map(sc=>sc.id===id?{...sc,...patch,id}:sc)});}
export function removeScreen(s,id){return s.screens.length>1?sanitize({...s,screens:s.screens.filter(sc=>sc.id!==id)}):s;}
export function panorama(s){
 const h=1080,screens=(s.screens||sanitize(s).screens);let x=0;
 const projected=screens.map(sc=>{const out={...sc,x,width:Math.round(h*screenAspect(sc)),height:h,config:sc};x+=out.width;return out;});
 const out={width:x,height:h,screens:projected};for(const sc of projected)out[sc.id]=sc;
 out.front??=projected[0];out.left??=projected[0];return out;
}

// Built-ins are code-owned. Artwork edits only belong to the working look.
export function hasArtworkEdits(state){return Object.values(state.authored||{}).some(p=>p.objects?.length||Object.keys(p.edits||{}).length)||Object.values(state.appearance||{}).some(p=>Object.keys(p).length);}
export function freshPresetDraft(raw,variant,now=currentTime()){
 if(!Number.isInteger(variant)||variant<0||variant>=variants.length)throw new RangeError('Unknown built-in preset');
 const state=sanitize(raw);
 return sanitize({...state,variant,authored:{},appearance:{},activeElement:null,editElements:false,editVideos:false,offset:variant===5?10/Math.max(.1,state.motionAmount):0,epoch:now});
}
