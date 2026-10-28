import { normalizeWallLook } from './config.js';
import { createSourceScene } from './reference/scene.js';
import { videoElements } from './reference/video-layers.js';
import { createCompositor } from './compositor.js';

/** Caller owns RAF and canonical clocks. The supplied canvas is the only scene boundary. */
export function createWallRenderer({canvas,config,assetResolver,onError=()=>{}}) {
  if(!canvas?.ownerDocument)throw new TypeError('A browser canvas is required');
  let look=normalizeWallLook(config),disposed=false,lost=false,lastTime=0,lastPlayback={positionSeconds:0,playing:false,rate:1};
  const sourceCanvas=canvas.ownerDocument.createElement('canvas');sourceCanvas.width=canvas.width||960;sourceCanvas.height=canvas.height||540;
  let compositor,source;
  try {
    compositor=createCompositor({canvas,assetResolver,onError});
    source=createSourceScene({canvas:sourceCanvas,state:{...look.state,seed:look.seed},view:look.logical_screen,onError});
  }catch(error){compositor?.dispose();source?.dispose();onError({code:'renderer-start',message:error.message});throw error;}
  function contextLost(event){event.preventDefault();lost=true;onError({code:'context-lost',message:'Wall WebGL context was lost'});}
  function contextRestored(){if(disposed)return;lost=false;source.restore();compositor.setState(look.state,look.logical_screen,source.manifest);}
  sourceCanvas.addEventListener('webglcontextlost',contextLost);sourceCanvas.addEventListener('webglcontextrestored',contextRestored);
  function assertActive(){if(disposed)throw new Error('Wall renderer was disposed');}
  function resize(width,height){
    assertActive();if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>8192||height>8192)throw new RangeError('Canvas dimensions must be between 1 and 8192');
    width=Math.round(width);height=Math.round(height);source.resize(width,height);compositor.resize(width,height);compositor.setState(look.state,look.logical_screen,source.manifest);
  }
  function setConfig(next){assertActive();const normalized=normalizeWallLook(next);source.setState({...normalized.state,seed:normalized.seed},normalized.logical_screen);look=normalized;compositor.setState(look.state,look.logical_screen,source.manifest);}
  function render(timeSeconds,playback){
    assertActive();if(!Number.isFinite(timeSeconds))throw new TypeError('Render time must be finite');
    const clock=playback??{positionSeconds:timeSeconds,playing:!look.state.paused,rate:look.state.speed};
    if(!Number.isFinite(clock.positionSeconds)||!Number.isFinite(clock.rate)||clock.rate<0)throw new TypeError('Playback clock must be finite with a nonnegative rate');
    lastTime=timeSeconds;lastPlayback={...clock};if(lost)return;
    source.render(timeSeconds);compositor.render(sourceCanvas,lastPlayback);
  }
  resize(canvas.width||960,canvas.height||540);
  return {setConfig,resize,render,
    setInteraction({x,y}){assertActive();if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>.5||Math.abs(y)>.5)throw new RangeError('Pointer coordinates must be between -0.5 and 0.5');source.setInteraction({x,y});},
    getElements(){assertActive();return structuredClone([...source.manifest,...videoElements(look.state).map(e=>({...e,type:'video',rootId:e.id,custom:true,dom:true,text:false,mv:false,animated:true,base:{}}))]);},
    pick(x,y){assertActive();if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return null;return compositor.pick(x,y)||source.pick(x,y);},
    getYouTubeLayers(){assertActive();return compositor.getYouTubeLayers(lastPlayback);},
    getStats(){return {disposed,contextLost:lost,timeSeconds:lastTime,animatedObjects:disposed?0:source.objectCount,media:disposed?[]:compositor.getMedia()};},
    dispose(){if(disposed)return;disposed=true;sourceCanvas.removeEventListener('webglcontextlost',contextLost);sourceCanvas.removeEventListener('webglcontextrestored',contextRestored);compositor.dispose();source.dispose();canvas.width=canvas.height=1;}
  };
}
