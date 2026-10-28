"""Explicit real-MongoDB seed/round-trip check for the isolated migration instance."""
import json
from bson import json_util
from isolated_db import connect, DATABASE
from seed import seed

client=connect()
fixture=seed(client)
for entry in fixture['documents']:
    expected=json_util.loads(json.dumps(entry['document']))
    actual=client[DATABASE][entry['collection']].find_one({'_id':expected['_id']})
    assert actual==expected,entry['model']
room=client[DATABASE].room.find_one({'name':'migration-room'})
assert len(room['walls'])==3
for wall_id in room['walls']:
    wall=client[DATABASE].wall.find_one({'_id':wall_id})
    assert wall['room']==room['_id']
    for field,model in [('images','Image'),('splats','GaussianSplat'),('gltfs','GLTFmodel'),('webpages','Webpage')]:
        # Actual unusual collection names come from model metadata, never guesses.
        collection=next(x['collection'] for x in fixture['schemas'] if x['model']==model)
        for element_id in wall[field]:
            assert client[DATABASE][collection].find_one({'_id':element_id})['wall']==wall['_id']
assert client['metamuseum_migration_guard'].instance.count_documents({})==1
print(f'Real MongoDB BSON round trip: {len(fixture["documents"])} documents; ordered room/wall and reverse artwork refs preserved; marker survives reset')
