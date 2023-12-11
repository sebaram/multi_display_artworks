# -*- coding: utf-8 -*-

from flask import Flask, flash
from flask_login import UserMixin
from flask.helpers import url_for

from mongoengine import Document
from mongoengine import DateTimeField, StringField, ReferenceField, ListField, EmbeddedDocumentField
from bson.objectid import ObjectId



from datetime import datetime
import os

if __name__ == "__main__":
    from flask import Flask
    from flask_mongoengine import MongoEngine

    import os
    import sys
    import inspect
    
    currentdir = os.path.dirname(os.path.abspath(inspect.getfile(inspect.currentframe())))
    print("currentdir: ", currentdir)
    parentdir = os.path.dirname(currentdir)
    print("parentdir: ", parentdir)
    parentdir = os.path.dirname(parentdir)
    print("parentdir: ", parentdir)
    sys.path.insert(0, parentdir) 
    import config

    
    app = Flask(__name__)
    app.config['MONGODB_SETTINGS'] = config.MONGODB_SETTINGS
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db = MongoEngine()
    db.init_app(app)
else:
    from metamuseum import db
    from random import randint 


class OnlineUser(db.Document):
    # this will be used to store the user's session id and camera position temporarily
    # so that the user can continue the session from the last point

    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)
    session_id = db.StringField(required=True, unique=True)
    camera_position = db.DictField()
    camera_rotation = db.DictField()

    update_time = db.DateTimeField(default=datetime.utcnow)
    