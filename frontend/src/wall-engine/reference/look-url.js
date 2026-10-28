import {sanitize} from './state.js';
import {portableLook} from './video-layers.js';

const PREFIX='#look=v1.',MAX_HASH_LENGTH=200000;
const KEYS=['screens','variant','brightness','speed','motionAmount','paused','offset','branding','headlines','interactive','showVideo','videoId','cue','videoLayers','authored','appearance'];
const pick=state=>Object.fromEntries(KEYS.filter(key=>Object.hasOwn(state,key)).map(key=>[key,state[key]]));
function configuration(state){
 const look=pick(portableLook(sanitize(pick(state))));
 if(!look.paused)look.offset=0;
 return look;
}
const sorted=(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value;

// Only authored configuration travels in the fragment; running clocks restart on load.
export function encodeLook(state={}){
 const bytes=new TextEncoder().encode(JSON.stringify(configuration(state),sorted));
 if(PREFIX.length+Math.ceil(bytes.length/3)*4>MAX_HASH_LENGTH)throw new RangeError('This look is too large to store in a URL.');
 let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return PREFIX+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export function decodeLook(hash){
 if(typeof hash!=='string'||hash.length>MAX_HASH_LENGTH||!hash.startsWith(PREFIX))return null;
 const encoded=hash.slice(PREFIX.length);
 if(!/^[A-Za-z0-9_-]+$/.test(encoded)||encoded.length%4===1)return null;
 try{
  const binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  return sanitize({...configuration(raw),epoch:Date.now()});
 }catch{return null;}
}

export function lookUrl(state,base){return String(base).split('#',1)[0]+encodeLook(state);}

// Live outputs may use files owned by their matching opener; bookmarks stay portable.
export function liveOutputLook(saved,live){
 if(!saved||!live)return saved;
 try{if(encodeLook(saved)!==encodeLook(live))return saved;return sanitize({...saved,videoLayers:live.videoLayers,epoch:live.epoch,offset:live.offset});}catch{return saved;}
}
