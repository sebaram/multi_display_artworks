import mongoengine
from config import MONGODB_HOST, MONGODB_PORT, MONGODB_DB
mongoengine.connect(MONGODB_DB, host=MONGODB_HOST, port=MONGODB_PORT)

import metamuseum

print("=======RUNNING MAIN APP==========")
app = metamuseum.create_app()
# app.run(host="0.0.0.0", port=80)