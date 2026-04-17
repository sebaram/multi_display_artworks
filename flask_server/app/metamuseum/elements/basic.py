# -*- coding: utf-8 -*-

from datetime import datetime
from random import randint
from mongoengine import Document, ObjectIdField, StringField, DateTimeField, ReferenceField, ListField, FloatField, DictField
from bson import ObjectId
from flask.helpers import url_for


if __name__ == "__main__":
    pass


class Room(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    walls = ListField(ReferenceField("Wall"))

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


class Wall(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    room = ReferenceField(Room, required=True)
    images = ListField(ReferenceField("Image"))
    splats = ListField(ReferenceField("GaussianSplat"))
    gltfs = ListField(ReferenceField("GLTFmodel"))
    position = StringField(required=True)
    rotation = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    depth = FloatField(required=True)
    color = StringField()
    image_url = StringField()
    video_url = StringField()

    def __repr__(self):
        return "<Wall:{}>".format(self.name)
    def __str__(self):
        return "<Wall:{}>".format(self.name)

    def get_absolute_url(self):
        return url_for('main.wall', wall_id=str(self._id))
    
    def get_all_elements(self):
        return self.images + self.splats + self.gltfs
    
    def to_aframe(self, single=True):
        if single:
            this_position = "0 0 0"
            this_rotation = "0 0 0"
        else:
            this_position = self.position
            this_rotation = self.rotation

        aframes = f"""<a-box color="{self.color}" position="0 0 0" rotation="0 0 0" width="{self.width}" height="{self.height}" depth="{self.depth}" material geometry></a-box>"""
        for one_ele in self.get_all_elements():
            aframes += one_ele.to_aframe(single=False, wall_depth=self.depth)

        aframe_str = f"""<a-entity id="wall_{self.name}" position="{this_position}" rotation="{this_rotation}">{aframes}</a-entity>"""
        return aframe_str


class WallElement(Document):
    meta = {'abstract': True, 'allow_inheritance': True}
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    wall = ReferenceField(Wall)
    wall_element_type = StringField(default="image")
    position = StringField(required=True)
    position_x = FloatField(required=True)
    position_y = FloatField(required=True)

    def __repr__(self):
        return "<WallElement:{}>".format(self.name)
    def __str__(self):
        return "<WallElement:{}>".format(self.name)

    def get_absolute_url(self):
        return url_for('main.wall_element', wall_element_id=str(self._id), type=self.wall_element_type)


class Image(WallElement):
    image_url = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    wall_element_type = StringField(default="image")

    def __repr__(self):
        return "<Image:{}>".format(self.name)
    def __str__(self):
        return "<Image:{}>".format(self.name)

    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 0.05"
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.2
            this_position = f"""{self.position_x} {self.position_y} {0.05+wall_depth}"""
        return f"""<a-image id="img_{self.name}" position="{this_position}" src="{self.image_url}" width="{self.width}" height="{self.height}" material geometry></a-image>"""


class GaussianSplat(WallElement):
    splat_url = StringField(required=True)
    scale = StringField(required=True)
    rotation = StringField(required=True)
    cutout_scale = StringField()
    cutout_position = StringField()
    wall_element_type = StringField(default="gaussian_splat")

    def __repr__(self):
        return "<GaussianSplat:{}>".format(self.name)
    def __str__(self):
        return "<GaussianSplat:{}>".format(self.name)

    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 -1"
            this_rotation = "0 0 0"
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.3
            this_position = f"""{self.position_x} {self.position_y} {0.05+wall_depth}"""
            this_rotation = self.rotation
        
        aframes = ""
        if self.cutout_scale is not None:
            aframes += f"""<a-box id="cutout-box-{self.name}" visible="false" scale="{self.cutout_scale}" position="{self.cutout_position}"></a-box>"""
            aframes += f"""<a-entity gaussian_splatting="src: {self.splat_url}; cutoutEntity: #cutout-box-{self.name};"></a-entity>"""
        else:
            aframes += f"""<a-entity gaussian_splatting="src: {self.splat_url};"></a-entity>"""
        
        return f"""<a-entity if="splat-{self.name}" position="{this_position}" rotation="{this_rotation}" scale="{self.scale}">{aframes}</a-entity>"""


class GLTFmodel(WallElement):
    gltf_url = StringField(required=True)
    scale = StringField(required=True)
    default_rotation = StringField(required=True)
    rotation = StringField(required=True)
    wall_element_type = StringField(default="gltf")
    position_z = FloatField(required=True)

    def __repr__(self):
        return "<GLTF:{}>".format(self.name)
    def __str__(self):
        return "<GLTF:{}>".format(self.name)

    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 -1"
            this_rotation = "0 0 0"
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.3
            this_position = f"""{self.position_x} {self.position_y} {self.position_z+wall_depth}"""
            this_rotation = self.rotation
        
        aframes = f"""<a-entity rotation="{self.default_rotation}" gltf-model="url({self.gltf_url})"></a-entity>"""
        return f"""<a-entity id="gltf-{self.name}" position="{this_position}" rotation="{this_rotation}" scale="{self.scale}">{aframes}</a-entity>"""


if __name__ == "__main__":
    new_splat = GaussianSplat(name="test_splat", description="luma-seal", splat_url="https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/luma-seal.splat", scale="1 1 1", rotation="0 0 0", position="-1 0.3 3", position_x=0, position_y=0)
    new_splat.save()
    print("done")