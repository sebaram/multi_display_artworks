"""Generate MetaMuseum's original CC0 humanoid. Python stdlib only; run from repo root."""
import base64
import json
import math
from pathlib import Path
import struct
import sys
import zlib
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from metamuseum.avatar_catalog import CORE_RIG, avatar_catalog

OUT = Path(__file__).resolve().parents[2] / 'frontend/public/avatars'
OUT.mkdir(parents=True, exist_ok=True)
doc = dict(asset=dict(version='2.0', generator='MetaMuseum original humanoid generator v1'), scene=0, scenes=[dict(nodes=[0])],
           nodes=[dict(name='Humanoid', children=[1, 23])], meshes=[], materials=[], buffers=[], bufferViews=[], accessors=[], skins=[], animations=[])
binary = bytearray()
def view(data, target=None):
    while len(binary) % 4: binary.append(0)
    result = len(doc['bufferViews'])
    entry = dict(buffer=0, byteOffset=len(binary), byteLength=len(data))
    if target: entry['target'] = target
    doc['bufferViews'].append(entry)
    binary.extend(data)
    return result
def accessor(data, width, kind='f', target=None, bounds=False):
    component = {'f': 5126, 'H': 5123}[kind]
    result = len(doc['accessors'])
    entry = dict(bufferView=view(struct.pack('<' + kind * len(data), *data), target), componentType=component, count=len(data)//width, type={1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4',16:'MAT4'}[width])
    if bounds:
        entry['min'] = [min(data[i::width]) for i in range(width)]
        entry['max'] = [max(data[i::width]) for i in range(width)]
    doc['accessors'].append(entry)
    return result
indices = {name: i for i, (name, _, _) in enumerate(CORE_RIG)}
global_pos = {}
for name, parent, offset in CORE_RIG:
    global_pos[name] = [offset[i] + (global_pos[parent][i] if parent else 0) for i in range(3)]
    children = [indices[n] + 1 for n, p, _ in CORE_RIG if p == name]
    doc['nodes'].append(dict(name=name, translation=offset, children=children))
# One connected skeleton, one skinned body, head-local original accessories.
doc['nodes'].append(dict(name='Body', mesh=0, skin=0))
doc['nodes'].append(dict(name='HeadAnchor', translation=[0, .08, 0], children=[25,26,27]))
doc['nodes'][indices['head']+1]['children'].append(24)
for name, mesh in [('HairShort',1), ('Cap',2), ('GlassesRound',3)]:
    doc['nodes'].append(dict(name=name, mesh=mesh))

# Single white embedded 1px map; palettes are instance uniforms, all source maps shared.
def chunk(kind, data): return struct.pack('>I',len(data)) + kind + data + struct.pack('>I',zlib.crc32(kind+data))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0)) + chunk(b'IDAT',zlib.compress(b'\0\xff\xff\xff\xff')) + chunk(b'IEND',b'')
# Data URI avoids browser ImageBitmap dependencies during offline loader tests.
doc['images'] = [dict(uri='data:image/png;base64,' + base64.b64encode(png).decode())]
doc['textures'] = [dict(source=0)]
for name in ['Body','Attachments']:
    doc['materials'].append(dict(name=name, pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0, roughnessFactor=.85)))

class Mesh:
    def __init__(self): self.p=[];self.uv=[];self.j=[];self.w=[];self.tri=[];self.regions={}
    def rings(self, center, rings, slot, bone, other=None, segments=10, region=None):
        """Tapered closed ring surface, smoothly weighted along the joint segment."""
        start=len(self.p)//3
        if region: self.regions[region] = dict(start=start, count=len(rings)*segments)
        for row,(dy,rx,rz) in enumerate(rings):
            blend=(row/(len(rings)-1)) if other is not None else 0
            for k in range(segments):
                a=2*math.pi*k/segments
                self.p.extend([center[0]+math.cos(a)*rx,center[1]+dy,center[2]+math.sin(a)*rz])
                self.uv.extend([(slot+.5)/5,.5]);self.j.extend([bone,other or bone,0,0]);self.w.extend([1-blend,blend,0,0])
        for row in range(len(rings)-1):
            for k in range(segments):
                a=start+row*segments+k;b=start+row*segments+(k+1)%segments;c=a+segments;d=b+segments
                self.tri.extend([a,c,b,b,c,d])
    def emit(self, name, material, skinned=False):
        attrs=dict(POSITION=accessor(self.p,3,target=34962,bounds=True),TEXCOORD_0=accessor(self.uv,2,target=34962))
        if skinned: attrs.update(JOINTS_0=accessor(self.j,4,'H',34962),WEIGHTS_0=accessor(self.w,4,target=34962))
        doc['meshes'].append(dict(name=name,extras=dict(regions=self.regions),primitives=[dict(attributes=attrs,indices=accessor(self.tri,1,'H',34963),material=material)]))
        return len(self.tri)//3
body=Mesh()
body.rings(global_pos['hips'],[(-.10,0,0),(-.07,.17,.10),(.08,.17,.11),(.25,.21,.11),(.44,.20,.10),(.52,.075,.065),(.56,.065,.06),(.57,0,0)],1,0,indices['upperChest'],region='torso')
body.rings(global_pos['neck'],[(-.03,0,0),(0,.065,.06),(.12,.065,.06),(.13,0,0)],0,indices['neck'],region='neck')
body.rings(global_pos['head'],[(-.03,0,0),(0,.11,.10),(.08,.145,.13),(.20,.13,.115),(.25,0,0)],0,indices['head'],segments=12)
for side in ['left','right']:
    upper=indices[side+'UpperArm']; lower=indices[side+'LowerArm'];hand=indices[side+'Hand']
    body.rings(global_pos[side+'UpperArm'],[(-.30,0,0),(-.28,.065,.065),(-.14,.075,.075),(.01,.085,.08),(.03,0,0)],1,lower,upper)
    body.rings(global_pos[side+'LowerArm'],[(-.26,0,0),(-.25,.045,.045),(-.12,.058,.055),(0,.065,.065),(.01,0,0)],0,hand,lower)
    body.rings(global_pos[side+'Hand'],[(-.11,0,0),(-.09,.045,.025),(0,.045,.03),(.01,0,0)],0,hand)
    thigh=indices[side+'UpperLeg'];shin=indices[side+'LowerLeg'];foot=indices[side+'Foot']
    body.rings(global_pos[side+'UpperLeg'],[(-.44,0,0),(-.42,.072,.075),(-.20,.085,.09),(.02,.085,.09),(.04,0,0)],2,shin,thigh)
    body.rings(global_pos[side+'LowerLeg'],[(-.41,0,0),(-.40,.055,.06),(-.20,.065,.07),(0,.072,.075),(.01,0,0)],2,foot,shin)
    center=global_pos[side+'Foot'].copy();center[2]-=.055
    body.rings(center,[(-.06,0,0),(-.05,.07,.13),(.02,.07,.13),(.04,0,0)],2,foot)
    eye=global_pos['head'].copy();eye[0]+=(-.05 if side=='left' else .05);eye[1]+=.11;eye[2]-=.12
    body.rings(eye,[(-.022,0,0),(-.017,.017,.012),(.017,.017,.012),(.022,0,0)],4,indices['head'],segments=8)
triangles=body.emit('Body',0,True)
hair=Mesh();hair.rings([0,0,0],[(.03,.148,.134),(.14,.14,.13),(.18,0,0)],3,0,segments=12);triangles+=hair.emit('HairShort',1)
cap=Mesh();cap.rings([0,0,0],[(.07,.154,.14),(.17,.145,.13),(.20,0,0)],1,0,segments=12);cap.rings([0,.065,-.08],[(0,0,0),(.005,.16,.16),(.02,.16,.16),(.025,0,0)],1,0,segments=12);triangles+=cap.emit('Cap',1)
glasses=Mesh()
for x in [-.05,.05]: glasses.rings([x,.035,-.136],[(-.025,0,0),(-.02,.035,.008),(.02,.035,.008),(.025,0,0)],4,0,segments=8)
triangles+=glasses.emit('GlassesRound',1)
inverses=[]
for name,_,_ in CORE_RIG:
    x,y,z=global_pos[name];inverses.extend([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1])
doc['skins']=[dict(name='HumanoidRig',joints=list(range(1,23)),skeleton=1,inverseBindMatrices=accessor(inverses,16))]
times=accessor([0,.5,1],1,bounds=True)
for clip,angle in [('idle',.015),('walk',.35)]:
    channels=[];samplers=[]
    for bone,phase in [('leftUpperLeg',1),('rightUpperLeg',-1),('leftUpperArm',-1),('rightUpperArm',1)]:
        quats=[]
        for value in [-angle*phase,angle*phase,-angle*phase]:quats.extend([math.sin(value/2),0,0,math.cos(value/2)])
        samplers.append(dict(input=times,output=accessor(quats,4),interpolation='LINEAR'))
        channels.append(dict(sampler=len(samplers)-1,target=dict(node=indices[bone]+1,path='rotation')))
    doc['animations'].append(dict(name=clip,samplers=samplers,channels=channels))
while len(binary)%4:binary.append(0)
doc['buffers']=[dict(byteLength=len(binary))]
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
glb=struct.pack('<III',0x46546C67,2,12+8+len(encoded)+8+len(binary))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+struct.pack('<II',len(binary),0x004E4942)+binary
(OUT/'common-humanoid.glb').write_bytes(glb)
(OUT/'catalog.fixture.json').write_text(json.dumps(avatar_catalog(),indent=2)+'\n',encoding='utf8')
(OUT/'asset-inspection.json').write_text(json.dumps(dict(triangles=triangles,bones=22,bodyMaterials=1,accessoryMaterials=1,textureSize=1,meters=True,up='+Y',forward='-Z',animations=['idle','walk'],generator='tools/avatars/generate_humanoid.py'),indent=2)+'\n',encoding='utf8')
print(f'Generated {len(glb)} bytes, {triangles} triangles, 22 bones, 1 body + 1 accessory material')
