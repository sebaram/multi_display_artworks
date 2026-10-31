import * as T from './vendor/three.module.js';
import {facets,cycle,facetPose,morphSurface,logoTime,logoShape} from './logo-morph.js';

function facetGeometry(facet){
 const corners=facet.points.map(([x,y])=>new T.Vector2((x-70.865)/70.87,(35.435-y)/70.87));
 const center=corners.reduce((sum,p)=>sum.add(p),new T.Vector2()).multiplyScalar(1/3);
 const points=corners.map(p=>p.clone().sub(center));
 const radius=Math.max(...points.map(p=>p.length()))*.73;
 const records=[],indices=[],n=24;
 for(const side of [1,-1]){
  const rows=[];
  for(let i=0;i<=n;i++){const row=[];for(let j=0;j<=n-i;j++){
   const a=i/n,b=j/n,c=1-a-b,x=points[0].x*a+points[1].x*b+points[2].x*c,y=points[0].y*a+points[1].y*b+points[2].y*c;
   row.push(records.length);records.push({x,y,radial:1-3*Math.min(a,b,c),side});
  }rows.push(row);}
  for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
   const a=rows[i][j],b=rows[i+1][j],c=rows[i][j+1];indices.push(...(side===1?[a,b,c]:[a,c,b]));
   if(j<n-i-1){const d=rows[i+1][j+1];indices.push(...(side===1?[b,d,c]:[b,c,d]));}
  }
 }
 for(let edge=0;edge<3;edge++)for(let i=0;i<n;i++){
  const start=records.length;
  for(const [u,side] of [[i/n,1],[(i+1)/n,1],[i/n,-1],[(i+1)/n,-1]]){
   const a=points[edge],b=points[(edge+1)%3];records.push({x:T.MathUtils.lerp(a.x,b.x,u),y:T.MathUtils.lerp(a.y,b.y,u),radial:1,side});
  }indices.push(start,start+2,start+1,start+1,start+2,start+3);
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(records.length*3),3));geometry.setIndex(indices);
 return {geometry,records,center,radius};
}
export function createLogoSculpture(materialFactory){
 const root=new T.Group(),parts=[];
 for(const facet of facets){const data=facetGeometry(facet),object=new T.Mesh(data.geometry,materialFactory(facet.color));root.add(object);parts.push({...data,object});}
 const bridges=[];
 for(let i=0;i<3;i++){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(45*3),3));const line=new T.Line(geometry,new T.LineBasicMaterial({color:i===1?'#ed1c24':'#0066b3',transparent:true,opacity:.25}));root.add(line);bridges.push(line);}
 function update(time,amount=1,variation={}){
  const t=variation.held?15:logoTime(time,amount,variation),{morph}=cycle(t);
  for(let i=0;i<parts.length;i++){
   const p=parts[i],pose=facetPose(t,i,variation),positions=p.geometry.attributes.position,surface={shape:logoShape(variation,i)};
   p.object.position.set(p.center.x+pose.x,p.center.y+pose.y,pose.z);p.object.rotation.set(pose.rotationX,pose.rotationY,pose.rotationZ);
   for(let k=0;k<p.records.length;k++){const v=p.records[k],next=morphSurface(v.x,v.y,v.radial,.045,pose.morph,t,p.radius,v.side,surface);positions.setXYZ(k,...next);}
   positions.needsUpdate=true;p.geometry.computeVertexNormals();p.geometry.computeBoundingSphere();
  }
  for(let i=0;i<bridges.length;i++){
   const a=parts[i].object.position,b=parts[i+3].object.position,positions=bridges[i].geometry.attributes.position;
   for(let j=0;j<45;j++){const u=j/44,wave=Math.sin(u*Math.PI)*morph;positions.setXYZ(j,T.MathUtils.lerp(a.x,b.x,u),T.MathUtils.lerp(a.y,b.y,u)+wave*.16*Math.sin(t*.3+i),T.MathUtils.lerp(a.z,b.z,u)-wave*.25);}
   positions.needsUpdate=true;bridges[i].geometry.computeBoundingSphere();bridges[i].material.opacity=morph*.28;
  }
 }
 update(0);return {root,update};
}
