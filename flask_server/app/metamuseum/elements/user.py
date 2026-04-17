# -*- coding: utf-8 -*-

from flask import Flask, flash
from flask_login import UserMixin
from flask.helpers import url_for

from mongoengine import Document
from mongoengine import DateTimeField, StringField, ReferenceField, ListField, EmbeddedDocumentField
from bson.objectid import ObjectId



from datetime import datetime
from mongoengine import Document, ObjectIdField, StringField, DictField, DateTimeField
from bson import ObjectId
from flask.helpers import url_for


if __name__ == "__main__":
    pass  # standalone mode not needed

class OnlineUser(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    session_id = StringField(required=True, unique=True)
    camera_position = DictField()
    camera_rotation = DictField()
    update_time = DateTimeField(default=datetime.utcnow)
    