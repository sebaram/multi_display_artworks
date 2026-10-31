// Coordinates copied from the six colored polylines in assets/identity.svg.
export const facets=[
 {color:'#0066b3',points:[[0,63.33],[0,0],[45.45,0]]},
 {color:'#0066b3',points:[[85.89,0],[59.13,37.32],[59.13,0]]},
 {color:'#0066b3',points:[[126.33,0],[99.54,37.32],[99.54,0]]},
 {color:'#ed1c24',points:[[42.21,70.87],[42.21,33.55],[15.42,70.87]]},
 {color:'#ed1c24',points:[[82.63,70.87],[82.63,33.55],[55.86,70.87]]},
 {color:'#ed1c24',points:[[141.73,7.52],[141.73,70.87],[96.28,70.87]]}
];
const smooth=x=>{const n=Math.max(0,Math.min(1,x));return n*n*(3-2*n);};
export function cycle(time){
 const phase=((time%36)+36)%36/36;
 const assembly=smooth((phase-.17)/.18)*(1-smooth((phase-.59)/.21));
 return {phase,assembly,morph:1-assembly};
}
export function seededUnit(seed,salt=0){let n=(Math.trunc(seed||0)^Math.imul(salt+1,0x9e3779b9))>>>0;n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);return ((n^(n>>>15))>>>0)/4294967296;}
export function logoTime(time,amount=1,variation={}){const r=variation.randomness||0;return (time*(1+(seededUnit(variation.seed,0)*2-1)*.25*r)+seededUnit(variation.seed,1)*36*Math.min(1,r))*amount;}
export function logoShape(variation={},index=0){const r=variation.randomness||0,seed=variation.seed||0;return {r,phase:seededUnit(seed,index+10)*Math.PI*2,x:1+(seededUnit(seed,index+20)*2-1)*.23*r,y:1+(seededUnit(seed,index+30)*2-1)*.23*r,depth:1+(seededUnit(seed,index+40)*2-1)*.3*r};}
export function facetPose(time,index,variation={}){
 const {phase,assembly,morph}=cycle(time);
 if(assembly===1)return {x:0,y:0,z:0,rotationX:0,rotationY:0,rotationZ:0,morph:0};
 const pair=index%3,blue=index<3,a=phase*Math.PI*2+pair*Math.PI*2/3+(blue?0:Math.PI);
 const r=variation.randomness||0;if(!r)return {x:morph*(Math.cos(a)*.36+(blue?-.12:.12)),y:morph*Math.sin(a)*.3,z:morph*Math.sin(a+.7)*.28,rotationX:morph*Math.sin(phase*Math.PI*2)*.22,rotationY:morph*Math.sin(a)*.85,rotationZ:morph*Math.cos(a+.3)*.32,morph};
 const seed=variation.seed||0,offset=seededUnit(seed,index+50)*Math.PI*2*r,b=a+offset,spread=1+seededUnit(seed,index+60)*.9*r;
 return {x:morph*(Math.cos(b)*.36*spread+(blue?-.12:.12)+Math.sin(b*2)*.16*r),y:morph*(Math.sin(b)*.3*spread+Math.cos(b*2+offset)*.1*r),z:morph*Math.sin(b+.7)*(.28+.2*r),rotationX:morph*Math.sin(b+offset)*(.22+.3*r),rotationY:morph*Math.sin(b)*(.85+.45*r),rotationZ:morph*Math.cos(b+.3)*(.32+.4*r),morph};
}
export function morphSurface(x,y,radial,depth,morph,time,radius=.55,side=1,variation={}){
 if(morph===0)return [x,y,side*depth/2];
 const shape=variation.shape||logoShape(variation,variation.index||0);
 const len=Math.hypot(x,y),angle=len>1e-8?Math.atan2(y,x):0;
 const r=radial*radius*(1+(.055+.035*shape.r)*Math.sin(angle*3+time*.45+shape.phase*shape.r));
 const tx=len>1e-8?Math.cos(angle)*r*shape.x:0,ty=len>1e-8?Math.sin(angle)*r*shape.y:0;
 const z=side*Math.sqrt(Math.max(0,1-radial*radial))*radius*.62*shape.depth+Math.sin(angle*2+time*.5+shape.phase*shape.r)*radial*.025;
 return [x+(tx-x)*morph,y+(ty-y)*morph,side*depth/2+(z-side*depth/2)*morph];
}
