"""Capture actual safe HTTP responses for synthetic data without provider/media calls."""
import inspect
import json
import os
import sys
from pathlib import Path
from isolated_db import connect, URI, DATABASE
from seed import seed
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'flask_server'),str(ROOT/'flask_server/app')]
os.environ.update(MONGODB_URI=URI,MONGODB_DB=DATABASE,SECRET_KEY='migration-local-secret',SECURITY_PASSWORD_SALT='migration-local-salt')
seed(connect())
from metamuseum import create_app
app=create_app()
fixture=json.loads((ROOT/'contracts/legacy-bson.json').read_text(encoding='utf8'))
ids={'room_id':'000000000000000000000001','wall_id':'00000000000000000000000b','element_id':'000000000000000000000015','preset_id':'00000000000000000000001f','marker_id':'000000000000000000000020','element_type':'image','marker_type':'hiro','marker_value':'hiro','stream_id':'migration-fixture','segment':'segment00.ts','token':'invalid-synthetic-token','filename':'missing'}
contract=json.loads((ROOT/'contracts/legacy-routes.json').read_text(encoding='utf8'))
by_key={(x['path'],x['endpoint']):x for x in contract['routes']}
client=app.test_client()
for rule in app.url_map.iter_rules():
    row=by_key[(rule.rule,rule.endpoint)]
    # SSE never finishes; fixture extraction does not consume a stream.
    if rule.rule=='/gesture-mark/stream':
        row['observed']={'skipped':'SSE infinite response; source contract captured'};continue
    try:path=rule.build({x:ids.get(x,'synthetic-missing') for x in rule.arguments})[1]
    except Exception:continue
    observed={}
    for method in row['methods']:
        # Anonymous mutations validate auth/body contracts and never start FFmpeg/provider work.
        response=client.open(path,method=method,json={} if method in ('POST','PUT','PATCH') else None)
        result={'status':response.status_code,'content_type':response.mimetype}
        if response.is_json:
            payload=response.get_json()
            result['json_shape']=sorted(payload) if isinstance(payload,dict) else 'array'
        if response.headers.get('Location'):result['location']=response.headers['Location']
        observed[method]=result
    row['observed_anonymous_missing_or_default_input']=observed
# Exercise a real bcrypt login instead of bypassing authentication.
response=client.post('/signin?next=/kwanri/',data={'email':'admin@migration.invalid','password':'Migration-local-123!'})
assert response.status_code==302,response.status_code
assert client.get('/kwanri/').status_code==200
with client.session_transaction() as session:assert session['_user_id']=='admin@migration.invalid'
settings=client.get('/api/whisper-config').get_json()
assert 'api_key' not in settings
assert client.get('/api/whisper-config').status_code==200
other=app.test_client()
response=other.post('/signin',data={'email':'visitor@migration.invalid','password':'Migration-local-123!'})
assert response.status_code==302
assert other.get('/kwanri/').status_code==302
assert other.get('/api/whisper-config').status_code==403
contract['synthetic_login_observations']={'real_bcrypt_admin_signin':302,'admin_kwanri':200,'real_bcrypt_nonadmin_signin':302,'nonadmin_kwanri':302,'admin_whisper_settings':200,'nonadmin_whisper_settings':403,'settings_excludes_api_key':True}
(ROOT/'contracts/legacy-routes.json').write_text(json.dumps(contract,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print('Captured anonymous statuses/shapes for 154 finite HTTP rules; verified real bcrypt admin/nonadmin login and secret exclusion')
