import os
import mongoengine

# MongoDB connection — supports auth via URI
# Format: mongodb://user:password@host:port/dbname
# Or set MONGODB_HOST, MONGODB_PORT, MONGODB_DB individually
MONGODB_URI = os.environ.get('MONGODB_URI', '')
MONGODB_HOST = os.environ.get('MONGODB_HOST', 'localhost')
MONGODB_PORT = int(os.environ.get('MONGODB_PORT', 27017))
MONGODB_DB = os.environ.get('MONGODB_DB', 'metamuseum')
USE_MOCK = os.environ.get('MONGODB_MOCK', 'false').lower() == 'true'

if USE_MOCK:
    import mongomock
    mongoengine.connect(MONGODB_DB, mongo_client_class=mongomock.MongoClient)
    print("=======RUNNING WITH MONGOMOCK (in-memory DB)==========")
elif MONGODB_URI:
    mongoengine.connect(MONGODB_DB, host=MONGODB_URI)
    print("=======RUNNING MAIN APP (with auth URI)==========")
else:
    mongoengine.connect(MONGODB_DB, host=MONGODB_HOST, port=MONGODB_PORT)
    print("=======RUNNING MAIN APP (no auth)==========")

import metamuseum

app = metamuseum.create_app()
