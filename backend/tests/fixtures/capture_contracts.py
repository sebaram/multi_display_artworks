"""Regenerate contracts from the registered legacy app and synthetic model instances."""
import ast
import inspect
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from contract_introspection import auth_policy, input_contract

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT/'flask_server'), str(ROOT/'flask_server/app')]
os.environ.update(MONGODB_URI='mongodb://127.0.0.1:27028/metamuseum_test?directConnection=true', MONGODB_DB='metamuseum_test', SECRET_KEY='migration-local-secret', SECURITY_PASSWORD_SALT='migration-local-salt')
from bson import ObjectId, json_util
from metamuseum import create_app
from metamuseum.elements.basic import Room, Wall, Image, GaussianSplat, GLTFmodel, Webpage, LocationPreset, Marker, RoomEffect
from metamuseum.elements.user import OnlineUser
from metamuseum.models import User, LLMConfig, WhisperConfig

app = create_app()
def dump(name, value):
    (ROOT/'contracts'/name).write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf8')

def describe(fn):
    fn = inspect.unwrap(fn)
    source = inspect.getsource(fn)
    tree = ast.parse(inspect.cleandoc(source))
    inputs,fields = input_contract(inspect.cleandoc(source))
    returns = sorted({ast.unparse(n.value) for n in ast.walk(tree) if isinstance(n, ast.Return) and n.value})
    statuses=sorted({int(n.value.elts[-1].value) for n in ast.walk(tree) if isinstance(n,ast.Return) and isinstance(n.value,ast.Tuple) and isinstance(n.value.elts[-1],ast.Constant) and isinstance(n.value.elts[-1].value,int)})
    if any('redirect(' in value for value in returns):statuses.append(302)
    return {'source': str(Path(inspect.getfile(fn)).relative_to(ROOT)).replace('\\','/'), 'line': inspect.getsourcelines(fn)[1], 'decorators': [ast.unparse(x) for x in tree.body[0].decorator_list], 'input_expressions': inputs, 'input_fields':fields, 'response_expressions': returns, 'source_explicit_statuses': sorted(set(statuses)), 'implicit_return_status':200}

previous_routes_path=ROOT/'contracts/legacy-routes.json'
previous_routes=json.loads(previous_routes_path.read_text(encoding='utf8')) if previous_routes_path.exists() else {}
previous_by_key={(row['path'],row['endpoint']):row for row in previous_routes.get('routes',[])}
routes=[]
for rule in sorted(app.url_map.iter_rules(), key=lambda x:(x.rule,x.endpoint)):
    fn = app.view_functions[rule.endpoint]
    custom = inspect.unwrap(fn).__module__.startswith('metamuseum')
    row={'path':rule.rule,'methods':sorted(rule.methods-{'HEAD','OPTIONS'}),'endpoint':rule.endpoint,'automatic_methods':sorted(rule.methods & {'HEAD','OPTIONS'})}
    if custom:
        row.update(describe(fn))
        source=inspect.getsource(inspect.unwrap(fn))
        row['auth']=auth_policy(inspect.cleandoc(source),rule.endpoint,rule.rule)
    elif rule.endpoint=='static' or rule.endpoint.endswith('.static'):
        row['auth']='public static file'
    elif rule.rule.startswith('/kwanri'):
        row['auth']='admin session; otherwise 302 signin?next=<request.url>'
        row['payload_contract']='Flask-Admin generated HTML/form CRUD; model schema in legacy-bson.json; GET list/new/edit/details, POST forms/AJAX/action/delete; success200 or302, access denial302'
    else:
        row['auth']='public static file'
    row.update({key:value for key,value in previous_by_key.get((rule.rule,rule.endpoint),{}).items() if key.startswith('observed')})
    routes.append(row)
admin=app.extensions['admin'][0]
resources=[{'model':v.model.__name__, 'endpoint':v.endpoint, 'url':v.url, 'collection':v.model._get_collection_name(), 'auth':'admin session'} for v in admin._views if hasattr(v,'model')]
route_contract={'format_version':1,'captured_from':'registered Flask url_map; no declaration-count approximation','route_count':len(routes),'admin_resources':resources,'routes':routes}
route_contract.update({key:value for key,value in previous_routes.items() if key.endswith('_observations')})
dump('legacy-routes.json', route_contract)

sio=app.extensions['socketio']
handlers=[]
for namespace, events in sorted(sio.server.handlers.items()):
    for event, wrapped in sorted(events.items()):
        # Flask-SocketIO preserves the original callable with __wrapped__.
        fn=inspect.unwrap(wrapped)
        info=describe(fn)
        tree=ast.parse(inspect.cleandoc(inspect.getsource(fn)))
        emits=[]
        for n in ast.walk(tree):
            if isinstance(n,ast.Call) and (isinstance(n.func,ast.Attribute) and n.func.attr=='emit' or isinstance(n.func,ast.Name) and n.func.id=='emit'):
                emits.append(ast.unparse(n))
        info.update(namespace=namespace,event=event,emits=emits)
        if event=='connect':info['auth']='Missing visitorCapability permits device-only connection; invalid capability rejects; valid signed capability binds visitorId'
        elif event=='voice.admin_toggle':info['auth']='Room presence plus existing admin session'
        elif info['source'].endswith('position_sync.py'):info['auth']='Presence bound to socket SID and actual room; join requires capability visitorId and existing Room'
        else:info['auth']='Legacy AR/gesture device profile; no visitor capability/admin requirement; do not grant new wall input rights'
        handlers.append(info)
dump('socket-events.json', {'format_version':1,'namespace':'/','registered_handlers':handlers,'registration_note':'AR registers first, then position_sync. Final connect/disconnect are position_sync handlers; final disconnect explicitly cleans both AR and presence state. gesture_mark registration is module-global and happens once.','position_limits':{'max_pose_hz':20,'stationary_heartbeat_ms':1000,'interpolation_delay_ms':100,'buffer_samples':8},'new_wall_events':'Specified separately in approved design; absent from legacy capture.'})

OID=lambda n:ObjectId(f'{n:024x}')
T=datetime(2026,10,29)
room=Room(_id=OID(1),name='migration-room',description='Synthetic gallery',created_time=T,updated_time=T)
other=Room(_id=OID(2),name='migration-other-room',description='Isolation target',created_time=T,updated_time=T)
walls=[]
for n,name,rotation in [(11,'migration-rotated-wall','0 37 0'),(12,'migration-floor','-90 0 0'),(13,'migration-ceiling','90 0 0')]:
    walls.append(Wall(_id=OID(n),name=name,description='Synthetic surface',room=room,position='0 1.5 -3',rotation=rotation,width=6,height=4,depth=.2,image_url='http://127.0.0.1:8766/image.png',video_url='http://127.0.0.1:8766/video.mp4' if n==11 else '',surface_type='floor' if n==12 else 'ceiling' if n==13 else 'wall',created_time=T,updated_time=T))
room.walls=walls
base=dict(description='Synthetic artwork',position='0 0 0',position_x=.5,position_y=.25,scale_x=.8,scale_y=1.2,scale_z=1,rotation_x=0,rotation_y=0,rotation_z=12,created_time=T,updated_time=T)
image=Image(_id=OID(21),name='migration-image',wall=walls[0],image_url='http://127.0.0.1:8766/image.png',width=1,height=1,**base)
splat=GaussianSplat(_id=OID(22),name='migration-splat',wall=walls[0],splat_url='http://127.0.0.1:8766/cloud.splat',cutout_scale='0.5 0.5 0.5',cutout_position='0 0 0',**base)
gltf=GLTFmodel(_id=OID(23),name='migration-model',wall=walls[1],gltf_url='http://127.0.0.1:8766/triangle.glb',default_rotation='0 180 0',position_z=.1,**base)
page=Webpage(_id=OID(24),name='migration-webpage',wall=walls[2],webpage_url='http://127.0.0.1:8766/frame-allowed.html',width=2,height=1,**base)
blocked=Webpage(_id=OID(25),name='migration-blocked-webpage',wall=walls[2],webpage_url='http://127.0.0.1:8766/frame-blocked.html',width=2,height=1,**base)
walls[0].images=[image];walls[0].splats=[splat];walls[1].gltfs=[gltf];walls[2].webpages=[page,blocked]
preset=LocationPreset(_id=OID(31),name='Migration spawn',room=room,position_x=0,position_y=1.6,position_z=2,is_default=True,created_time=T)
marker=Marker(_id=OID(32),name='Migration Hiro',room=room,target_preset=preset,created_time=T)
effect=RoomEffect(_id=OID(33),room=room,effect_type='pulse',target_id=str(image.id),params={'color':'#ffaa00','intensity':.5,'duration':2},created_time=T,expires_at=datetime(2030,1,1),active=True,created_by='synthetic-admin')
import bcrypt
# Public local-only credentials; never copied from an existing user.
previous=ROOT/'contracts/legacy-bson.json'
password_hash=next((x['document']['password'] for x in json.loads(previous.read_text(encoding='utf8'))['documents'] if x['model']=='User'),None) if previous.exists() else None
password_hash=password_hash or bcrypt.hashpw(b'Migration-local-123!',bcrypt.gensalt(rounds=12)).decode()
users=[User(id=OID(41),email='admin@migration.invalid',name='Synthetic admin',password=password_hash,user_type=['admin'],email_verified=True),User(id=OID(42),email='visitor@migration.invalid',name='Synthetic nonadmin',password=password_hash,user_type=[],email_verified=True)]
llm=LLMConfig(id=OID(51),provider='openai',api_base='http://127.0.0.1:8766/v1',api_key='SYNTHETIC-SECRET-NOT-FOR-PUBLIC',model='fixture-model',updated_at=T.isoformat())
whisper=WhisperConfig(id=OID(52),provider='local',api_base='http://127.0.0.1:8766/v1',api_key='SYNTHETIC-STT-SECRET-NOT-FOR-PUBLIC',enabled=True,updated_at=T.isoformat())
online=OnlineUser(_id=OID(61),session_id='synthetic-camera-session',camera_position={'x':0,'y':1.6,'z':2},camera_rotation={'x':0,'y':90,'z':0},left_hand={'wrist':{'x':0,'y':1,'z':0}},right_hand={},hand_tracking_enabled={'enabled':True,'device':'fixture'},update_time=T)
models=[Room,Wall,Image,GaussianSplat,GLTFmodel,Webpage,LocationPreset,Marker,RoomEffect,User,LLMConfig,WhisperConfig,OnlineUser]
docs=[room,other,*walls,image,splat,gltf,page,blocked,preset,marker,effect,*users,llm,whisper,online]
schema=[]
for cls in models:
    fields={}
    for name,field in cls._fields.items():
        fields[name]={'type':type(field).__name__,'db_field':field.db_field,'required':field.required,'unique':bool(field.unique),'null':bool(field.null)}
        if hasattr(field,'document_type'):
            fields[name]['reference_model']=field.document_type.__name__
            fields[name]['dbref']=field.dbref
        if hasattr(field,'field') and hasattr(field.field,'document_type'):
            fields[name]['list_reference_model']=field.field.document_type.__name__
            fields[name]['dbref']=field.field.dbref
    schema.append({'model':cls.__name__,'collection':cls._get_collection_name(),'allow_inheritance':bool(cls._meta.get('allow_inheritance')),'fields':fields})
entries=[{'model':type(x).__name__,'collection':x._get_collection_name(),'document':json.loads(json_util.dumps(x.to_mongo(),json_options=json_util.CANONICAL_JSON_OPTIONS))} for x in docs]
dump('legacy-bson.json',{'format_version':1,'provenance':'Entirely synthetic; generated with legacy MongoEngine to_mongo; BSON canonical Extended JSON','public_secret_rule':'password and api_key never enter public DTOs; LLMConfig.to_dict omits api_key; Whisper has no model to_dict','schemas':schema,'documents':entries,'local_credentials':{'password':'Migration-local-123!','admin':'admin@migration.invalid','nonadmin':'visitor@migration.invalid'}})
assert 'api_key' not in llm.to_dict()
print(f'Captured {len(routes)} routes, {len(resources)} admin resources, {len(handlers)} final socket handlers, {len(entries)} BSON documents')
