export function pointerFromUV(uv:{u:number;v:number}):{x:number;y:number};
export function seededUnit(seed:number,salt?:number):number;
export function mediaTarget(positionSeconds:number,layer:import('./types').VideoLayer,duration:number):number;
export function clockTime(time:number,settings:import('./types').ElementTransform):number;
export function motionPose(type:string,time:number,phase?:number,amount?:number,pointer?:{x:number;y:number}):Record<string,number>;
