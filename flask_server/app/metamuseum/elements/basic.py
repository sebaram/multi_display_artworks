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


class Room(db.Document):
    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = db.StringField(required=True, unique=True)
    description = db.StringField(required=True)

    created_time = db.DateTimeField(default=datetime.utcnow)
    updated_time = db.DateTimeField(default=datetime.utcnow)

    walls = db.ListField(db.ReferenceField("Wall"))

    def __repr__(self):
        return "<Room name:{}>".format(self.name)
    def __str__(self):
        return "<Room name:{}>".format(self.name)
    
    def get_absolute_url(self):
        return url_for('main.room', room_id=str(self._id))
    
    def to_aframe(self):
        aframe_str = ""
        for one_wall in self.walls:
            aframe_str += one_wall.to_aframe(single=False)

        return aframe_str
    



class Wall(db.Document):
    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)

    name = db.StringField(required=True, unique=True)
    description = db.StringField(required=True)
    
    created_time = db.DateTimeField(default=datetime.utcnow)
    updated_time = db.DateTimeField(default=datetime.utcnow)

    room = db.ReferenceField(Room, required=True)
    images = db.ListField(db.ReferenceField("Image"))
    splats = db.ListField(db.ReferenceField("GaussianSplat"))
    gltfs = db.ListField(db.ReferenceField("GLTFmodel"))

    
    position = db.StringField(required=True)
    rotation = db.StringField(required=True)

    # in meter
    width = db.FloatField(required=True)    
    height = db.FloatField(required=True)
    depth = db.FloatField(required=True)

    # fill type
    color = db.StringField()
    image_url = db.StringField()
    video_url = db.StringField()

    def __repr__(self):
        return "<Wall:{}>".format(self.name)
    def __str__(self):
        return "<Wall:{}>".format(self.name)

    
    def get_absolute_url(self):
        return url_for('main.wall', wall_id=str(self._id))
    
    def get_all_elements(self):
        return self.images + self.splats + self.gltfs
    
    def to_aframe(self, single=True):
        # maybe display as entity with plane and images
        if single:
            this_position = "0 0 0"
            this_rotation = "0 0 0"
        else:
            this_position = self.position
            this_rotation = self.rotation

        # plane for wall
        aframes = f"""<a-box color="{self.color}" position="0 0 0" rotation="0 0 0" width="{self.width}" height="{self.height}" depth="{self.depth}" material geometry></a-box>"""
        # images in wall
        for one_ele in self.get_all_elements():
            aframes += one_ele.to_aframe(single=False, wall_depth=self.depth)

        # group as entity for wall
        aframe_str = f"""<a-entity id="wall_{self.name}" position="{this_position}" rotation="{this_rotation}">{aframes}</a-entity>"""

        return aframe_str
    


# create base/abstract class for wall elements
class WallElement(db.Document):
    meta = {'abstract': True, 'allow_inheritance': True}
    # this will be the fist class, which does not have child classes
    _id = db.ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = db.StringField(required=True, unique=True)
    description = db.StringField(required=True)
    created_time = db.DateTimeField(default=datetime.utcnow)
    updated_time = db.DateTimeField(default=datetime.utcnow)

    wall = db.ReferenceField(Wall)
    wall_element_type = db.StringField(default="image")

    # anchor point is middle of the wall
    position = db.StringField(required=True)

    position_x = db.FloatField(required=True)
    position_y = db.FloatField(required=True)
    # position_z = db.FloatField(required=True)

    def __repr__(self):
        return "<WallElement:{}>".format(self.name)
    def __str__(self):
        return "<WallElement:{}>".format(self.name)

    def get_absolute_url(self):
        return url_for('main.wall_element', wall_element_id=str(self._id), type=self.wall_element_type)
    
class Image(WallElement):
    image_url = db.StringField(required=True)
    width = db.FloatField(required=True)
    height = db.FloatField(required=True)
    wall_element_type = db.StringField(default="image")

    def __repr__(self):
        return "<Image:{}>".format(self.name)
    def __str__(self):
        return "<Image:{}>".format(self.name)
    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 0.05"
        else:
            if wall_depth is None:
                wall_depth = 0.2
            this_position = f"""{self.position_x} {self.position_y} {0.05+wall_depth}"""
        aframe_str = f"""<a-image id="img_{self.name}" position="{this_position}" src="{self.image_url}" width="{self.width}" height="{self.height}" material geometry></a-image>"""
        return aframe_str
    
class GaussianSplat(WallElement):
    splat_url = db.StringField(required=True)
    scale = db.StringField(required=True)
    rotation = db.StringField(required=True)

    cutout_scale = db.StringField()
    cutout_position = db.StringField()

    wall_element_type = db.StringField(default="gaussian_splat")
    def __repr__(self):
        return "<GaussianSplat:{}>".format(self.name)
    def __str__(self):
        return "<GaussianSplat:{}>".format(self.name)
    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 -1"
            this_rotation = "0 0 0"
        else:
            if wall_depth is None:
                wall_depth = 0.3
            this_position = f"""{self.position_x} {self.position_y} {0.05+wall_depth}"""
            this_rotation = self.rotation
        
 
        # visible="false"
        aframes = ""
        if self.cutout_scale is not None:
            aframes += f"""<a-box id="cutout-box-{self.name}" visible="false" scale="{self.cutout_scale}" position="{self.cutout_position}"></a-box>"""
            aframes += f"""<a-entity gaussian_splatting="src: {self.splat_url}; cutoutEntity: #cutout-box-{self.name};"></a-entity>"""
        else:
            aframes += f"""<a-entity gaussian_splatting="src: {self.splat_url};"></a-entity>"""
        
        aframe_str = f"""<a-entity if="splat-{self.name}" position="{this_position}" rotation="{this_rotation}"  scale="{self.scale}">{aframes}</a-entity>"""

        return aframe_str

class GLTFmodel(WallElement):
    gltf_url = db.StringField(required=True)
    scale = db.StringField(required=True)
    default_rotation = db.StringField(required=True)
    rotation = db.StringField(required=True)

    wall_element_type = db.StringField(default="gltf")
    position_z = db.FloatField(required=True)

    def __repr__(self):
        return "<GLTF:{}>".format(self.name)
    def __str__(self):
        return "<GLTF:{}>".format(self.name)
    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 -1"
            this_rotation = "0 0 0"
        else:
            if wall_depth is None:
                wall_depth = 0.3
            this_position = f"""{self.position_x} {self.position_y} {self.position_z+wall_depth}"""
            this_rotation = self.rotation
        
 
        # visible="false"
        aframes = f"""<a-entity rotation="{self.default_rotation}" gltf-model="url({self.gltf_url})"></a-entity>"""
        

        aframe_str = f"""<a-entity id="gltf-{self.name}" position="{this_position}" rotation="{this_rotation}"  scale="{self.scale}">{aframes}</a-entity>"""

        return aframe_str
    
if __name__ == "__main__":
    # test_room = Room.objects().first()
    # test_wall = Wall(position="0 0 -4", rotation="-90 0 0", width=4, height=4, room=test_room)
    # test_wall.save()

    # <a-entity gaussian_splatting="src: https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/luma-seal.splat; cutoutEntity: #cutout-box" scale="1 1 1" rotation="0 0 0" position="-1 0.3 3"></a-entity>
    new_splat = GaussianSplat(name="test_splat", description="luma-seal", splat_url="https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/luma-seal.splat", scale="1 1 1", rotation="0 0 0", position="-1 0.3 3", position_x=0, position_y=0)
    new_splat.save()

    print("done")