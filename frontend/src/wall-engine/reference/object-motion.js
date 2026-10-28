import * as T from './vendor/three.module.js';
import {clockTime,motionPose} from './motion.js';

export function motionContext(object,time,amount=1){
 const chain=[];for(let node=object;node;node=node.parent)if(node.userData.authorMotion)chain.unshift(node.userData.authorMotion);
 let parentTime=time,speed=1;for(const settings of chain){parentTime=time;time=clockTime(time,settings);speed*=settings.motionSpeed??1;amount*=settings.motionAmount??1;}
 return {time,parentTime,amount,speed};
}
export function recordMotion(object,spec){object.userData.motionSpec={...spec,position:object.position.toArray(),rotation:[object.rotation.x,object.rotation.y,object.rotation.z],scale:object.scale.toArray()};}
const clamp01=x=>Math.max(0,Math.min(1,x));
const ease=x=>{x=clamp01(x);return x*x*x*(x*(x*6-15)+10);};
const loop=(time,duration=28)=>(time%duration+duration)%duration;
const blend=(time,start,end)=>ease((time-start)/(end-start));
function assembly(time,delay=0){const t=loop(time-delay);return blend(t,3,10)*(1-blend(t,17,24));}
function wave(time,start,duration){const p=(time-start)/duration;return p>0&&p<1?Math.sin(Math.PI*p)**2:0;}
// Absolute-time stories make the relation legible: approach/hold/depart,
// registration/passage, an outgoing response followed by a returning response,
// and complementary pieces building one shared pavilion.
export function relationPose(spec,time,amount=1){
 const position=[0,0,0],rotation=[0,0,0],scale=[1,1,1],t=loop(time),side=spec.side||1;
 const phase=t*Math.PI/14,index=spec.index||0;
 // Continuous secondary motion keeps the story alive while its main forms meet.
 // Integer harmonics close exactly at 28 s; multiplying amplitudes (not time)
 // preserves a genuinely still, authorable shape when movement amount is zero.
 if(spec.part==='turntable'){
  rotation[1]=Math.sin(phase)*.38*amount;
 }
 if(spec.part==='ribbon'){
  rotation[0]=Math.sin(phase*2+side)*.55*amount;
  rotation[1]=side*Math.sin(phase)*1.25*amount;
  rotation[2]=Math.sin(phase+side)*.24*amount;
 }
 if(spec.part==='satellite'){
  const a=phase*side*2+index*Math.PI/3,r=spec.radius||1.55;
  position[0]=Math.cos(a)*r*amount;
  position[1]=Math.sin(a)*r*.72*amount;
  position[2]=Math.sin(a*2+index)*.58*amount;
  rotation[0]=Math.sin(a)*.8*amount;rotation[1]=Math.cos(a)*.65*amount;
 }
 if(spec.part==='guide'){
  rotation[2]=side*(Math.sin(phase)*1.7+Math.sin(phase*2)*.45)*amount;
  rotation[1]=Math.sin(phase*2+index)*.33*amount;
 }
 if(spec.part==='flow'){
  const a=phase*2+index*Math.PI/3;
  position[0]=Math.cos(a)*1.38*amount;
  position[1]=Math.sin(a)*.65*amount;
  position[2]=Math.sin(a)*.65*amount;
  rotation[2]=Math.sin(a)*1.4*amount;
 }
 if(spec.part==='petal'){
  const a=phase+index*Math.PI/3;
  position[0]=Math.cos(a)*1.8*amount;
  position[1]=Math.sin(a)*.35*amount;
  position[2]=Math.sin(a)*1.2*amount;
  rotation[0]=Math.sin(a*2)*.5*amount;
  rotation[1]=-Math.sin(a)*1.2*amount;
  rotation[2]=Math.cos(a)*.22*amount;
 }
 if(spec.story==='presence'){
  const joined=assembly(time),apart=(1-joined)*amount;
  if(spec.part==='participant'){position[0]=side*.62*apart;rotation[1]=-side*(.15+.55*(1-apart));rotation[0]=wave(t,11,5)*.055*amount;}
  if(spec.part==='contribution'){position[0]=side*.13*apart;position[1]=wave(t,11,5)*.055*amount;rotation[1]=side*.3*apart;}
 }
 if(spec.story==='registration'){
  const apart=(1-assembly(time))*amount;
  if(spec.part==='frame'){position[0]=side*.56*apart;position[2]=side*.56*apart;rotation[1]=side*.65*apart;rotation[0]=Math.sin(phase*2)*.13*amount;}
  if(spec.part==='passage'){const visible=blend(t,10.5,11.5)*(1-blend(t,16,17))*amount;scale.fill(Math.max(.001,visible));position[2]=amount?1.15-2.3*blend(t,11,16):0;}
 }
 if(spec.story==='feedback'){
  if(spec.part==='fold'){
   const delay=(spec.index||0)*.10,centers=side<0?[1.6,20]:[9,13];
   const response=centers.reduce((sum,start)=>sum+wave(t,start+delay,3.4),0)*amount;
   position[2]=response*.34;scale[0]=1+response*.13;rotation[1]=side*response*.09;
   rotation[0]=Math.sin(phase*2-index*.42+side)*.32*amount;
   rotation[2]=Math.cos(phase*2-index*.42+side)*.10*amount;
  }
  if(spec.part==='pulse'){
   const p=clamp01((t-(side<0?4.5:15.5))/5),visible=blend(p,0,.16)*(1-blend(p,.84,1))*amount;
   position[0]=amount?-side*(-1.28+2.56*p):0;position[1]=Math.sin(p*Math.PI)*.65*side*amount;position[2]=Math.sin(p*Math.PI)*.7*amount;scale.fill(Math.max(.001,visible));
  }
 }
 if(spec.story==='cocreation'){
  if(spec.part==='half'){const apart=(1-assembly(time,(spec.index||0)*.45))*amount;position[0]=side*.78*apart;position[2]=side*.38*apart;rotation[1]=side*.66*apart;rotation[2]=side*.22*apart;}
  if(spec.part==='shared')scale[1]=Math.max(.04,1-(1-assembly(time,1))*.96*amount);
 }
 return {position,rotation,scale};
}
export function sampledTransform(object,time,amount=1,pointer=null){
 const spec=object.userData.motionSpec;if(!spec)return {position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()};
 const position=new T.Vector3(...spec.position),rotation=new T.Euler(...spec.rotation),scale=new T.Vector3(...spec.scale),pose=motionPose(spec.type,time,spec.phase||0,amount),slow=time*.24;
 if(spec.type==='orbit')rotation.set(spec.base[0]+pose.x,spec.base[1]+pose.y,spec.base[2]+pose.z);
 if(spec.type==='knot')rotation.set(.2+Math.sin(slow*amount)*.2,.5+slow*.65*amount,-.35+Math.sin(slow*.7*amount)*.16);
 if(spec.type==='ribbon'||spec.type==='network')rotation.set(pose.x,pose.y,pose.z);
 if(spec.type==='float')position.y=spec.y+pose.lift;
 if(spec.type==='gallery'){rotation.set(pose.x,pose.y,pose.z);position.y=spec.y+pose.lift;}
 if(spec.type==='hero'){position.y=Math.sin(time*.5*amount)*.24+spec.baseY;rotation.x=pointer?-pointer.y*.1:0;rotation.y=pointer?pointer.x*.12:0;}
 if(spec.type==='secondary')rotation.y=Math.sin(slow*.6*amount)*.13;
 if(spec.type==='sway')rotation.y+=Math.sin(time*spec.rate*amount+(spec.phase||0))*spec.angle*amount;
 if(spec.type==='relation'){const p=relationPose(spec,time,amount);position.add(new T.Vector3(...p.position));rotation.x+=p.rotation[0];rotation.y+=p.rotation[1];rotation.z+=p.rotation[2];scale.multiply(new T.Vector3(...p.scale));}
 return {position,quaternion:new T.Quaternion().setFromEuler(rotation),scale};
}
export function applySample(object,time,amount,pointer=null){const sample=sampledTransform(object,time,amount,pointer);object.position.copy(sample.position);object.quaternion.copy(sample.quaternion);object.scale.copy(sample.scale);}
export function sampledWorld(object,time,amount,wrappers,copyRoots=new Map()){
 const chain=[];let matrix=new T.Matrix4();for(let node=object;node&&node.parent;node=node.parent){if(wrappers.has(node))continue;if(copyRoots.has(node)){matrix=sampledWorld(copyRoots.get(node),time,amount,wrappers,copyRoots);break;}chain.unshift(node);}
 for(const node of chain){const p=sampledTransform(node,time,amount);matrix.multiply(new T.Matrix4().compose(p.position,p.quaternion,p.scale));}return matrix;
}
