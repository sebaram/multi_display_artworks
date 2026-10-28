// Absolute-time transforms keep the same motion on browsers with different FPS.
export function clockTime(time,settings={}){return (time-(settings.motionAnchor||0))*(settings.motionSpeed??1)+(settings.motionOffset||0);}
export function retimeMotion(settings,speed,parentTime){return {motionSpeed:speed,motionAnchor:parentTime,motionOffset:clockTime(parentTime,settings)};}
export function motionPose(type,time,phase=0,amount=1){
 const t=time*amount,s=t*.24;
 if(type==='ribbon')return {x:Math.sin(s*.55+phase)*.18,y:s*.74+phase*.15,z:Math.sin(s*.7+phase)*.3+(phase===2?.8:-.2),lift:Math.sin(t*.55+phase)*.12};
 if(type==='network')return {x:Math.sin(s*.6)*.12,y:s*.95,z:Math.sin(s)*.13,lift:Math.sin(t*.5+phase)*.1};
 if(type==='gallery')return {x:Math.sin(t*.32+phase)*.035,y:Math.sin(t*.29+phase)*.09,z:Math.sin(t*.26+phase)*.025,lift:Math.sin(t*.5+phase)*.18};
 if(type==='float')return {x:0,y:0,z:0,lift:Math.sin(t*.65+phase)*.28};
 return {x:Math.sin(s+phase)*.23,y:s*.7,z:Math.cos(s+phase)*.17,lift:0};
}
