# -*- coding: utf-8 -*-

from datetime import datetime
from mongoengine import Document, ObjectIdField, StringField, DateTimeField, BooleanField
from bson import ObjectId
from flask_login import UserMixin
from flask.helpers import url_for


if __name__ == "__main__":
    pass


class Log(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    created_time = DateTimeField(default=datetime.utcnow)
    log_text = StringField(required=True)

    def __repr__(self):
        return "<Log created_time:{} log:{}>".format(self.created_time, self.log_text)


class User(UserMixin, Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True)
    password = StringField(required=True)
    email = StringField(required=True, unique=True)
    email_verified = BooleanField(default=False)
    user_type = StringField(default="new")
    phone = StringField(required=True)
    affiliation = StringField(required=True)
    language = StringField(default="en")

    is_authenticated = False
    is_anonymous = False
    is_active = True

    def __repr__(self):
        return "<User _id:{} name:{}>".format(self._id, self.name)

    def is_admin(self):
        if self.user_type is None:
            return False
        return "admin" in self.user_type

    def to_json(self):
        return {"name": self.name, "email": self.email}

    def is_authenticated(self):
        return self.is_authenticated

    def is_active(self):
        return True

    def get_id(self):
        return str(self.email)


if __name__ == "__main__":
    print("done")