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
    parentdir = os.path.dirname(currentdir)
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
    

    
    
class Log(db.Document):
    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)
    created_time = db.DateTimeField(default=datetime.utcnow)
    log_text = db.StringField(required=True)

    def __repr__(self):
        return "<Log created_time:{} log:{}>".format(self.created_time, self.log_text)


class User(UserMixin, db.Document):
    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = db.StringField(required=True)         # 실명
    password = db.StringField(required=True)     # 비밀번호(해시값)
    email = db.StringField(required=True, unique=True)       # 이메일=로그인 아이디
    email_verified = db.BooleanField(default=False) # 이메일 인증 여부
    user_type = db.StringField(default="new")     # admin, ctar, uvrlab, daejeon
    phone = db.StringField(required=True)       # 연락처
    affiliation = db.StringField(required=True)  # 소속

    language = db.StringField(default="en")      # 언어

    is_authenticated = False
    is_anonymous = False
    is_active = True

    # is_authenticated = False
    def __repr__(self):
        return "<User _id:{} name:{}>".format(self._id, self.name)
    def is_admin(self):
        if self.user_type is None:
            return False
        return "admin" in self.user_type
    def to_json(self):
        return {"name": self.name,
                "email": self.email}
    
    # methods for Flask-login
    def is_authenticated(self):
        return self.is_authenticated
    def is_active(self):
        return True
    def get_id(self):
        return str(self.email)   
    
    





if __name__ == "__main__":
    print("done")