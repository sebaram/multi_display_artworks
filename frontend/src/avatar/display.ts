import { createAvatarDetailState } from './detail-policy';
import { createViewVisibility } from '../scene/render-policy';
import type { AvatarPoseBuffer } from './pose';

/** Visibility is the gallery's world/XR-eye policy. Bounds conservatively enclose
 * the common rig and reachable hands at all supported uniform body scales. */
export function createRemoteAvatarDisplay({scene,buffer,targets,THREE,visibility=createViewVisibility(THREE,scene)}: {
  scene:any; buffer:AvatarPoseBuffer; targets:()=>Map<string,any>; THREE:any; visibility?:any;
}) {
  const entries=new Map<string,{target:any; state:ReturnType<typeof createAvatarDetailState>}>();
  const box=new THREE.Box3();
  const stats={remoteMs:0,poseMs:0,ownerMs:0,applied:0,full:0,low:0,hidden:0};
  const mobile=typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth<1100;
  return { stats, frame(time:number) {
    const start=performance.now(), active=targets();
    stats.poseMs=stats.applied=stats.full=stats.low=stats.hidden=0;
    visibility.update();
    for(const id of entries.keys()) if(!active.has(id)) entries.delete(id);
    for(const [id,target] of active) {
      const rootPose=buffer.poseAt(id,time,false);
      if(!rootPose || !target?.applyAvatarRoot) continue;
      let entry=entries.get(id);
      if(!entry || entry.target!==target) { entry={target,state:createAvatarDetailState()};entries.set(id,entry); }
      target.applyAvatarRoot(rootPose);
      const [x,y,z]=rootPose.root.position, scale=rootPose.bodyScale??1;
      box.min.set(x-1.2*scale,y-.3*scale,z-1.2*scale);
      box.max.set(x+1.2*scale,y+2.2*scale,z+1.2*scale);
      const measurement=visibility.measure(box);
      const step=entry.state.update({...measurement,visible:measurement.visible && (typeof document==='undefined'||document.visibilityState!=='hidden'),device:{mobile,xr:!!scene.renderer?.xr?.isPresenting},quality:scene.galleryPerformance?.level??0},time);
      target.setAvatarDetail(step.detail.meshLevel);
      stats[step.detail.meshLevel]++;
      if(step.applyPose) { const started=performance.now();target.applyAvatarPose(buffer.poseAt(id,time));stats.poseMs+=performance.now()-started;stats.applied++; }
      if(step.expression) target.updateAvatarExpression(performance.now());
    }
    stats.remoteMs=performance.now()-start;
  }, dispose() {entries.clear();Object.assign(stats,{remoteMs:0,poseMs:0,ownerMs:0,applied:0,full:0,low:0,hidden:0});} };
}
