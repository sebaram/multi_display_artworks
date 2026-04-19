# -*- coding: utf-8 -*-

from datetime import datetime
from random import randint
from mongoengine import Document, ObjectIdField, StringField, DateTimeField, ReferenceField, ListField, FloatField, DictField, BooleanField
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
    # Boundary limits for position lock
    boundary_min_x = FloatField(default=-10.0)
    boundary_max_x = FloatField(default=10.0)
    boundary_min_y = FloatField(default=0.0)
    boundary_max_y = FloatField(default=5.0)
    boundary_min_z = FloatField(default=-10.0)
    boundary_max_z = FloatField(default=10.0)

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
    webpages = ListField(ReferenceField("Webpage"))
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
        return self.images + self.splats + self.gltfs + self.webpages
    
    def to_aframe(self, single=True):
        if single:
            this_position = "0 0 0"
            this_rotation = "0 0 0"
        else:
            this_position = self.position
            this_rotation = self.rotation

        if self.video_url:
            aframes = '<a-video src="{}" width="{}" height="{}" position="0 0 {}"></a-video>'.format(
                self.video_url, self.width, self.height, self.depth / 2 + 0.01)
        else:
            aframes = '<a-box color="{}" position="0 0 0" rotation="0 0 0" width="{}" height="{}" depth="{}" material geometry></a-box>'.format(
                self.color or '#333333', self.width, self.height, self.depth)

        for one_ele in self.get_all_elements():
            aframes += one_ele.to_aframe(single=False, wall_depth=self.depth)

        aframe_str = '<a-entity id="wall_{}" position="{}" rotation="{}">{}</a-entity>'.format(
            self.name, this_position, this_rotation, aframes)
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
    # Transform controls (scale & rotate)
    scale_x = FloatField(default=1.0)
    scale_y = FloatField(default=1.0)
    scale_z = FloatField(default=1.0)
    rotation_x = FloatField(default=0.0)
    rotation_y = FloatField(default=0.0)
    rotation_z = FloatField(default=0.0)

    def __repr__(self):
        return "<WallElement:{}>".format(self.name)
    def __str__(self):
        return "<WallElement:{}>".format(self.name)

    def get_absolute_url(self):
        return url_for('main.wall_element', wall_element_id=str(self._id), type=self.wall_element_type)

    def _get_scale_str(self):
        return "{} {} {}".format(self.scale_x, self.scale_y, self.scale_z)

    def _get_rotation_str(self):
        return "{} {} {}".format(self.rotation_x, self.rotation_y, self.rotation_z)


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
            this_position = "{} {} {}".format(self.position_x, self.position_y, 0.05 + wall_depth)
        scale_str = self._get_scale_str()
        rot_str = self._get_rotation_str()
        return '<a-image id="img_{}" data-element-id="{}" data-element-type="image" position="{}" scale="{}" rotation="{}" src="{}" width="{}" height="{}" material geometry></a-image>'.format(
            self.name, self._id, this_position, scale_str, rot_str, self.image_url, self.width, self.height)


class GaussianSplat(WallElement):
    splat_url = StringField(required=True)
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
            this_rotation = self._get_rotation_str()
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.3
            this_position = "{} {} {}".format(self.position_x, self.position_y, 0.05 + wall_depth)
            this_rotation = self._get_rotation_str()
        
        aframes = ''
        if self.cutout_scale is not None:
            aframes += '<a-box id="cutout-box-{}" visible="false" scale="{}" position="{}"></a-box>'.format(
                self.name, self.cutout_scale, self.cutout_position)
            aframes += '<a-entity gaussian_splatting="src: {}; cutoutEntity: #cutout-box-{};"></a-entity>'.format(
                self.splat_url, self.name)
        else:
            aframes += '<a-entity gaussian_splatting="src: {};"></a-entity>'.format(self.splat_url)
        
        return '<a-entity id="splat-{}" data-element-id="{}" data-element-type="gaussian_splat" position="{}" scale="{}" rotation="{}">{}</a-entity>'.format(
            self.name, self._id, this_position, self._get_scale_str(), this_rotation, aframes)


class LocationPreset(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True)
    description = StringField()
    room = ReferenceField(Room, required=True)
    position_x = FloatField(required=True)
    position_y = FloatField(required=True)
    position_z = FloatField(required=True)
    rotation_x = FloatField(default=0.0)
    rotation_y = FloatField(default=0.0)
    rotation_z = FloatField(default=0.0)
    is_default = BooleanField(default=False)
    created_time = DateTimeField(default=datetime.utcnow)

    def __repr__(self):
        return "<LocationPreset:{}>".format(self.name)
    def __str__(self):
        return "<LocationPreset:{}>".format(self.name)

    def to_dict(self):
        return {
            'id': str(self._id),
            'name': self.name,
            'description': self.description or '',
            'position': '{} {} {}'.format(self.position_x, self.position_y, self.position_z),
            'rotation': '{} {} {}'.format(self.rotation_x, self.rotation_y, self.rotation_z),
            'is_default': self.is_default
        }


class Webpage(WallElement):
    webpage_url = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    wall_element_type = StringField(default="webpage")

    def __repr__(self):
        return "<Webpage:{}>".format(self.name)
    def __str__(self):
        return "<Webpage:{}>".format(self.name)

    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 0.05"
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.2
            this_position = "{} {} {}".format(self.position_x, self.position_y, 0.05 + wall_depth)
        scale_str = self._get_scale_str()
        rot_str = self._get_rotation_str()
        aspect = self.width / self.height
        html_content = '<div style="width:{}px;height:{}px;"><iframe src="{}" style="width:100%;height:100%;border:none;"></iframe></div>'.format(
            int(self.width * 100), int(self.height * 100), self.webpage_url)
        return '<a-entity id="webpage_{}" data-element-id="{}" data-element-type="webpage" position="{}" scale="{}" rotation="{}" html="html: #webpage-content-{}; aspect: {}"></a-entity><div id="webpage-content-{}" style="display:none;">{}</div>'.format(
            self.name, self._id, this_position, scale_str, rot_str, self.name, aspect, self.name, html_content)


class GLTFmodel(WallElement):
    gltf_url = StringField(required=True)
    default_rotation = StringField(required=True)
    wall_element_type = StringField(default="gltf")
    position_z = FloatField(required=True)

    def __repr__(self):
        return "<GLTF:{}>".format(self.name)
    def __str__(self):
        return "<GLTF:{}>".format(self.name)

    def to_aframe(self, single=True, wall_depth=None):
        if single:
            this_position = "0 0 -1"
        else:
            wall_depth = wall_depth if wall_depth is not None else 0.3
            this_position = "{} {} {}".format(self.position_x, self.position_y, self.position_z + wall_depth)
        
        aframes = '<a-entity rotation="{}" gltf-model="url({})"></a-entity>'.format(self.default_rotation, self.gltf_url)
        return '<a-entity id="gltf-{}" data-element-id="{}" data-element-type="gltf" position="{}" scale="{}" rotation="{}">{}</a-entity>'.format(
            self.name, self._id, this_position, self._get_scale_str(), self._get_rotation_str(), aframes)


class Marker(Document):
    """Physical marker → virtual position mapping for AR mode."""
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True)
    description = StringField()
    room = ReferenceField(Room, required=True)
    marker_type = StringField(required=True, choices=['hiro', 'pattern', 'image'], default='hiro')
    marker_value = StringField(required=True, default='hiro')  # 'hiro' or pattern URL or image URL
    target_position_x = FloatField(required=True, default=0.0)
    target_position_y = FloatField(required=True, default=1.6)
    target_position_z = FloatField(required=True, default=0.0)
    target_rotation_x = FloatField(default=0.0)
    target_rotation_y = FloatField(default=0.0)
    target_rotation_z = FloatField(default=0.0)
    target_preset = ReferenceField(LocationPreset, default=None)
    offset_x = FloatField(default=0.0)
    offset_y = FloatField(default=0.0)
    offset_z = FloatField(default=0.0)
    is_active = BooleanField(default=True)
    created_time = DateTimeField(default=datetime.utcnow)

    def __repr__(self):
        return "<Marker:{}>".format(self.name)
    def __str__(self):
        return "<Marker:{}>".format(self.name)

    def to_dict(self):
        d = {
            'id': str(self._id),
            'name': self.name,
            'marker_type': self.marker_type,
            'marker_value': self.marker_value,
            'target_position': '{} {} {}'.format(
                self.target_position_x, self.target_position_y, self.target_position_z),
            'target_rotation': '{} {} {}'.format(
                self.target_rotation_x, self.target_rotation_y, self.target_rotation_z),
            'offset': '{} {} {}'.format(self.offset_x, self.offset_y, self.offset_z),
            'is_active': self.is_active
        }
        if self.target_preset:
            d['preset_name'] = self.target_preset.name
        return d


class RoomEffect(Document):
    """LLM-triggered visual/audio effects for a room."""
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    room = ReferenceField(Room, required=True)
    effect_type = StringField(required=True)  # glitter | spotlight | ambient | fog | sound | pulse
    target_id = StringField()  # element _id to affect (optional)
    params = DictField()  # effect-specific parameters as dict
    description = StringField()  # human-readable description
    created_by = StringField()  # who triggered this effect
    created_time = DateTimeField(default=datetime.utcnow)
    expires_at = DateTimeField()  # auto-expire (optional)
    active = BooleanField(default=True)

    EFFECT_TYPES = ['glitter', 'spotlight', 'ambient', 'fog', 'sound', 'pulse', 'color_shift', 'shake', 'fade']

    def __repr__(self):
        return "<RoomEffect:{} {}>" .format(self.effect_type, self.description)
    def __str__(self):
        return "<RoomEffect:{} {}>" .format(self.effect_type, self.description)

    def to_dict(self):
        return {
            'id': str(self._id),
            'effect_type': self.effect_type,
            'target_id': self.target_id or '',
            'params': self.params or {},
            'description': self.description or '',
            'active': self.active
        }

    @classmethod
    def get_active_for_room(cls, room_id):
        return cls.objects(room=ObjectId(room_id), active=True)

    @classmethod
    def clear_room(cls, room_id):
        cls.objects(room=ObjectId(room_id), active=True).update(set__active=False)


if __name__ == "__main__":
    new_splat = GaussianSplat(name="test_splat", description="luma-seal", splat_url="https://huggingface.co/quadjr/aframe-gaussian-splatting/resolve/main/luma-seal.splat", scale_x=1, scale_y=1, scale_z=1, rotation_x=0, rotation_y=0, rotation_z=0, position="-1 0.3 3", position_x=0, position_y=0)
    new_splat.save()
    print("done")