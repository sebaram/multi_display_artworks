"""Verify real legacy marker authorization against guarded synthetic Mongo data."""
import json
import os
import sys
from pathlib import Path
from legacy_source import legacy_root
from isolated_db import connect, URI, DATABASE
from seed import seed

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(legacy_root()),str(legacy_root()/'app')]
os.environ.update(MONGODB_URI=URI,MONGODB_DB=DATABASE,SECRET_KEY='migration-local-secret',SECURITY_PASSWORD_SALT='migration-local-salt')
client_db=connect()
seed(client_db)
from metamuseum import create_app
from metamuseum.elements.basic import Marker
app=create_app()
path='/marker/000000000000000000000020'
results={}
for role,email in [('guest',None),('nonadmin','visitor@migration.invalid'),('admin','admin@migration.invalid')]:
    client=app.test_client()
    if email:
        with client.session_transaction() as session:
            session['_user_id']=email
            session['_fresh']=True
    results[role]={}
    for method in ('PUT','DELETE'):
        response=client.open(path,method=method,json={'description':'synthetic authorized update'} if method=='PUT' else None)
        expected=200 if role=='admin' else 403
        assert response.status_code==expected,(role,method,response.status_code)
        results[role][method]={'status':response.status_code,'json_fields':sorted(response.get_json())}
        if role=='admin' and method=='PUT':
            assert Marker.objects.get(_id='000000000000000000000020').description=='synthetic authorized update'
        if role!='admin':assert Marker.objects.count()==1
assert Marker.objects.count()==0
contract_path=ROOT/'contracts/legacy-routes.json'
contract=json.loads(contract_path.read_text(encoding='utf8'))
contract['marker_authorization_observations']={'database':'guarded metamuseum_test','actors':'real persisted synthetic User documents; Flask session user_loader','results':results,'admin_put_persisted':True,'admin_delete_removed':True,'guest_and_nonadmin_left_marker_unchanged':True}
contract_path.write_text(json.dumps(contract,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print('PASS: real MongoDB marker PUT/DELETE guest403, nonadmin403, admin200; update persisted and delete removed marker')
client_db.close()
