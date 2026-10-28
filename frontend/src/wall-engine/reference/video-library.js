import {sanitize} from './state.js';
import {addLayer,playVideo,playVideosTogether,removeLayer,videoNeedsFile,videoVisibleOn,selectVideoElement} from './video-layers.js';
import {parseYoutube,videoTitle} from './youtube-source.js';

export function chooseVideo(state,clip,customClip){
 const next=addLayer(sanitize(state),clip,customClip);next.videoId=clip.id;next.cue=clip.cue??0;
 delete next.customClip;return sanitize(next);
}
export function chooseYoutube(state,url,title=''){
 const source=parseYoutube(url);if(!source)throw new Error('Enter a YouTube watch, share, Shorts or embed URL.');
 const base=sanitize(state);if(base.videoLayers.length>=8)return base;
 const next=addLayer(base,{id:null}),layer=next.videoLayers.at(-1);
 layer.youtube={id:source.id,start:source.start,title:title.trim().slice(0,160)||'YouTube / '+source.id};layer.sourceAspect=source.sourceAspect;
 return sanitize(next);
}
export function withoutVideo(state){const next={...state,showVideo:false,videoId:null,videoLayers:[],activeVideoLayer:null};delete next.customClip;return sanitize(next);}
