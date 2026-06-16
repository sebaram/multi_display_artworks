#!/bin/bash
cd /app
python -c "
import sys, os
sys.path.insert(0, '/app')

import eventlet
eventlet.monkey_patch()

from metamuseum import create_app
app = create_app()

# Get the SocketIO instance created by create_app()
# (__init__.py already inits ar_proxy, position_sync, and gesture_mark SocketIO)
from metamuseum.core.position_sync import socketio
if socketio is None:
    raise RuntimeError('SocketIO not initialized — check create_app()')

print('Starting MetaMuseum on :5000')
socketio.run(app, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
"
