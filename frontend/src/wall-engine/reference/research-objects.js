import * as T from './vendor/three.module.js';

// Editorial sculptures inspired by co-presence, spatial registration, reciprocal
// interaction and co-creation. These are not visualizations of research data.
export const researchObjectTypes=[['presence','Co-presence · interwoven ribbons'],['registration','Shared coordinates · kinetic portals'],['feedback','Mutual response · wave exchange'],['cocreation','Co-creation · unfolding pavilion']];
const red='#ed1c24',blue='#0066b3';
function finish(color,metalness=.48,roughness=.27){return new T.MeshPhysicalMaterial({color,metalness,roughness,clearcoat:.65,clearcoatRoughness:.18,envMapIntensity:.95});}
function mesh(parent,name,geometry,material,x=0,y=0,z=0){const o=new T.Mesh(geometry,material);o.name=name;o.position.set(x,y,z);parent.add(o);return o;}
function group(parent,name,x=0,y=0,z=0){const o=new T.Group();o.name=name;o.position.set(x,y,z);parent.add(o);return o;}
function roundedShape(w,h,r){const s=new T.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function slab(w,h,d,r=.12){const g=new T.ExtrudeGeometry(roundedShape(w,h,r),{depth:d,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:3,curveSegments:16});g.translate(0,0,-d/2);return g;}
function beam(parent,name,a,b,width,depth,material){const start=new T.Vector3(...a),end=new T.Vector3(...b),o=mesh(parent,name,new T.BoxGeometry(width,start.distanceTo(end),depth),material);o.position.copy(start.add(end).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...b).sub(new T.Vector3(...a)).normalize());return o;}
function plinth(root,w=4.7,d=2.5){const o=mesh(root,'Shared ground',new T.CylinderGeometry(1,1,.14,80),finish('#8796a4',.55,.4),0,-1.98,0);o.scale.set(w/2,1,d/2);return o;}
function animate(addMotion,o,story,part,extra={}){addMotion({o,type:'relation',story,part,...extra});return o;}
function kinetic(root,addMotion,story){const stage=group(root,'Kinetic assembly');animate(addMotion,stage,story,'turntable');return stage;}
// A solid, bevel-like ribbon with real thickness, so rotation reveals more
// than a flat silhouette. The twist gives the paired loops complementary faces.
function ribbonGeometry(radius,phase){
 const positions=[],indices=[],steps=128;
 for(let i=0;i<=steps;i++){
  const a=i/steps*Math.PI*2,radial=new T.Vector3(Math.cos(a),Math.sin(a),0),normal=new T.Vector3(0,0,1),twist=a*2+phase;
  const width=radial.clone().multiplyScalar(Math.cos(twist)).addScaledVector(normal,Math.sin(twist));
  const thick=radial.clone().multiplyScalar(-Math.sin(twist)).addScaledVector(normal,Math.cos(twist));
  const center=radial.multiplyScalar(radius);center.z=Math.sin(a*2+phase)*.32;
  for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]])positions.push(...center.clone().addScaledVector(width,u*.19).addScaledVector(thick,v*.045));
  if(i<steps)for(let j=0;j<4;j++){const k=i*4+j,n=i*4+(j+1)%4;indices.push(k,n,n+4,k,n+4,k+4);}
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
function satellites(parent,addMotion,story,count=6,radius=1.55,part='satellite'){
 const geometry=new T.OctahedronGeometry(.105,1),materials=[finish('#f5b2a8',.65,.18),finish('#80cbef',.65,.18)];
 for(let i=0;i<count;i++)animate(addMotion,mesh(parent,'Travelling contribution '+(i+1),geometry,materials[i%2]),story,part,{index:i,side:i%2?1:-1,radius});
}
function copresence(root,addMotion){
 plinth(root,4.8,2.6);const stage=kinetic(root,addMotion,'presence');
 const core=mesh(stage,'Shared activity',new T.TorusKnotGeometry(.37,.12,100,16,2,3),finish('#dce1de',.6,.19),0,-.12,0);
 animate(addMotion,core,'presence','ribbon',{side:1});
 for(const side of [-1,1]){
  const color=side<0?red:blue,person=group(stage,side<0?'Physical presence':'Remote presence',side*.62,-.12,side*.18);
  const band=mesh(person,'Interwoven presence ribbon',ribbonGeometry(1.16,side*.7),finish(color,.58,.23));band.rotation.set(side*.32,side*.42,side*.35);
  animate(addMotion,band,'presence','ribbon',{side});
  animate(addMotion,person,'presence','participant',{side});
  const contribution=mesh(stage,side<0?'Warm contribution':'Blue contribution',slab(.25,.12,.24,.04),finish(color),side*.24,-.55,.28);
  animate(addMotion,contribution,'presence','contribution',{side});
 }
 satellites(stage,addMotion,'presence',6,1.8);
}
function contour(parent,name,w,h,r,z,material,tube=.027){const points=roundedShape(w,h,r).getPoints(72).map(p=>new T.Vector3(p.x,p.y,z));return mesh(parent,name,new T.TubeGeometry(new T.CatmullRomCurve3(points,true,'centripetal'),220,tube,8,true),material);}
function coordinates(root,addMotion){
 root.rotation.y=-.18;
 plinth(root,4.7,2.9);const stage=kinetic(root,addMotion,'registration');
 const solid=group(stage,'Physical coordinate frame',0,0,.03),virtual=group(stage,'Virtual coordinate frame',0,0,.03),warm=finish(red,.35,.3),cool=finish(blue,.6,.21);
 const shape=roundedShape(2.65,3.65,.27),hole=roundedShape(2.29,3.29,.16);shape.holes.push(new T.Path(hole.getPoints(64).reverse()));
 mesh(solid,'Solid room opening',new T.ExtrudeGeometry(shape,{depth:.23,bevelEnabled:true,bevelThickness:.035,bevelSize:.03,bevelSegments:3,curveSegments:32}),warm,0,0,-.115);
 // The blue volume retains the exact aperture proportions, with offset depth.
 for(const z of [-.28,.28]){
  contour(virtual,'Registered outer contour',2.73,3.73,.28,z,cool,.035);
  contour(virtual,'Registered inner contour',2.23,3.23,.14,z,cool,.025);
 }
 for(const x of [-1.365,1.365])for(const y of [-1.52,1.52])beam(virtual,'Depth registration edge',[x,y,-.28],[x,y,.28],.035,.035,cool);
 animate(addMotion,solid,'registration','frame',{side:-1});animate(addMotion,virtual,'registration','frame',{side:1});
 const passage=mesh(stage,'Passage through shared space',new T.SphereGeometry(.21,32,20),finish('#d8edee',.4,.15),0,-.4,0);
 animate(addMotion,passage,'registration','passage');
 for(const side of [-1,1]){
  const guide=group(stage,'Rotating registration guide',0,0,side*.48);
  const arc=mesh(guide,'Portal scan arc',new T.TorusGeometry(1.03,.024,8,96,Math.PI*1.45),finish(side<0?'#ee9b91':'#7abfe4',.7,.2));arc.scale.y=1.3;
  mesh(guide,'Registration cursor',new T.OctahedronGeometry(.13,0),finish('#dae7eb',.7,.2),1.03,0,0);
  animate(addMotion,guide,'registration','guide',{side});
 }
 satellites(stage,addMotion,'registration',6,.92);
}
function response(root,addMotion){
 plinth(root,4.8,2.7);const stage=kinetic(root,addMotion,'feedback');
 const path=mesh(stage,'Reciprocal connection',new T.TorusGeometry(1.38,.022,8,128),finish('#a9bbc8',.7,.22),0,-.7,0);path.scale.y=.67;path.rotation.x=.78;
 for(const side of [-1,1]){
  const color=side<0?red:blue,body=group(stage,side<0?'Physical responsive surface':'Virtual responsive surface',side*1.28,-.2,0);
  body.rotation.y=-side*.23;
  mesh(body,'Surface pedestal',new T.CylinderGeometry(.36,.47,.60,48),finish('#84919c',.6,.35),0,-1.41,0);
  for(let i=0;i<9;i++){
   const p=(i-4)/4,width=.6+.68*Math.sqrt(Math.max(0,1-p*p));
   const rib=mesh(body,'Responsive fold '+(i+1),slab(width,.23,.22,.09),finish(color,.5,.24),0,p*1.08,.08+.12*(1-p*p));
   animate(addMotion,rib,'feedback','fold',{side,index:i});
  }
  const pulse=mesh(stage,side<0?'Outgoing response':'Returning response',new T.SphereGeometry(.19,24,16),new T.MeshPhysicalMaterial({color,emissive:color,emissiveIntensity:.35,metalness:.3,roughness:.2}),0,-.7,0);
  animate(addMotion,pulse,'feedback','pulse',{side});
 }
 const couriers=group(stage,'Continuous exchange couriers',0,-.7,0);satellites(couriers,addMotion,'feedback',6,1.38,'flow');
}
function cocreation(root,addMotion){
 root.rotation.y=.32;
 plinth(root,5,2.8);const stage=kinetic(root,addMotion,'cocreation');
 for(const side of [-1,1]){
  const half=group(stage,side<0?'Warm contribution to pavilion':'Blue contribution to pavilion'),mat=finish(side<0?red:blue,.45,.28);
  // Each half is incomplete alone. Their complementary roof edges meet exactly.
  for(let i=0;i<3;i++){
   const s=new T.Shape();s.moveTo(0,1.3);s.lineTo(side*1.3,.16);s.lineTo(side*1.3,-1.87);s.lineTo(side*1.08,-1.87);s.lineTo(side*1.08,.06);s.lineTo(0,1.03);s.closePath();
   const fold=mesh(half,'Folded pavilion bay '+(i+1),new T.ExtrudeGeometry(s,{depth:.44,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:3}),mat,0,0,-.93+i*.7);
   animate(addMotion,fold,'cocreation','half',{side,index:i});
  }
 }
 const ridge=mesh(stage,'Shared roof seam',slab(.13,.15,2.04,.04),finish('#dce7e8',.6,.2),0,1.19,-.01);
 animate(addMotion,ridge,'cocreation','shared');
 for(let i=0;i<6;i++){
  const panel=mesh(stage,'Orbiting contribution panel '+(i+1),slab(.35,.58,.09,.09),finish(i%2?blue:red,.6,.22),0,.32,0);
  animate(addMotion,panel,'cocreation','petal',{index:i});
 }
}
const builders={presence:copresence,registration:coordinates,feedback:response,cocreation};
export function createResearchObject(type,addMotion){
 const build=builders[type];if(!build)return null;
 const root=new T.Group();root.name=researchObjectTypes.find(t=>t[0]===type)[1];build(root,addMotion);return root;
}
