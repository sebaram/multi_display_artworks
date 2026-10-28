const videoId=/^[A-Za-z0-9_-]{11}$/;
export function youtubeSource(raw){
 if(!raw||!videoId.test(raw.id||''))return null;
 return {id:raw.id,start:Number.isFinite(+raw.start)?Math.min(604800,Math.max(0,Math.floor(+raw.start))):0,title:String(raw.title||'YouTube video').slice(0,160)};
}
function seconds(value='0'){
 if(/^\d+$/.test(value))return +value;
 const match=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);return match?Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0):0;
}
export function parseYoutube(value){
 const text=String(value||'').trim();if(videoId.test(text))return {...youtubeSource({id:text}),sourceAspect:16/9};
 try{
  const url=new URL(/^https?:\/\//i.test(text)?text:'https://'+text),host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)return null;
  let id;if(['youtu.be','www.youtu.be'].includes(host))id=parts.length===1?parts[0]:null;
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host))id=parts[0]==='watch'?url.searchParams.get('v'):['embed','shorts','live'].includes(parts[0])&&parts.length===2?parts[1]:null;
  else return null;
  const source=youtubeSource({id,start:seconds(url.searchParams.get('start')||url.searchParams.get('t')||new URLSearchParams(url.hash.slice(1)).get('t')||'0')});
  return source?{...source,sourceAspect:parts[0]==='shorts'?9/16:16/9}:null;
 }catch{return null;}
}
export function videoTitle(layer,clips=[]){return layer.name||layer.youtube?.title||layer.customClip?.name||layer.fileName||clips.find(c=>c.id===layer.videoId)?.title||'Video';}
