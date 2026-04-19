# -*- coding: utf-8 -*-

from datetime import datetime
from mongoengine import Document, ObjectIdField, StringField, DictField, DateTimeField
from bson import ObjectId

class OnlineUser(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    session_id = StringField(required=True, unique=True)
    camera_position = DictField()
    camera_rotation = DictField()
    left_hand = DictField()   # wrist, thumbTip, indexTip, middleTip positions
    right_hand = DictField()  # same structure
    hand_tracking_enabled = DictField(default=dict)  # {enabled: bool, device: str}
    update_time = DateTimeField(default=datetime.utcnow)
    