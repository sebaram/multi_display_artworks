import { applyTextContent } from './reference/text-render.js';
import { wallStyle } from './reference/wall-style.js';
import { textDefaults } from './reference/text-content.js';
import { cues, screenAspect } from './reference/state.js';
import { presetEdits } from './reference/authoring.js';
import { appearanceFor, lightAppearance } from './reference/appearance.js';
import { placement } from './reference/video-layers.js';
import { mediaTarget } from './motion.js';

// Browser layout is measured only after config/size/font changes. Frames never screenshot DOM.
export function createCompositor({canvas,assetResolver,onError=()=>{}}) {
  const doc=canvas.ownerDocument, win=doc.defaultView;
  const frame=doc.createElement('canvas'),text=doc.createElement('canvas');
  const ctx=frame.getContext('2d'),out=canvas.getContext('2d'),tc=text.getContext('2d');
  if(!ctx||!out||!tc)throw new Error('Canvas 2D is unavailable');
  const host=doc.createElement('div');host.dataset.wallLayout='';host.inert=true;host.setAttribute('aria-hidden','true');
  Object.assign(host.style,{position:'fixed',left:'-100000px',top:'0',pointerEvents:'none',contain:'layout style paint'});
  const shadow=host.attachShadow({mode:'open'}),style=doc.createElement('style'),layout=doc.createElement('div');
  shadow.append(style,layout);doc.body.append(host);
  const videos=new Map(),logos=new Map(),ownedUrls=new Set(),fonts=[];
  let state,screenId,elements=[],width=canvas.width||960,height=canvas.height||540,dirty=true,disposed=false,clips=[],clipGeneration=0;
  const error=(code,message,extra={})=>{if(!disposed)onError({code,message,...extra});};
  for(const [name,file] of [['Host Grotesk','hostgrotesk.ttf'],['Atkinson Hyperlegible Mono','atkinsonhyperlegiblemono.ttf']]){
    if(!win.FontFace)continue;
    const face=new win.FontFace(name,`url('/wall-reference/fonts/${file}')`,{weight:name==='Host Grotesk'?'300 800':'200 800'});fonts.push(face);
    face.load().then(()=>{if(!disposed){doc.fonts.add(face);dirty=true;}}).catch(()=>error('font-load',`Could not load ${name}`));
  }
  for(const variant of ['white','color']){
    const image=new win.Image();image.onload=()=>{if(!disposed)dirty=true;};image.onerror=()=>error('logo-load','Could not load bundled logo');
    image.src=`/wall-reference/logo-${variant}.png`;logos.set(variant,image);
  }
  // Catalog clips are source references, not shipped video binaries. Uploaded assets resolve by ID.
  const controller=new AbortController();
  win.fetch('/wall-reference/clips.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('Clip catalog unavailable');return r.json();}).then(value=>{if(!disposed){clips=value;clipGeneration++;if(state)syncVideos();}}).catch(e=>{if(e.name!=='AbortError')error('clip-catalog',e.message);});
  function release(entry){
    entry.generation++;entry.video.pause();entry.video.removeAttribute('src');entry.video.load();entry.video.remove();
    if(entry.ownedUrl){URL.revokeObjectURL(entry.ownedUrl);ownedUrls.delete(entry.ownedUrl);}
  }
  async function assignSource(entry,key){
    const generation=++entry.generation;
    try{
      let source=entry.layer.assetId ? await assetResolver?.(entry.layer.assetId) : entry.layer.customClip?.url||clips.find(c=>c.id===entry.layer.videoId)?.url;
      if(disposed||generation!==entry.generation)return;
      if(!source)throw new Error('Video asset is unavailable');
      if(source instanceof win.Blob){source=URL.createObjectURL(source);ownedUrls.add(source);entry.ownedUrl=source;}
      if(typeof source!=='string'||!(/^(https?:|blob:|data:video\/|\/)/.test(source)))throw new Error('Unsupported video source URL');
      entry.failed=false;entry.video.src=source;entry.video.load();
    }catch(e){if(!disposed&&generation===entry.generation){entry.failed=true;error('video-load',e.message,{layerId:entry.layer.id});}}
  }
  function syncVideos(){
    const layers=state.showVideo?state.videoLayers.filter(l=>!l.youtube&&videoRect(l,l.sourceAspect).enabled):[];const active=new Set(layers.map(l=>l.id));
    for(const [id,entry] of videos)if(!active.has(id)){release(entry);videos.delete(id);}
    for(const layer of layers){
      let entry=videos.get(layer.id);
      if(!entry){
        const video=doc.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;video.loop=true;video.preload='auto';video.crossOrigin='anonymous';
        entry={layer,video,generation:0,key:null,failed:false,blocked:false,playingPromise:null};videos.set(layer.id,entry);
        video.onerror=()=>{entry.failed=true;error('video-load','Video could not be decoded or CORS was denied',{layerId:entry.layer.id});};
      }
      entry.layer=layer;
      const key=JSON.stringify([layer.assetId,layer.customClip?.url,layer.videoId,clipGeneration]);
      if(key!==entry.key){entry.key=key;entry.video.pause();entry.video.removeAttribute('src');entry.video.load();if(entry.ownedUrl){URL.revokeObjectURL(entry.ownedUrl);ownedUrls.delete(entry.ownedUrl);entry.ownedUrl=null;}assignSource(entry,key);}
    }
  }
  function resize(w,h){width=w;height=h;frame.width=text.width=canvas.width=w;frame.height=text.height=canvas.height=h;host.style.width=w+'px';host.style.height=h+'px';dirty=true;}
  function setState(next,view,manifest){state=next;screenId=view;elements=manifest.filter(e=>e.text);dirty=true;syncVideos();}
  function opacity(node,stop){let value=1;for(let el=node;el&&el!==stop;el=el.parentElement)value*=Number(win.getComputedStyle(el).opacity);return value;}
  let textBounds=[];
  function paintLayout(){
    dirty=false;tc.clearRect(0,0,width,height);layout.replaceChildren();textBounds=[];
    style.textContent=wallStyle.replace(/([\d.]+)vh\b/g,(_,n)=>Number(n)*height/100+'px').replace(/([\d.]+)vw\b/g,(_,n)=>Number(n)*width/100+'px').replaceAll('./assets/fonts/','/wall-reference/fonts/');
    layout.className=lightAppearance(state)?'light':'';
    Object.assign(layout.style,{position:'relative',width:width+'px',height:height+'px',color:lightAppearance(state)?'#324353':'#e8eef5',fontFamily:'"Segoe UI","Malgun Gothic",sans-serif'});
    const sc=state.screens.find(s=>s.id===screenId),aspect=screenAspect(sc);
    const correction=width/height/aspect,edited=presetEdits(state);
    for(const entry of elements){
      if(!entry.visible||entry.screen!==screenId||entry.deleted)continue;
      const node=doc.createElement('div');node.id=entry.dom?entry.id.replace('-'+entry.screen,''):entry.id;
      // Stable authored IDs are metadata; CSS selectors only use original overlay names.
      if(entry.custom){node.id='authored-'+entry.id;node.className='authored-text';}
      const sourcePatch=entry.custom?edited.objects.find(o=>o.id===entry.id):edited.edits[entry.id];
      const custom=entry.custom||!!sourcePatch;
      let target=node;
      if(entry.textKind==='signature'){
        node.id='branding';node.style.width=height*(16/9)*.3+'px';
        const image=doc.createElement('img');image.id='wall-logo';const logo=logos.get(lightAppearance(state)?'color':'white');image.src=logo.src;node.append(image);target=doc.createElement('div');target.className='institution';node.append(target);
      }else if(entry.textKind==='headline')node.id='headline';else if(entry.textKind==='footer')node.id='wall-caption';
      layout.append(node);
      applyTextContent(target,{...textDefaults(entry.textKind,cues[state.cue]),...entry},{kind:entry.textKind,cue:cues[state.cue],authored:sourcePatch||{},height});
      if(target===node&&node.classList.contains('authored-rich-text'))node.style.width=entry.textWidth/correction+'%';
      if(custom){node.style.left=entry.x+'%';node.style.top=entry.y+'%';node.style.bottom='auto';}
      node.style.transform='none';node.style.transformOrigin='left top';
      const rootRect=node.getBoundingClientRect(),layoutRect=layout.getBoundingClientRect();
      const x=rootRect.left-layoutRect.left,y=rootRect.top-layoutRect.top;
      tc.save();tc.translate(x,y);tc.scale(correction*entry.size,entry.size);tc.rotate(entry.rotation*Math.PI/180);
      for(const image of node.querySelectorAll('img')){
        const logo=logos.get(lightAppearance(state)?'color':'white');if(!logo.complete||!logo.naturalWidth)continue;
        const rect=image.getBoundingClientRect();tc.globalAlpha=opacity(image,layout);tc.drawImage(logo,rect.left-rootRect.left,rect.top-rootRect.top,rect.width,rect.height);
      }
      const walker=doc.createTreeWalker(node,win.NodeFilter.SHOW_TEXT);let child;
      while((child=walker.nextNode())){
        const css=win.getComputedStyle(child.parentElement),range=doc.createRange();
        let decoration='';for(let el=child.parentElement;el&&el!==node.parentElement;el=el.parentElement)decoration+=' '+win.getComputedStyle(el).textDecorationLine;tc.textAlign='left';tc.globalAlpha=opacity(child.parentElement,layout);tc.font=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;tc.fillStyle=css.color;tc.textBaseline='top';
        let offset=0;
        for(const char of child.textContent){
          const length=char.length;range.setStart(child,offset);range.setEnd(child,offset+length);offset+=length;
          const rect=range.getBoundingClientRect();if(!rect.width||!rect.height||/\s/.test(char))continue;
          const gx=rect.left-rootRect.left,gy=rect.top-rootRect.top;tc.fillText(char,gx,gy);
          if(decoration.includes('underline'))tc.fillRect(gx,gy+parseFloat(css.fontSize),rect.width,Math.max(1,parseFloat(css.fontSize)/18));
          if(decoration.includes('line-through'))tc.fillRect(gx,gy+parseFloat(css.fontSize)*.55,rect.width,Math.max(1,parseFloat(css.fontSize)/18));
        }
      }
      for(const li of node.querySelectorAll('li')){
        const css=win.getComputedStyle(li),rect=li.getBoundingClientRect(),size=parseFloat(css.fontSize),ordered=li.parentElement.tagName==='OL';
        const marker=ordered?([...li.parentElement.children].filter(el=>el.tagName==='LI').indexOf(li)+1)+'.':css.listStyleType==='circle'?'◦':css.listStyleType==='square'?'▪':'•';
        tc.globalAlpha=opacity(li,layout);tc.font=`${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;tc.fillStyle=css.color;tc.textAlign='right';tc.textBaseline='top';tc.fillText(marker,rect.left-rootRect.left-size*.3,rect.top-rootRect.top+(parseFloat(css.lineHeight)-size)/2);
      }
      tc.textAlign='left';
      for(const line of (entry.textKind==='footer'&&!node.classList.contains('authored-rich-text')?node.querySelectorAll(':scope > i:empty'):[])){const rect=line.getBoundingClientRect();if(rect.height&&rect.width){tc.globalAlpha=opacity(line,layout);tc.fillStyle=win.getComputedStyle(line).color;tc.fillRect(rect.left-rootRect.left,rect.top-rootRect.top,rect.width,rect.height);}}
      tc.restore();
      textBounds.push({id:entry.id,x,y,width:rootRect.width,height:rootRect.height,scaleX:correction*entry.size,scaleY:entry.size,rotation:entry.rotation});
    }
    tc.globalAlpha=1;
  }
  function videoRect(layer,aspect){
    const sc=state.screens.find(s=>s.id===screenId),physical=screenAspect(sc);
    return placement(layer,screenId,physical,aspect);
  }
  function drawVideo(entry,playback){
    const {video,layer}=entry,r=videoRect(layer,video.videoWidth/video.videoHeight||layer.sourceAspect);
    if(!state.showVideo||!r.enabled){video.pause();return;}
    const target=mediaTarget(playback.positionSeconds,layer,video.duration);
    if(video.readyState>=1&&Math.abs(video.currentTime-target)>(playback.playing?.5:.001))try{video.currentTime=target;}catch(e){error('video-seek',e.message,{layerId:layer.id});}
    const playing=playback.playing&&playback.rate>0&&(layer.motionSpeed??1)>0;
    if(!playing)video.pause();
    else if(video.readyState>=2&&!entry.failed){
      video.playbackRate=Math.max(.0625,Math.min(16,playback.rate*(layer.motionSpeed??1)));
      if(video.paused&&!entry.playingPromise)entry.playingPromise=video.play().then(()=>{entry.blocked=false;}).catch(e=>{if(!entry.blocked){entry.blocked=true;error('video-autoplay',e.message,{layerId:layer.id});}}).finally(()=>{entry.playingPromise=null;});
    }
    const x=(r.x-r.width/2)/100*width,y=(r.y-r.height/2)/100*height,w=r.width/100*width,h=r.height/100*height;
    ctx.save();ctx.shadowColor='#0005';ctx.shadowBlur=height*.03;ctx.shadowOffsetY=height*.01;ctx.fillStyle='#0b1625';ctx.fillRect(x,y,w,h);ctx.restore();
    if(video.readyState>=2&&!entry.failed)try{ctx.drawImage(video,x,y,w,h);}catch(e){entry.failed=true;error('video-compose',e.message,{layerId:layer.id});}
    else {ctx.fillStyle='#cbd5e2';ctx.font=`${height*.02}px sans-serif`;ctx.fillText(entry.failed?'Video unavailable':'Loading video',x+w*.05,y+h*.5,w*.9);}
  }
  function render(source,playback){
    if(disposed)return;
    if(dirty)paintLayout();
    ctx.clearRect(0,0,width,height);ctx.drawImage(source,0,0,width,height);
    if(appearanceFor(state).mode!=='solid'){
      const light=lightAppearance(state),cx=width*(light?.4:.45),cy=height*(light?.5:.53),rx=Math.max(cx,width-cx)*Math.SQRT2,ry=Math.max(cy,height-cy)*Math.SQRT2;ctx.save();ctx.translate(cx,cy);ctx.scale(rx,ry);const g=ctx.createRadialGradient(0,0,0,0,0,1);g.addColorStop(light?.3:.25,'#0000');g.addColorStop(1,light?'#938a731a':'#0003');ctx.fillStyle=g;ctx.fillRect(-cx/rx,-cy/ry,width/rx,height/ry);ctx.restore();
    }
    for(const layer of state.videoLayers){
      if(layer.youtube){
        const r=videoRect(layer,layer.sourceAspect);if(!state.showVideo||!r.enabled)continue;
        const x=(r.x-r.width/2)*width/100,y=(r.y-r.height/2)*height/100,w=r.width*width/100,h=r.height*height/100;
        ctx.fillStyle='#132235';ctx.fillRect(x,y,w,h);ctx.fillStyle='#d8e5f4';ctx.font=`${height*.025}px sans-serif`;ctx.fillText(layer.youtube.title||'YouTube',x+w*.05,y+h*.4,w*.9);ctx.font=`${height*.018}px sans-serif`;ctx.fillText('Open synchronized player ↗',x+w*.05,y+h*.65,w*.9);
      }else {const entry=videos.get(layer.id);if(entry)drawVideo(entry,playback);}
    }
    ctx.drawImage(text,0,0);out.clearRect(0,0,width,height);out.filter=`brightness(${state.brightness}%)`;out.drawImage(frame,0,0);out.filter='none';
    const sc=state.screens.find(s=>s.id===screenId);
    if(sc.grid){out.fillStyle='#000b';for(let i=1;i<sc.cols;i++)out.fillRect(width*i/sc.cols-2,0,2,height);for(let i=1;i<sc.rows;i++)out.fillRect(0,height*i/sc.rows-2,width,2);}
  }
  return {resize,setState,render,
    pick(x,y){const px=x*width,py=y*height;for(const b of [...textBounds].reverse()){const dx=(px-b.x)/b.scaleX,dy=(py-b.y)/b.scaleY,a=-b.rotation*Math.PI/180,lx=dx*Math.cos(a)-dy*Math.sin(a),ly=dx*Math.sin(a)+dy*Math.cos(a);if(lx>=0&&ly>=0&&lx<=b.width&&ly<=b.height)return {id:b.id};}if(state.showVideo)for(const layer of [...state.videoLayers].reverse()){const video=videos.get(layer.id)?.video,r=videoRect(layer,video?.videoWidth/video?.videoHeight||layer.sourceAspect);if(r.enabled&&x>=(r.x-r.width/2)/100&&x<=(r.x+r.width/2)/100&&y>=(r.y-r.height/2)/100&&y<=(r.y+r.height/2)/100)return {id:'media:'+layer.id};}return null;},
    getMedia(){return [...videos.values()].map(e=>({id:e.layer.id,ready:e.video.readyState,currentTime:e.video.currentTime,paused:e.video.paused,blocked:e.blocked,failed:e.failed}));},
    getYouTubeLayers(playback){return state.videoLayers.filter(l=>l.youtube).map(layer=>({...structuredClone(layer),placement:videoRect(layer,layer.sourceAspect),playback:{...playback},composited:false}));},
    dispose(){if(disposed)return;disposed=true;controller.abort();for(const entry of videos.values())release(entry);videos.clear();for(const face of fonts)doc.fonts.delete(face);for(const image of logos.values()){image.onload=image.onerror=null;image.src='';}logos.clear();host.remove();frame.width=frame.height=text.width=text.height=1;for(const url of ownedUrls)URL.revokeObjectURL(url);ownedUrls.clear();layout.replaceChildren();}
  };
}
