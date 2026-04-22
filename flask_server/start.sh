#!/bin/bash
cd /app
python -c "
import sys, os
sys.path.insert(0, '/app')
print('===ENVIRONMENT===')
print('MONGODB_URI:', os.environ.get('MONGODB_URI'))
print('MONGODB_DB:', os.environ.get('MONGODB_DB'))
print('MONGODB_HOST:', os.environ.get('MONGODB_HOST'))
print('MONGODB_PORT:', os.environ.get('MONGODB_PORT'))
print('MONGODB_MOCK:', os.environ.get('MONGODB_MOCK'))
print()

import eventlet
eventlet.monkey_patch()
print('Eventlet patched')

import mongoengine
print('===MONGOCONNECT===')
# Try to connect
uri = os.environ.get('MONGODB_URI', '')
db_name = os.environ.get('MONGODB_DB', 'metamuseum')
if uri:
    result = mongoengine.connect(db_name, host=uri)
    print('Connected with URI, result:', result)
else:
    host = os.environ.get('MONGODB_HOST', 'localhost')
    port = int(os.environ.get('MONGODB_PORT', 27017))
    result = mongoengine.connect(db_name, host=host, port=port)
    print('Connected with host/port, result:', result)

print('Default connection:', mongoengine.connection._get_connection())
print('Default db:', mongoengine.get_db())
print()

print('===IMPORT APP===')
from metamuseum import create_app
app = create_app()
print('App created')

print('===TEST QUERY===')
from metamuseum.elements.basic import Room
print('Room count:', Room.objects.count())
print()

print('===START SERVER===')
from metamuseum.core.position_sync import init_socketio
socketio = init_socketio(app)
print('SocketIO OK')
socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
"