"""Host-only acceptance: isolated staging writes; private-hold reads only.

Run as the private release-directory owner with `staging --release-dir DIR --operator NAME`, then
`private --attempt-dir DIR --operator NAME`. No production credentials are asked
for, no accounts are impersonated, and no seed/reset is used.
"""
import argparse
import hashlib
import http.client
import json
import os
import re
import subprocess
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import urlsplit

from inventory import CONTAINER, DATA, MEDIA, ReleaseError, command, environment, inspect
from operate import CHECKS, PRIVATE_CHECKS, assert_isolated, digest, require, require_path, wait_health, stage_address


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    # Evidence contains only digests, counts and assertions; keep even that private.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")


def verify_hashes(directory, manifest):
    for name, expected in manifest["sha256"].items():
        path = directory / name
        require(not Path(name).is_absolute() and directory.resolve() in path.resolve().parents,
                "Evidence manifest contains a path outside its private directory")
        require_path(path, is_file=True)
        require(digest(path) == expected, "Immutable backup/config checksum changed")


def validate_stage(directory, role, resource, app, mongo, network, expected_image):
    stage = directory / ("staging-" + role)
    assert_isolated(stage, [DATA])
    require(app["Name"].lstrip("/") == resource["app_container"] and
            mongo["Name"].lstrip("/") == resource["mongo_container"], "Staging container identity differs")
    require(app["Image"] == expected_image == resource["image"] and app["State"]["Running"] and
            mongo["State"]["Running"], "Staging image/running state differs")
    expected_network = resource["network"]
    require(network["Internal"] is True and network["Name"] == expected_network and
            set(network.get("Containers", {})) == {app["Id"], mongo["Id"]}, "Staging network is not exclusive/internal")
    require(all(set(item["NetworkSettings"]["Networks"]) == {expected_network} for item in (app, mongo)),
            "Staging container has an additional network")
    require(app["NetworkSettings"]["Ports"].get("5000/tcp") is None and not app["HostConfig"].get("PortBindings") and
            resource.get("http_scope") == "isolated-bridge" and resource.get("http_port") == 5000,
            "Staging must have no host/public port mapping")
    stage_address(app, expected_network)
    mounts = {item["Destination"]: item for item in app["Mounts"]}
    expected = {destination: (stage / "media" / name).resolve() for name, destination in MEDIA.items()}
    if role == "legacy" and MEDIA["wall_media"] not in mounts:
        expected.pop(MEDIA["wall_media"])
    require(set(mounts) == set(expected), "Staging media mount set differs")
    for target, source in expected.items():
        require(mounts[target]["Type"] == "bind" and Path(mounts[target]["Source"]).resolve() == source,
                "Staging media is not the private paired copy")
        require_path(source, is_file=target.endswith(".glb"))
    mongo_mounts = {mount["Destination"]: mount for mount in mongo["Mounts"]}
    expected_mongo = {"/data/db": stage / "mongo", "/data/configdb": stage / "mongo-configdb"}
    require(len(mongo["Mounts"]) == len(expected_mongo) and set(mongo_mounts) == set(expected_mongo),
            "Staging Mongo persistent mount set differs")
    for target, source in expected_mongo.items():
        require(mongo_mounts[target]["Type"] == "bind" and
                Path(mongo_mounts[target]["Source"]).resolve() == source.resolve(),
                "Staging Mongo is not the private restored database")
    env = environment(app)
    require(env["MONGODB_URI"] == "mongodb://mongo_container:27017/" + env["MONGODB_DB"],
            "Staging Mongo URI is not the isolated no-auth restore")


def compare_originals(original, current):
    require(bool(original), "Original collection evidence is empty")
    for name, before in original.items():
        after = current.get(name, {})
        require(after.get("count") == before["count"] and after.get("sha256") == before["sha256"],
                "An original collection ID/hash/reference/order changed")
        require(all(index in after.get("indexes", []) for index in before["indexes"]),
                "An original Mongo index changed or disappeared")


def mongo_digest(container, database):
    require(database.replace("_", "").replace("-", "").isalnum(), "Unexpected database name")
    # Mongo BSON Extended JSON retains ObjectIds, reference order and numeric types.
    script = """const d=db.getSiblingDB(DBNAME); const crypto=require('crypto');
function ordered(v){if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])]));return v;}
const out={};for(const n of d.getCollectionNames().sort()){const c=d.getCollection(n),h=crypto.createHash('sha256');let count=0;
const cursor=c.find().sort({_id:1});while(cursor.hasNext()){const doc=cursor.next();h.update(JSON.stringify(ordered(EJSON.serialize(doc,{relaxed:false}))));h.update('\\n');count++;}
out[n]={count,sha256:h.digest('hex'),indexes:c.getIndexes().map(i=>JSON.stringify(ordered(EJSON.serialize(i,{relaxed:false})))).sort()};}print(JSON.stringify(out));
""".replace("DBNAME", json.dumps(database))
    result = subprocess.run(["docker", "exec", "-i", container, "mongosh", "--quiet", "--file", "/dev/stdin"],
                            input=script.encode(), capture_output=True)
    if result.returncode:
        error = result.stderr.decode(errors="replace")
        classes = sorted(set(re.findall(r"\b([A-Za-z][A-Za-z0-9]*Error):", error)))
        symbols = [name for name in ("EJSON.serialize", "crypto.createHash", "getCollectionNames", "getIndexes", "ordered", "require") if name in error]
        raise ReleaseError("Mongo digest failed; classes=" + ",".join(classes) + "; symbols=" + ",".join(symbols))
    return json.loads(result.stdout)


def media_read(host, port, path):
    parsed = urlsplit(path)
    require(parsed.path.startswith("/static/") and not parsed.query and ".." not in parsed.path.split("/"),
            "Representative media must use a local static path")
    connection = http.client.HTTPConnection(host, port, timeout=20)
    try:
        connection.request("GET", parsed.path, headers={"Range": "bytes=0-65535"})
        response = connection.getresponse()
        body = response.read(65536)
        require(response.status in (200, 206) and body and "text/html" not in response.getheader("Content-Type", ""),
                "Representative original media did not return bytes")
        if parsed.path.endswith(".glb"):
            require(body[:4] == b"glTF", "A required GLB is not a GLB")
        return {"path_sha256": hashlib.sha256(parsed.path.encode()).hexdigest(),
                "prefix_sha256": hashlib.sha256(body).hexdigest(), "prefix_bytes": len(body)}
    finally:
        connection.close()


def legacy_after_writes(resources, manifest, directory, selectors, owned_room):
    candidate, legacy = resources["candidate"], resources["legacy"]
    app = inspect("container", candidate["app_container"])
    old = inspect("container", legacy["app_container"])
    name = candidate["app_container"] + "-rollback-proof"
    args = ["docker", "run", "-d", "--name", name, "--network", candidate["network"], "--env-file",
            str(directory / "staging-candidate/app.env")]
    entrypoint = old["Config"].get("Entrypoint") or []
    args += ["--entrypoint", entrypoint[0] if entrypoint else ""]
    for key, option in (("User", "--user"), ("WorkingDir", "--workdir")):
        if old["Config"].get(key):
            args += [option, old["Config"][key]]
    legacy_targets = {mount["Destination"] for mount in old["Mounts"]}
    for mount in app["Mounts"]:
        if mount["Destination"] in legacy_targets:
            args += ["--mount", "type=bind,src=" + mount["Source"] + ",dst=" + mount["Destination"] +
                     (",readonly" if not mount["RW"] else "")]
    args += [manifest["production_image"]] + entrypoint[1:] + (old["Config"].get("Cmd") or [])
    command(["docker", "stop", "--time", "30", candidate["app_container"]])
    created = False
    try:
        command(args);created = True
        rollback_host = stage_address(inspect("container", name), candidate["network"])
        wait_health(5000, host=rollback_host)
        for path in ("/", "/room?room_id=" + selectors["room"], "/room?room_id=" + owned_room,
                     "/wall?wall_id=" + selectors["wall"]):
            connection = http.client.HTTPConnection(rollback_host, 5000, timeout=20)
            try:
                connection.request("GET", path);response = connection.getresponse()
                require(response.status == 200 and response.read(65536), "Legacy image cannot read candidate-written staging database")
            finally:
                connection.close()
        for path in selectors["media"]:
            media_read(rollback_host, 5000, path)
        return {"legacy_image_on_candidate_written_staging_db_media": True}
    finally:
        if created:
            command(["docker", "rm", "-f", name])
        command(["docker", "start", candidate["app_container"]])
        wait_health(5000, host=stage_address(inspect("container", candidate["app_container"]), candidate["network"]))


# This runs inside the immutable candidate image, using its installed dependencies.
# No stdout contains records, cookies, capabilities, passwords or exception text.
WORKER = r'''
import hashlib,json,os,re,secrets,subprocess,tempfile,time
import http.client as http_client
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit
import bcrypt
from bson import ObjectId
from pymongo import MongoClient
from websockets.sync.client import connect

def check(value, label):
    if not value: raise RuntimeError(label)

class HTTP:
    def __init__(self): self.cookie=''; self.csrf=''
    def request(self,method,path,body=None,status=200,headers=None):
        h={'Origin':C['origin']}
        if self.cookie:h['Cookie']=self.cookie
        if self.csrf:h['X-CSRF-Token']=self.csrf
        if isinstance(body,dict):body=json.dumps(body).encode();h['Content-Type']='application/json'
        h.update(headers or {})
        c=http_client.HTTPConnection('127.0.0.1',5000,timeout=20)
        try:
            c.request(method,path,body=body,headers=h);r=c.getresponse();data=r.read()
            for k,v in r.getheaders():
                if k.lower()=='set-cookie':
                    cookie=SimpleCookie();cookie.load(v)
                    check(all(m['secure'] and m['httponly'] and m['samesite'].lower()=='lax' for m in cookie.values()),'cookie_flags')
                    self.cookie='; '.join(k+'='+v.value for k,v in cookie.items())
            route=re.sub(r'[a-f0-9]{24}','<id>',path.split('?',1)[0])
            check(r.status==status,'http_status '+method+' '+route+' expected '+str(status)+' actual '+str(r.status))
            return json.loads(data) if 'application/json' in r.getheader('Content-Type','') and data else data
        finally:c.close()
    def login(self):
        self.csrf=self.request('GET','/api/v1/auth/csrf')['csrf_token']
        result=self.request('POST','/api/v1/auth/signin',{'email':C['email'],'password':C['password']})
        check(result=={'authenticated':True,'is_admin':True},'positive_signin')
        self.csrf=self.request('GET','/api/v1/auth/csrf')['csrf_token']

class Socket:
    def __init__(self,http,admin=False):
        capability=HTTP().request('POST','/api/v1/visitor-capability',status=201)['capability']
        auth={'visitorCapability':capability}
        if admin:auth['csrfToken']=http.csrf
        self.ws=connect('ws://127.0.0.1:5000/socket.io/?EIO=4&transport=websocket',origin=C['origin'],
                        additional_headers={'Cookie':http.cookie} if admin else {},open_timeout=8,proxy=None)
        check(self.ws.recv(timeout=8).startswith('0'),'engine_open');self.ws.send('40'+json.dumps(auth))
        self.events=[];self.sequence=0
        while not self.packet().startswith('40'):pass
    def packet(self):
        p=self.ws.recv(timeout=8)
        if p=='2':self.ws.send('3');return self.packet()
        if p.startswith('42'):
            value=json.loads(p[p.index('['):]);self.events.append(value)
        check(not p.startswith(('44','41')),'socket_connection')
        return p
    def call(self,event,data):
        self.sequence+=1;prefix='43'+str(self.sequence)
        self.ws.send('42'+str(self.sequence)+json.dumps([event,data]))
        while True:
            p=self.packet()
            if p.startswith(prefix+'['):
                result=json.loads(p[len(prefix):]);return result[0] if result else None
    def event(self,name):
        end=time.monotonic()+8
        while time.monotonic()<end:
            for i,event in enumerate(self.events):
                if event[0]==name:return self.events.pop(i)[1]
            self.packet()
        raise RuntimeError('socket_event')
    def close(self):self.ws.close()

db=MongoClient(os.environ['MONGODB_URI'])[os.environ['MONGODB_DB']]
http=HTTP()
def signature(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def owned():
    return {name:db[collection].find_one({'name':C['token']}) for name,collection in
            [('room','room'),('wall','wall'),('preset','wall_design_presets')]}

def clean():
    http.login();items=owned();wall=items['wall']
    if wall:
        identifier=str(wall['_id']);binding=http.request('GET','/api/v1/walls/'+identifier+'/design')
        if binding:http.request('DELETE','/api/v1/walls/'+identifier+'/design?expected_revision='+str(binding['revision']),status=204)
    preset=items['preset']
    if preset:http.request('DELETE','/api/v1/wall-presets/'+str(preset['_id'])+'?expected_revision='+str(preset['revision']),status=204)
    for asset in db.wall_design_assets.find({'name':C['token']+'.mp4'}):
        http.request('DELETE','/api/v1/wall-assets/'+str(asset['_id']),status=204)
    for name in ('wall','room'):
        if items[name]:http.request('DELETE','/api/v1/admin/'+name+'s/'+str(items[name]['_id']),status=204)
    db.users.delete_one({'email':C['email'],'name':C['token']})
    check(not any(owned().values()) and db.users.count_documents({'email':C['email']})==0 and
          db.wall_design_assets.count_documents({'name':C['token']+'.mp4'})==0,'owned_cleanup')
    return {'owned_cleanup':True}

def readonly():
    http.request('GET','/health');http.request('GET','/')
    if C.get('require_defaults'):
        source=json.loads(Path('/app/web/wall-presets/manifest.json').read_text())['presets']
        expected={item['source_key'] for item in source}
        available={item['source_key'] for item in http.request('GET','/api/v1/wall-presets') if item['read_only']}
        check(len(expected)==44 and expected<=available,'default_catalog_missing')
    csrf=http.request('GET','/api/v1/auth/csrf')['csrf_token']
    check(bool(http.cookie),'session_cookie_missing')
    check(http.request('GET','/api/v1/auth/session')=={'authenticated':False,'is_admin':False},'anonymous_session')
    check(http.request('POST','/api/v1/auth/signin',{'email':'release-acceptance@invalid.invalid','password':'invalid'},status=403)=={'detail':'csrf_denied'},'csrf_error')
    check(http.request('GET','/api/v1/admin/schema',status=403)=={'detail':'admin_required'},'admin_error')
    rooms=http.request('GET','/api/v1/rooms');check(rooms,'original_room_missing')
    room=db.room.find_one();wall=db.wall.find_one()
    check(room and wall,'original_room_wall_missing')
    http.request('GET','/room?room_id='+str(room['_id']));http.request('GET','/api/v1/rooms/'+str(room['_id'])+'/scene')
    http.request('GET','/wall?wall_id='+str(wall['_id']));http.request('GET','/api/v1/walls/'+str(wall['_id']))
    paths=[]
    for collection,field,kind,model_class in [('image','image_url','image','Image'),('gaussian_splat','splat_url','gaussian_splat','GaussianSplat'),('g_l_t_fmodel','gltf_url','gltf','GLTFmodel')]:
        # Match the unchanged MongoEngine inheritance discriminator, not obsolete raw records.
        record=db[collection].find_one({field:{'$type':'string','$ne':''},'_cls':model_class})
        check(record,'original_'+kind+'_missing')
        C['element_probe']={'id':str(record['_id']),'kind':kind,'media':record[field],
                            'known_class':record.get('_cls') in ('Image','GaussianSplat','GLTFmodel')}
        http.request('GET','/api/v1/elements/'+kind+'/'+str(record['_id']))
        parsed=urlsplit(record[field]);path=parsed.path
        if path.startswith('static/'):path='/'+path
        check(not parsed.scheme and not parsed.netloc and not parsed.query and
              path.startswith('/static/') and '..' not in path.split('/'),'original_media_not_local')
        paths.append(path)
    paths+=['/static/gltf/matisse_dance.glb','/static/gltf/wheel.glb']
    a=b=None
    try:
        a,b=Socket(http),Socket(http)
        for peer in (a,b):
            peer.call('join_position_room',{'room_id':str(room['_id'])});peer.event('room_state')
            check(abs(peer.call('wall.clock',{})['server_time_ms']-time.time()*1000)<10000,'wall_clock')
        check(a.event('user_joined')['room_id']==str(room['_id']),'two_visitors')
    finally:
        for peer in (a,b):
            if peer:peer.close()
    return {'health':True,'auth_cookie_and_denials':True,'gallery':True,'two_visitors_and_clock':True,
            'selectors':{'room':str(room['_id']),'wall':str(wall['_id']),'media':paths}}

def create():
    check(C['mode']=='create' and C['stage_write'] is True,'staging_writes_only')
    check(not db.users.find_one({'email':C['email']}) and not any(owned().values()),'ownership_collision')
    db.users.insert_one({'email':C['email'],'name':C['token'],'password':bcrypt.hashpw(C['password'].encode(),bcrypt.gensalt()).decode(),
                         'email_verified':True,'user_type':['admin']})
    http.login()
    room=http.request('POST','/api/v1/admin/rooms',{'name':C['token'],'description':'Owned staging acceptance'},201)
    wall=http.request('POST','/api/v1/admin/walls',{'name':C['token'],'description':'Owned staging acceptance','room':room['id'],
                      'position':'0 1 0','rotation':'0 0 0','width':2.0,'height':2.0,'depth':0.1},201)
    with tempfile.TemporaryDirectory() as directory:
        path=Path(directory)/'probe.mp4'
        result=subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32:r=10',
                               '-t','2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(path)],capture_output=True)
        check(result.returncode==0,'ffmpeg_mp4');clip=path.read_bytes()
    boundary=secrets.token_hex(16)
    body=('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="'+C['token']+'.mp4"\r\nContent-Type: video/mp4\r\n\r\n').encode()+clip+('\r\n--'+boundary+'--\r\n').encode()
    asset=http.request('POST','/api/v1/wall-assets',body,201,{'Content-Type':'multipart/form-data; boundary='+boundary})
    check(http.request('GET',asset['url'],status=206,headers={'Range':'bytes=0-15'})==clip[:16],'mp4_range_206')
    config=json.loads(Path('/app/web/wall-presets/builtin-0.json').read_text())['config']
    config['state'].update(interactive=True,paused=True,offset=0,speed=1,videoLayers=[{'id':'release-video','assetId':asset['id']}])
    preset=http.request('POST','/api/v1/wall-presets',{'name':C['token'],'config':config},201)
    design=http.request('PUT','/api/v1/walls/'+wall['id']+'/design',{'preset_id':preset['id'],'expected_revision':0})
    peers=[]
    try:
        peers=[Socket(http),Socket(http),Socket(http,admin=True)]
        for peer in peers:
            peer.call('join_position_room',{'room_id':room['id']});peer.event('room_state');peer.event('wall.snapshot')
        command={'wall_id':wall['id'],'binding_revision':design['revision']}
        check(peers[0].call('wall.interaction',{**command,'client_seq':1,'kind':'move','uv':{'u':1,'v':0}})['ok'],'pointer_ack')
        first,second=peers[0].event('wall.interaction_state'),peers[1].event('wall.interaction_state')
        check(first==second and first['pointer']=={'x':0.5,'y':0.5},'shared_pointer')
        revision=design['playback']['revision']
        for action in ('play','pause','seek'):
            result=peers[2].call('wall.playback_command',{**command,'expected_playback_revision':revision,'action':action,'position_seconds':1})
            check(result['ok'],'playback_ack');revision=result['state']['revision']
            check(peers[0].event('wall.playback_state')==peers[1].event('wall.playback_state')==result['state'],'shared_playback')
    finally:
        for peer in peers:peer.close()
    design=http.request('GET','/api/v1/walls/'+wall['id']+'/design')
    return {'positive_auth':True,'upload_apply':True,'range_206':True,'two_visitors_pointer_mp4':True,
            'owned_room':room['id'],
            'expected':{'preset':signature(preset),'design':signature(design),'clip':hashlib.sha256(clip).hexdigest()}}

def verify():
    http.login();items=owned();check(all(items.values()),'owned_fixture_missing')
    preset=http.request('GET','/api/v1/wall-presets/'+str(items['preset']['_id']))
    design=http.request('GET','/api/v1/walls/'+str(items['wall']['_id'])+'/design')
    asset=db.wall_design_assets.find_one({'name':C['token']+'.mp4'});check(asset,'asset_missing')
    clip=http.request('GET','/api/v1/wall-assets/'+str(asset['_id'])+'/content')
    check({'preset':signature(preset),'design':signature(design),'clip':hashlib.sha256(clip).hexdigest()}==C['expected'],'restart_persistence')
    return {'restart_persistence':True}

def defaults():
    from metamuseum.config import Settings
    from metamuseum.db import connect_database,disconnect_database
    from metamuseum.services.wall_designs import import_defaults
    connect_database(Settings())
    try:
        check(import_defaults(Settings())==44,'preset_import_count')
        before=list(db.wall_design_presets.find({'read_only':True}).sort('_id',1))
        check(import_defaults(Settings())==44 and len(before)==44 and before==list(db.wall_design_presets.find({'read_only':True}).sort('_id',1)),'idempotent_defaults')
    finally:disconnect_database()
    return {'default_presets_44_idempotent':True}

try:
    check(C['mode']=='read' or C.get('stage_write') is True,'staging_writes_only')
    result={'read':readonly,'create':create,'verify':verify,'cleanup':clean,'import':defaults}[C['mode']]()
    print(json.dumps({'ok':True,'result':result}))
except BaseException as error:
    print(json.dumps({'ok':False,'failed_mode':C['mode'],'failed_check':str(error) if type(error) is RuntimeError else type(error).__name__,
                      'element_probe':C.get('element_probe')}))
'''


def worker(container, mode, config):
    script = "C=" + repr(dict(config, mode=mode)) + "\n" + WORKER
    result = json.loads(command(["docker", "exec", "-i", container, "python", "-"], data=script.encode()))
    probe=result.get('element_probe')
    if not result.get('ok') and probe and config.get('legacy_host'):
        connection=http.client.HTTPConnection(config['legacy_host'],5000,timeout=20)
        try:
            connection.request('GET','/element?wall_element_id='+probe['id']+'&type='+probe['kind'])
            response=connection.getresponse();body=response.read(262144)
            print('Legacy representative comparison: '+json.dumps({'legacy_status':response.status,
                  'legacy_includes_media':probe['media'].encode() in body,'known_class':probe['known_class']}),flush=True)
        finally:connection.close()
    require(result.get("ok") is True, "Candidate acceptance failed in " + mode + ": " + result.get("failed_check", "unknown"))
    return result["result"]


def validate_binding(template, manifest, directory, *, private=False):
    key, file = ("hold_sha256", "hold.json") if private else ("prepared_sha256", "prepared.json")
    path_key = "attempt_dir" if private else "release_dir"
    require(template.get(key) == digest(directory / file) and template.get(path_key) == str(directory) and
            all(template.get(k) == manifest[k] for k in ("candidate_image", "candidate_sha")),
            "Acceptance template belongs to different immutable evidence")


def evidence_finish(directory, template, checks, report, operator, *, private=False):
    name = "private-operator-checks" if private else "operator-checks"
    report_path = directory / (name + ".evidence." + secrets.token_hex(6) + ".json")
    report.update(completed_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  old_password_login="untested; existing operator must confirm separately", checks=checks)
    write(report_path, report)
    result = dict(template, operator=operator, evidence=str(report_path), evidence_sha256=digest(report_path), checks=checks)
    # Failed evidence is useful, but never creates the gate consumed by operate.py.
    write(directory / (name + (".json" if all(checks.values()) else ".remaining." + secrets.token_hex(4) + ".json")), result)
    if report.get("failure"):
        print("Acceptance stopped: " + report["failure"], flush=True)
    return all(checks.values())


def close_staging(directory):
    manifest = read(directory / "prepared.json")
    gate = read(directory / "operator-checks.json")
    validate_binding(gate, manifest, directory)
    require(all(gate.get("checks", {}).get(key) is True for key in CHECKS) and
            digest(gate["evidence"]) == gate["evidence_sha256"], "Close only a completed staging rehearsal")
    resources = []
    # Validate both stacks before removing either; all persistent bind copies remain.
    for role in ("candidate", "legacy"):
        resource = read(directory / ("staging-" + role) / "resources.json")
        validate_stage(directory, role, resource, inspect("container", resource["app_container"]),
                       inspect("container", resource["mongo_container"]), inspect("network", resource["network"]),
                       manifest["candidate_image" if role == "candidate" else "production_image"])
        resources.append(resource)
    for resource in resources:
        command(["docker", "rm", "-f", resource["app_container"], resource["mongo_container"]])
        command(["docker", "network", "rm", resource["network"]])
    write(directory / "staging-closed.json", {"paired_data_and_backups_retained": True})
    print("Completed staging containers closed; all paired data and backups retained.", flush=True)


def stage_acceptance(directory, operator):
    manifest=read(directory / "prepared.json");verify_hashes(directory, manifest)
    verify_hashes(directory / "snapshot", read(directory / "snapshot/snapshot.json"))
    template=read(directory / "operator-checks.required.json");validate_binding(template,manifest,directory)
    checks={key:False for key in CHECKS};report={"prepared_sha256":digest(directory/"prepared.json")}
    try:
        resources={role:read(directory/("staging-"+role)/"resources.json") for role in ("candidate","legacy")}
        for role,r in resources.items():
            validate_stage(directory,role,r,inspect("container",r["app_container"]),inspect("container",r["mongo_container"]),
                           inspect("network",r["network"]),manifest["candidate_image" if role=="candidate" else "production_image"])
        candidate,legacy=resources["candidate"],resources["legacy"]
        candidate_host=stage_address(inspect("container",candidate["app_container"]),candidate["network"])
        legacy_host=stage_address(inspect("container",legacy["app_container"]),legacy["network"])
        env=environment(inspect("container",candidate["app_container"]))
        config={"origin":"http://127.0.0.1:5000","stage_write":True,"legacy_host":legacy_host,
                "token":"release-acceptance-"+secrets.token_hex(12),"password":secrets.token_urlsafe(40)}
        config["email"]=config["token"]+"@staging.invalid"
        before=mongo_digest(legacy["mongo_container"],env["MONGODB_DB"])
        compare_originals(before,mongo_digest(candidate["mongo_container"],env["MONGODB_DB"]))
        reads=worker(candidate["app_container"],"read",config);selectors=reads.pop("selectors")
        candidate_media=[media_read(candidate_host,5000,path) for path in selectors["media"]]
        for path in ("/health","/","/room?room_id="+selectors["room"],"/wall?wall_id="+selectors["wall"]):
            c=http.client.HTTPConnection(legacy_host,5000,timeout=20)
            try:c.request("GET",path);r=c.getresponse();require(r.status==200 and r.read(65536),"Legacy restored gallery failed")
            finally:c.close()
        require(candidate_media==[media_read(legacy_host,5000,path) for path in selectors["media"]],
                "Legacy and candidate original media differ")
        checks[CHECKS[3]]=True;report.update(reads=reads,media=candidate_media,original_collections=before)
        report["defaults"]=worker(candidate["app_container"],"import",config)
        try:
            created=worker(candidate["app_container"],"create",config)
            checks[CHECKS[1]]=created["positive_auth"] and reads["auth_cookie_and_denials"]
            checks[CHECKS[5]]=created["two_visitors_pointer_mp4"] and created["range_206"]
            command(["docker","restart",candidate["app_container"]])
            wait_health(5000,host=stage_address(inspect("container",candidate["app_container"]),candidate["network"]))
            persisted=worker(candidate["app_container"],"verify",dict(config,expected=created["expected"]))
            report["rollback_after_candidate_writes"]=legacy_after_writes(resources,manifest,directory,selectors,created["owned_room"])
            worker(candidate["app_container"],"verify",dict(config,expected=created["expected"]))
            checks[CHECKS[0]]=True
            checks[CHECKS[4]]=created["upload_apply"] and persisted["restart_persistence"]
        finally:
            report["cleanup"]=worker(candidate["app_container"],"cleanup",config)
        compare_originals(before,mongo_digest(candidate["mongo_container"],env["MONGODB_DB"]))
        compare_originals(before,mongo_digest(legacy["mongo_container"],env["MONGODB_DB"]))
        checks[CHECKS[2]]=True
        # Reads, media and sockets succeeded with no host/public staging port publication.
        checks[CHECKS[6]]=reads["two_visitors_and_clock"]
    except (ReleaseError,OSError,ValueError,KeyError,TypeError) as error:
        report["failure"]=str(error) if isinstance(error,ReleaseError) else type(error).__name__
    return evidence_finish(directory,template,checks,report,operator)


def private_acceptance(directory, operator):
    held=read(directory/"hold.json");verify_hashes(directory,held)
    template=read(directory/"private-operator-checks.required.json");validate_binding(template,held,directory,private=True)
    checks={key:False for key in PRIVATE_CHECKS};report={"hold_sha256":digest(directory/"hold.json")}
    try:
        release=Path(held["release_dir"]);prepared=read(release/"prepared.json");stage=read(release/"operator-checks.json")
        validate_binding(stage,prepared,release)
        require(all(stage.get("checks",{}).get(key) is True for key in CHECKS) and
                all(stage.get(key)==held[key] for key in ("candidate_image","candidate_sha")) and
                digest(stage["evidence"])==stage["evidence_sha256"],"Same-image completed staging evidence is missing")
        app=inspect("container",held["private_app_container"])
        require(held["private_app_container"]==CONTAINER and app["Image"]==held["candidate_image"] and app["State"]["Running"] and
                app["NetworkSettings"]["Ports"].get("5000/tcp")==[{"HostIp":"127.0.0.1","HostPort":str(held["private_port"])}],
                "Private hold container/image/loopback differs")
        old=environment(read(directory/"container.inspect.json"));current=environment(app)
        require(all(secrets.compare_digest(old[key],current[key]) for key in ("SECRET_KEY","SECURITY_PASSWORD_SALT","MONGODB_URI","MONGODB_DB")),
                "Existing live authentication/database material changed")
        legacy=read(release/"staging-legacy/resources.json")
        # Keep the live Mongo URI in stdin, never argv or a diagnostic message.
        user_script="""import hashlib,json,os
from bson.json_util import dumps,CANONICAL_JSON_OPTIONS
from pymongo import MongoClient
d=MongoClient(os.environ['MONGODB_URI'])[os.environ['MONGODB_DB']];h=hashlib.sha256();count=0
for doc in d.users.find().sort('_id',1):
 h.update(dumps(doc,json_options=CANONICAL_JSON_OPTIONS,sort_keys=True,separators=(',',':')).encode());h.update(b'\\n');count+=1
print(json.dumps({'count':count,'sha256':h.hexdigest()}))
"""
        # Use the same canonical Python implementation on both sides to avoid EJSON formatting differences.
        # The legacy runtime already depends on pymongo through MongoEngine.
        pristine_script=user_script
        pristine=json.loads(command(["docker","exec","-i",legacy["app_container"],"python","-"],data=pristine_script.encode()))
        live_before=json.loads(command(["docker","exec","-i",CONTAINER,"python","-"],data=user_script.encode()))
        require(pristine==live_before,"Live account digests differ from the pristine staging snapshot; reassess final frozen backup")
        require({m["Destination"]:Path(m["Source"]).resolve() for m in app["Mounts"]}==
                {destination:(DATA/name).resolve() for name,destination in MEDIA.items()},"Private hold live media mounts differ")
        # This worker mode has no account insertion, login, preset import or mutation.
        result=worker(CONTAINER,"read",{"origin":"http://127.0.0.1:"+str(held["private_port"]),"stage_write":False,"require_defaults":True})
        require(live_before==json.loads(command(["docker","exec","-i",CONTAINER,"python","-"],data=user_script.encode())),
                "Live account digests changed during read-only acceptance")
        selectors=result.pop("selectors")
        report.update(reads=result,media=[media_read("127.0.0.1",held["private_port"],path) for path in selectors["media"]],
                      staging_evidence_sha256=stage["evidence_sha256"],auth_material_preserved=True,account_digest=live_before,
                      scope="live reads and anonymous visitors/clock; positive login, upload, playback and restart proven on isolated same-image staging")
        report['default_presets_44_visible']=True
        checks.update(health=result["health"],staging_login_and_preserved_auth=result["auth_cookie_and_denials"],
                      live_room_wall_image_splat_gltf=result["gallery"],live_two_visitors_realtime=result["two_visitors_and_clock"],
                      staging_preset_upload_apply_restart=True,staging_shared_mp4_and_live_clock=result["two_visitors_and_clock"])
    except (ReleaseError,OSError,ValueError,KeyError,TypeError) as error:
        report["failure"]=str(error) if isinstance(error,ReleaseError) else type(error).__name__
    return evidence_finish(directory,template,checks,report,operator,private=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="mode",required=True)
    staging=sub.add_parser("staging");staging.add_argument("--release-dir",type=Path,required=True)
    private=sub.add_parser("private");private.add_argument("--attempt-dir",type=Path,required=True)
    close=sub.add_parser("close-staging");close.add_argument("--release-dir",type=Path,required=True)
    for item in (staging,private,close):item.add_argument("--operator",required=True)
    args=parser.parse_args()
    try:
        require(sys.platform.startswith("linux"),
                "Run this host-only helper on the Linux Docker host")
        directory=args.attempt_dir if args.mode=="private" else args.release_dir
        require_path(directory);require(directory.is_absolute(),"Use the absolute private release/attempt directory")
        require(directory.stat().st_uid in (0,os.geteuid()) and directory.stat().st_mode & 0o077 == 0,
                "Release/attempt directory must be private and owned by this operator or root")
        require(bool(args.operator.strip()),"An operator identity is required")
        if args.mode=="close-staging":
            close_staging(directory)
            return 0
        gate=directory/("operator-checks.json" if args.mode=="staging" else "private-operator-checks.json")
        require(not gate.exists(),"This acceptance gate already exists; keep its completed evidence immutable")
        complete=(stage_acceptance if args.mode=="staging" else private_acceptance)(directory,args.operator)
        print("Acceptance passed; private evidence written." if complete else "Acceptance incomplete; private remaining-flags evidence written.")
        return 0 if complete else 1
    except (ReleaseError,OSError,ValueError,KeyError,TypeError):
        print("Acceptance refused before proof completed; no passing gate was inferred.",file=sys.stderr);return 1


if __name__=="__main__":sys.exit(main())
