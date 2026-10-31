import * as T from './vendor/three.module.js';

// Ten scene units fill the 2.5 m wall height. These are authored stage views,
// not a tracked-camera calibration. The middle stays clear for seated/standing.
const floorY=-4.85;
const vertex='varying vec3 vWorld;varying vec2 vUv;void main(){vUv=uv;vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}';
function material(color,roughness=.7,metalness=0){return new T.MeshPhysicalMaterial({color,roughness,metalness,clearcoat:metalness>.4?.3:0,envMapIntensity:.7});}
function add(parent,name,geometry,mat,x=0,y=0,z=0){const o=new T.Mesh(geometry,mat);o.name=name;o.position.set(x,y,z);parent.add(o);return o;}
function box(parent,name,w,h,d,mat,x,y,z){return add(parent,name,new T.BoxGeometry(w,h,d),mat,x,y,z);}
function room(group,layout,warm){
 const base=new T.Color(warm?'#b4a28a':'#102031').convertLinearToSRGB(),glow=new T.Color(warm?'#e9d7b4':'#29465f').convertLinearToSRGB();
 const spaces=screenSpaces(layout),starts=Array(8).fill(0),widths=Array(8).fill(1);spaces.forEach((s,i)=>{starts[i]=s.start;widths[i]=s.width;});
 const backdrop=new T.ShaderMaterial({uniforms:{uTime:{value:0},uMode:{value:0},uBase:{value:base},uGlowColor:{value:glow},uGlow:{value:1},uWarm:{value:warm?1:0},uStarts:{value:starts},uWidths:{value:widths},uCount:{value:spaces.length}},vertexShader:vertex,fragmentShader:`
 varying vec3 vWorld;varying vec2 vUv;uniform float uMode,uGlow,uWarm;uniform vec3 uBase,uGlowColor;uniform float uStarts[8],uWidths[8];uniform int uCount;
 void main(){
  float x=.5;for(int i=0;i<8;i++){if(i<uCount&&vWorld.x>=uStarts[i]&&vWorld.x<=uStarts[i]+uWidths[i])x=(vWorld.x-uStarts[i])/uWidths[i];}
  float light=exp(-pow((vWorld.y-3.)*.13,2.));
  float daylight=exp(-pow((x-.18+(vWorld.y-2.)*.045)*2.1,2.))*smoothstep(-5.,5.,vWorld.y);
  float plaster=sin(vWorld.x*137.+sin(vWorld.y*151.))*sin(vWorld.y*127.)*.0015;
  vec3 base=mix(vec3(.025,.043,.067),vec3(.52,.505,.47),uWarm);
  vec3 color=base+mix(vec3(.018,.028,.04)*light,vec3(.18,.17,.145)*daylight+vec3(.035)*light,uWarm)*uGlow+plaster;
  if(uMode>.5)color=uBase;if(uMode>1.5)color=mix(uBase,uGlowColor,light*.38*uGlow);
  gl_FragColor=vec4(color,1.);
 }`});
 const background=add(group,'Gallery atmosphere',new T.PlaneGeometry(Math.max(170,layout.width+100),70),backdrop,0,0,-12.5);
 const floorMaterial=new T.ShaderMaterial({transparent:true,uniforms:{uOpacity:{value:1},uWarm:{value:warm?1:0}},vertexShader:vertex,fragmentShader:`
 varying vec3 vWorld;uniform float uOpacity,uWarm;
 void main(){float depth=smoothstep(-16.,8.,vWorld.z);vec3 color=mix(vec3(.037,.052,.069),vec3(.50,.475,.43),uWarm);color*=.85+depth*.15;gl_FragColor=vec4(color,uOpacity);}`});
 const floor=add(group,'Continuous gallery floor',new T.PlaneGeometry(Math.max(180,layout.width+100),100),floorMaterial,0,floorY,-5);floor.rotation.x=-Math.PI/2;
 return {background,floorMaterial};
}
function contact(parent,x,z,w,d,warm){
 // Soft analytic contact, without image assets or a costly shadow-map pass.
 const mat=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uOpacity:{value:warm?.30:.48}},vertexShader:vertex,fragmentShader:'varying vec2 vUv;uniform float uOpacity;void main(){float r=length((vUv-.5)*2.);gl_FragColor=vec4(0.,0.,0.,exp(-r*r*5.)*(1.-smoothstep(.6,1.,r))*uOpacity);}'});
 const o=add(parent,'Sculpture contact shadow',new T.PlaneGeometry(w,d),mat,x,floorY+.018,z);o.rotation.x=-Math.PI/2;
}
function archShape(width,height){const s=new T.Shape(),r=width/2;s.moveTo(-r,0);s.lineTo(-r,height-r);s.absarc(0,height-r,r,Math.PI,0,true);s.lineTo(r,0);s.closePath();return s;}
function portal(parent,x,z,width,height,warm){
 const root=new T.Group();root.name=warm?'Limestone light alcove':'Blue light portal';root.position.set(x,floorY,z);parent.add(root);
 const stone=material(warm?'#afa08a':'#142638',.87),inner=material(warm?'#796a55':'#07131f',.96);
 add(root,'Recessed alcove',new T.ShapeGeometry(archShape(width,height),64),inner,0,0,-.8);
 const shape=archShape(width+1.1,height+.55),hole=new T.Path(),r=width/2;hole.moveTo(-r,0);hole.lineTo(r,0);hole.lineTo(r,height-r);hole.absarc(0,height-r,r,0,Math.PI,false);hole.lineTo(-r,0);shape.holes.push(hole);
 add(root,'Rounded stone surround',new T.ExtrudeGeometry(shape,{depth:.75,bevelEnabled:true,bevelSize:.07,bevelThickness:.06,bevelSegments:3,curveSegments:64}),stone);
 // A broad satin inset makes the recess read as depth, never as a neon outline.
 const inset=add(root,'Alcove illuminated inset',new T.ShapeGeometry(archShape(width-.22,height-.12),64),material(warm?'#c5b28e':'#1f405a',.76),0,.025,-.73);inset.scale.x=.97;
 return root;
}
function leafGeometry(width,height,depth){
 const s=new T.Shape();s.moveTo(-width*.38,0);s.bezierCurveTo(-width*.62,height*.25,-width*.55,height*.8,0,height);s.bezierCurveTo(width*.58,height*.86,width*.6,height*.2,width*.27,0);s.closePath();
 const g=new T.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSize:.12,bevelThickness:.1,bevelSegments:5,curveSegments:36});g.translate(0,0,-depth/2);return g;
}
function screenSpaces(layout){return layout.screens.map(sc=>({id:sc.id,width:sc.width/1080*10,start:-layout.width/2+sc.x/1080*10}));}

export function sereinAtelier({group,layout,addMotion}){
 const result=room(group,layout,true);
 for(const sc of screenSpaces(layout)){
  const x=sc.start+sc.width*.84,s=Math.min(1,sc.width/16);
  const alcove=portal(group,x,-8,4.5*s,8.6,true);alcove.userData.authorId='atelier-alcove-'+sc.id;
  // The uninterrupted wall occupies the interview area; depth lives at the edges.
  const reveal=box(group,'Left limestone reveal',.65,14,1.15,material('#b6a58a',.9),sc.start+sc.width*.035,1,-11);reveal.rotation.y=.17;
  box(group,'Warm recessed reveal',.055,13,.04,new T.MeshBasicMaterial({color:'#d8bc86'}),sc.start+sc.width*.06,1,-10.35);
  const sculpture=new T.Group();sculpture.name='Bronze leaves';sculpture.userData.authorId='atelier-leaves-'+sc.id;sculpture.position.set(x,floorY+.24,-3);sculpture.scale.setScalar(s);group.add(sculpture);
  add(group,'Low limestone plinth',new T.CylinderGeometry(1.5*s,1.55*s,.24,80),material('#b1a087',.9),x,floorY+.12,-3);
  for(const [i,color] of ['#947047','#b2a087'].entries()){
   const leaf=add(sculpture,i?'Satin silver leaf':'Brushed bronze leaf',leafGeometry(i?1.15:1.6,i?4.5:5.6,.18),material(color,.32,.78),i?.7:-.42,0,i?.25:0);
   leaf.rotation.y=i?-.48:.3;addMotion({o:leaf,type:'sway',rate:.12,angle:i?.22:.3,phase:i*1.6});
  }
  contact(group,x,-3,5*s,4*s,true);
  // Low, broad bench: a plausible 0.35 m object, below either subject's face.
  const benchX=sc.start+sc.width*.16,benchW=Math.min(4,sc.width*.22);
  box(group,'Limestone bench seat',benchW,.32,1.5,material('#b8aa93',.8),benchX,floorY+1.35,-7);
  for(const dx of [-benchW*.34,benchW*.34])box(group,'Bench support',.3,1.2,1.25,material('#9e8d72',.85),benchX+dx,floorY+.6,-7);
  contact(group,benchX,-7,benchW+1,3,true);
 }
 return result;
}

export function mvLightCourt({group,layout,addMotion}){
 const result=room(group,layout,false);
 for(const sc of screenSpaces(layout)){
  const x=sc.start+sc.width*.84,s=Math.min(1,sc.width/16);
  const portalRoot=portal(group,x,-9,4.7*s,9.2,false);portalRoot.userData.authorId='court-portal-'+sc.id;
  const blue=new T.Group();blue.name='Virtual blue glass';blue.userData.authorId='court-glass-'+sc.id;blue.position.set(x,floorY+.18,-3.5);blue.scale.setScalar(s);group.add(blue);
  // Solid optical slabs keep the effect stable on LED and without a second render pass.
  for(let i=0;i<3;i++){
   const height=5.8-i*.58,slab=add(blue,'Blue optical blade '+(i+1),leafGeometry(1.1,height,.24),new T.MeshPhysicalMaterial({color:i===1?'#0066b3':'#235a83',metalness:.55,roughness:.2,clearcoat:1,clearcoatRoughness:.13,transparent:true,opacity:.87,side:T.DoubleSide,envMapIntensity:1.15}),-.85+i*.85,0,i*.42);
   slab.rotation.y=-.32+i*.26;addMotion({o:slab,type:'sway',rate:.1,angle:.21,phase:i*.9});
  }
  add(group,'Graphite sculpture plinth',new T.CylinderGeometry(1.9*s,1.96*s,.18,80),material('#142230',.45,.4),x,floorY+.09,-3.5);
  contact(group,x,-3.5,6*s,4*s,false);
  const redX=sc.start+sc.width*.14;
  const real=new T.Group();real.name='Real red monolith';real.userData.authorId='court-red-'+sc.id;real.position.set(redX,floorY+.12,-5);group.add(real);
  const shape=new T.Shape();shape.moveTo(-1.6,0);shape.lineTo(1.45,0);shape.lineTo(1.05,2.25);shape.quadraticCurveTo(.9,2.55,.65,2.5);shape.lineTo(-1.6,.72);shape.closePath();
  const solid=add(real,'Red lacquer form',new T.ExtrudeGeometry(shape,{depth:.85,bevelEnabled:true,bevelSize:.09,bevelThickness:.09,bevelSegments:4}),material('#a5212b',.3,.35));solid.rotation.y=-.23;addMotion({o:real,type:'sway',rate:.075,angle:.13,phase:.4});
  contact(group,redX,-5,5,3.5,false);
  // A quiet horizontal bronze reveal establishes the room's scale near the floor.
  box(group,'Low wall reveal',sc.width,.035,.035,material('#485968',.52,.65),sc.start+sc.width/2,floorY+.25,-10);
 }
 return result;
}
