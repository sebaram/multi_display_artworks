"""Legacy MongoEngine persistence schema, without Flask or rendering dependencies."""
from datetime import datetime
from bson import ObjectId
from mongoengine import (Document, ObjectIdField, StringField, BooleanField, IntField, FloatField,
                         ListField, DateTimeField, ReferenceField, DictField)

class User(Document):
    """Application user with email-based authentication."""
    email = StringField(required=True, unique=True)
    name = StringField(required=True)
    password = StringField(required=True)
    phone = StringField()
    affiliation = StringField()
    user_type = ListField(StringField(), default=list)
    email_verified = BooleanField(default=False)
    meta = {'collection': 'users', 'allow_inheritance': False}

    def get_id(self):
        return self.email

    def is_admin(self):
        return 'admin' in (self.user_type or [])

    def __repr__(self):
        return '<User:{}>'.format(self.email)

    def __str__(self):
        return '<User:{}>'.format(self.email)


class LLMConfig(Document):
    """LLM provider configuration — supports MiniMax, OpenAI, OpenRouter, etc."""
    provider = StringField(required=True, choices=['minimax', 'openai', 'openrouter', 'anthropic'])
    api_base = StringField(required=True)
    api_key = StringField(required=True)
    model = StringField(required=True)
    temperature = FloatField(default=0.3)
    max_tokens = IntField(default=1024)
    is_active = BooleanField(default=True)
    updated_at = StringField(default=lambda: datetime.utcnow().isoformat())
    meta = {'collection': 'llm_configs', 'allow_inheritance': False}

    def save(self, *args, **kwargs):
        self.updated_at = datetime.utcnow().isoformat()
        return super().save(*args, **kwargs)

    def to_dict(self):
        return {'provider': self.provider, 'api_base': self.api_base, 'model': self.model, 'temperature': self.temperature, 'max_tokens': self.max_tokens, 'is_active': self.is_active}

    @classmethod
    def get_active(cls):
        """Return the active LLM config, or None."""
        return cls.objects(is_active=True).first()

    @classmethod
    def set_active(cls, provider, api_base, api_key, model, temperature=0.3, max_tokens=1024):
        """Set or create the active config."""
        cls.objects.update(set__is_active=False)
        config = cls(provider=provider, api_base=api_base, api_key=api_key, model=model, temperature=temperature, max_tokens=max_tokens, is_active=True)
        config.save()
        return config


class WhisperConfig(Document):
    """Whisper API configuration for voice transcription."""
    provider = StringField(required=True, choices=['openai', 'minimax', 'local'])
    api_base = StringField(required=True)
    api_key = StringField(required=True)
    model = StringField(default='whisper-1')
    language = StringField(default='')
    enabled = BooleanField(default=False)
    updated_at = StringField(default=lambda: datetime.utcnow().isoformat())
    meta = {'collection': 'whisper_configs', 'allow_inheritance': False}

    def save(self, *args, **kwargs):
        self.updated_at = datetime.utcnow().isoformat()
        return super().save(*args, **kwargs)

    @classmethod
    def get_active(cls):
        return cls.objects.first()

    @classmethod
    def set_config(cls, provider, api_base, api_key, model='whisper-1', language='', enabled=False):
        existing = cls.objects.first()
        if existing:
            existing.provider = provider
            existing.api_base = api_base
            existing.api_key = api_key
            existing.model = model
            existing.language = language
            existing.enabled = enabled
            existing.save()
        else:
            existing = cls(provider=provider, api_base=api_base, api_key=api_key, model=model, language=language, enabled=enabled)
            existing.save()
        return existing


class Room(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    walls = ListField(ReferenceField('Wall'))
    boundary_min_x = FloatField(default=-10.0)
    boundary_max_x = FloatField(default=10.0)
    boundary_min_y = FloatField(default=0.0)
    boundary_max_y = FloatField(default=5.0)
    boundary_min_z = FloatField(default=-10.0)
    boundary_max_z = FloatField(default=10.0)

    def __repr__(self):
        return '<Room name:{}>'.format(self.name)

    def __str__(self):
        return '<Room name:{}>'.format(self.name)


class Wall(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    room = ReferenceField(Room, required=True)
    images = ListField(ReferenceField('Image'))
    splats = ListField(ReferenceField('GaussianSplat'))
    gltfs = ListField(ReferenceField('GLTFmodel'))
    webpages = ListField(ReferenceField('Webpage'))
    position = StringField(required=True)
    rotation = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    depth = FloatField(required=True)
    color = StringField()
    image_url = StringField()
    video_url = StringField()
    surface_type = StringField(default='wall')

    def __repr__(self):
        return '<Wall:{}>'.format(self.name)

    def __str__(self):
        return '<Wall:{}>'.format(self.name)

    def get_all_elements(self):
        return self.images + self.splats + self.gltfs + self.webpages

    def clean(self):
        """Auto-assign surface_type from wall name for consistency."""
        name_lower = self.name.lower()
        if 'floor' in name_lower:
            self.surface_type = 'floor'
        elif 'ceiling' in name_lower:
            self.surface_type = 'ceiling'
        else:
            self.surface_type = 'wall'

    def save(self, *args, **kwargs):
        self.clean()
        return super().save(*args, **kwargs)


class WallElement(Document):
    meta = {'abstract': True, 'allow_inheritance': True}
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True, unique=True)
    description = StringField(required=True)
    created_time = DateTimeField(default=datetime.utcnow)
    updated_time = DateTimeField(default=datetime.utcnow)
    wall = ReferenceField(Wall)
    wall_element_type = StringField(default='image')
    position = StringField(required=True)
    position_x = FloatField(required=True)
    position_y = FloatField(required=True)
    scale_x = FloatField(default=1.0)
    scale_y = FloatField(default=1.0)
    scale_z = FloatField(default=1.0)
    rotation_x = FloatField(default=0.0)
    rotation_y = FloatField(default=0.0)
    rotation_z = FloatField(default=0.0)

    def __repr__(self):
        return '<WallElement:{}>'.format(self.name)

    def __str__(self):
        return '<WallElement:{}>'.format(self.name)

    def clean(self):
        """Validate and auto-fix element position to stay within wall bounds.

        Wall coordinate system: origin at wall center.
        - x: horizontal (-width/2 to +width/2)
        - y: vertical (-height/2 to +height/2)
        - z: depth (0 = on surface, positive = in front)
        """
        if not self.wall:
            return
        try:
            wall = self.wall.fetch()
        except Exception:
            return
        hw = wall.width / 2.0
        hh = wall.height / 2.0
        self.position_x = max(-hw, min(hw, self.position_x))
        self.position_y = max(-hh, min(hh, self.position_y))
        if wall.surface_type in ('floor', 'ceiling'):
            self.position_z = 0.0
        else:
            self.position_z = max(0.0, min(0.5, self.position_z))

    def save(self, *args, **kwargs):
        self.clean()
        return super().save(*args, **kwargs)


class Image(WallElement):
    image_url = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    wall_element_type = StringField(default='image')

    def __repr__(self):
        return '<Image:{}>'.format(self.name)

    def __str__(self):
        return '<Image:{}>'.format(self.name)


class GaussianSplat(WallElement):
    splat_url = StringField(required=True)
    cutout_scale = StringField()
    cutout_position = StringField()
    wall_element_type = StringField(default='gaussian_splat')

    def __repr__(self):
        return '<GaussianSplat:{}>'.format(self.name)

    def __str__(self):
        return '<GaussianSplat:{}>'.format(self.name)


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
        return '<LocationPreset:{}>'.format(self.name)

    def __str__(self):
        return '<LocationPreset:{}>'.format(self.name)

    def to_dict(self):
        return {'id': str(self._id), 'name': self.name, 'description': self.description or '', 'position': '{} {} {}'.format(self.position_x, self.position_y, self.position_z), 'rotation': '{} {} {}'.format(self.rotation_x, self.rotation_y, self.rotation_z), 'is_default': self.is_default}


class Webpage(WallElement):
    webpage_url = StringField(required=True)
    width = FloatField(required=True)
    height = FloatField(required=True)
    wall_element_type = StringField(default='webpage')

    def __repr__(self):
        return '<Webpage:{}>'.format(self.name)

    def __str__(self):
        return '<Webpage:{}>'.format(self.name)


class GLTFmodel(WallElement):
    gltf_url = StringField(required=True)
    default_rotation = StringField(required=True)
    wall_element_type = StringField(default='gltf')
    position_z = FloatField(required=True)

    def __repr__(self):
        return '<GLTF:{}>'.format(self.name)

    def __str__(self):
        return '<GLTF:{}>'.format(self.name)


class Marker(Document):
    """Physical marker → virtual position mapping for AR mode."""
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    name = StringField(required=True)
    description = StringField()
    room = ReferenceField(Room, required=True)
    marker_type = StringField(required=True, choices=['hiro', 'pattern', 'image'], default='hiro')
    marker_value = StringField(required=True, default='hiro')
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
        return '<Marker:{}>'.format(self.name)

    def __str__(self):
        return '<Marker:{}>'.format(self.name)

    def to_dict(self):
        d = {'id': str(self._id), 'name': self.name, 'marker_type': self.marker_type, 'marker_value': self.marker_value, 'target_position': '{} {} {}'.format(self.target_position_x, self.target_position_y, self.target_position_z), 'target_rotation': '{} {} {}'.format(self.target_rotation_x, self.target_rotation_y, self.target_rotation_z), 'offset': '{} {} {}'.format(self.offset_x, self.offset_y, self.offset_z), 'is_active': self.is_active}
        if self.target_preset:
            d['preset_name'] = self.target_preset.name
        return d


class RoomEffect(Document):
    """LLM-triggered visual/audio effects for a room."""
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    room = ReferenceField(Room, required=True)
    effect_type = StringField(required=True)
    target_id = StringField()
    params = DictField()
    description = StringField()
    created_by = StringField()
    created_time = DateTimeField(default=datetime.utcnow)
    expires_at = DateTimeField()
    active = BooleanField(default=True)
    EFFECT_TYPES = ['glitter', 'spotlight', 'ambient', 'fog', 'sound', 'pulse', 'color_shift', 'shake', 'fade']

    def __repr__(self):
        return '<RoomEffect:{} {}>'.format(self.effect_type, self.description)

    def __str__(self):
        return '<RoomEffect:{} {}>'.format(self.effect_type, self.description)

    def to_dict(self):
        return {'id': str(self._id), 'effect_type': self.effect_type, 'target_id': self.target_id or '', 'params': self.params or {}, 'description': self.description or '', 'active': self.active}

    @classmethod
    def get_active_for_room(cls, room_id):
        return cls.objects(room=ObjectId(room_id), active=True)

    @classmethod
    def clear_room(cls, room_id):
        cls.objects(room=ObjectId(room_id), active=True).update(set__active=False)


class OnlineUser(Document):
    _id = ObjectIdField(required=True, default=ObjectId, primary_key=True)
    session_id = StringField(required=True, unique=True)
    camera_position = DictField()
    camera_rotation = DictField()
    left_hand = DictField()
    right_hand = DictField()
    hand_tracking_enabled = DictField(default=dict)
    update_time = DateTimeField(default=datetime.utcnow)
