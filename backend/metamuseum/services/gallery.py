"""Allowlisted gallery persistence and safe, flat API documents."""
import math
from datetime import datetime

from bson import ObjectId
from fastapi import HTTPException
from mongoengine import (BooleanField, DateTimeField, DictField, FloatField, IntField,
                         ListField, NotUniqueError, ReferenceField, StringField, ValidationError)
from pydantic import ConfigDict, ValidationError as DTOValidationError, create_model

from .. import models as m

RESOURCES = {
    'rooms': m.Room, 'walls': m.Wall, 'images': m.Image, 'splats': m.GaussianSplat,
    'gltfs': m.GLTFmodel, 'webpages': m.Webpage, 'locations': m.LocationPreset,
    'effects': m.RoomEffect, 'markers': m.Marker, 'llm-configs': m.LLMConfig,
    'whisper-configs': m.WhisperConfig,
}
ELEMENTS = {'image': 'images', 'gaussian_splat': 'splats', 'gltf': 'gltfs', 'webpage': 'webpages'}
READONLY = {'id', '_id', '_cls', 'created_time', 'updated_time', 'updated_at',
            'walls', 'images', 'splats', 'gltfs', 'webpages', 'wall_element_type', 'surface_type'}
MODEL_SLUG = {model: slug for slug, model in RESOURCES.items()}


def object_id(value):
    if not isinstance(value, str) or not ObjectId.is_valid(value):
        raise HTTPException(400, 'invalid_object_id')
    return ObjectId(value)


def model_for(resource):
    if resource not in RESOURCES:
        raise HTTPException(404, 'unknown_resource')
    return RESOURCES[resource]


def get(resource, identifier):
    document = model_for(resource).objects(pk=object_id(identifier)).first()
    if document is None:
        raise HTTPException(404, 'document_not_found')
    return document


def scalar(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [scalar(item) for item in value]
    if isinstance(value, dict):
        return {key: scalar(item) for key, item in value.items() if key not in {'password', 'api_key'}}
    return value


def dto(document):
    result = scalar(document.to_mongo().to_dict())
    result['id'] = result.pop('_id')
    result.pop('_cls', None)
    if 'api_key' in document._fields:
        result['has_api_key'] = bool(document.api_key)
    return result


def field_type(field):
    if isinstance(field, ReferenceField):
        return 'reference'
    if isinstance(field, ListField) and isinstance(field.field, ReferenceField):
        return 'reference-list'
    if isinstance(field, BooleanField):
        return 'boolean'
    if isinstance(field, (IntField, FloatField)):
        return 'number'
    if isinstance(field, DateTimeField):
        return 'datetime'
    if isinstance(field, (DictField, ListField)):
        return 'json'
    return 'string'


def schema():
    result = []
    for slug, model in RESOURCES.items():
        fields = []
        for name, field in model._fields.items():
            if name == '_cls':
                continue
            name_out = 'id' if field.primary_key else name
            kind = field_type(field)
            spec = dict(name=name_out, label=name_out.replace('_', ' ').title(), type=kind,
                        required=bool(field.required), readonly=name in READONLY or field.primary_key)
            if name == 'description':
                spec['type'] = 'text'
            if name == 'api_key':
                spec.update(type='password', secret=True)
            elif field.default is not None and not callable(field.default):
                spec['default'] = scalar(field.default)
            if field.choices:
                spec['choices'] = list(field.choices)
            if slug == 'effects' and name == 'effect_type':
                spec['choices'] = m.RoomEffect.EFFECT_TYPES
            ref = field.field if kind == 'reference-list' else field
            if isinstance(ref, ReferenceField):
                spec['reference'] = MODEL_SLUG[ref.document_type]
            fields.append(spec)
        result.append(dict(name=slug, label=model.__name__, fields=fields))
    return {'resources': result}


def safe_json(value):
    if isinstance(value, dict):
        if any(not isinstance(k, str) or k.startswith('$') or '.' in k for k in value):
            raise HTTPException(422, 'invalid_json_key')
        for item in value.values():
            safe_json(item)
    elif isinstance(value, list):
        for item in value:
            safe_json(item)
    elif isinstance(value, float) and not math.isfinite(value):
        raise HTTPException(422, 'finite_number_required')


def payload_model(resource):
    fields = {}
    for name, field in model_for(resource)._fields.items():
        if name in READONLY or field.primary_key:
            continue
        annotation = { 'number': float if isinstance(field, FloatField) else int,
                       'boolean': bool, 'json': dict if isinstance(field, DictField) else list,
                       'datetime': str }.get(field_type(field), str)
        fields[name] = (annotation | None, None)
    return create_model(resource.replace('-', '_') + '_Write', __config__=ConfigDict(extra='forbid', strict=True), **fields)


WRITE_MODELS = {slug: payload_model(slug) for slug in RESOURCES}


def validate_payload(resource, data):
    safe_json(data)
    model_for(resource)
    try:
        return WRITE_MODELS[resource].model_validate(data).model_dump(exclude_unset=True)
    except DTOValidationError as error:
        raise HTTPException(422, {'message':'invalid_fields',
                                 'fields':[str(e['loc'][0]) for e in error.errors()]}) from None


def validate_geometry(document):
    for name in document._fields:
        value = getattr(document, name)
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            if not math.isfinite(value) or abs(value) > 1_000_000:
                raise HTTPException(422, 'finite_bounded_number_required')
            if name.startswith('scale_') or name in {'width', 'height', 'depth'}:
                if value <= 0:
                    raise HTTPException(422, 'positive_dimension_required')
        if name in {'position', 'rotation', 'default_rotation', 'cutout_scale', 'cutout_position'} and value:
            try:
                parts = [float(p) for p in value.split()]
                valid = len(parts) == 3 and all(math.isfinite(p) and abs(p) <= 1_000_000 for p in parts)
                if name == 'cutout_scale':
                    valid = valid and all(p > 0 for p in parts)
            except (ValueError, AttributeError):
                valid = False
            if not valid:
                raise HTTPException(422, 'invalid_vector')
    if isinstance(document, m.Room):
        for axis in 'xyz':
            if getattr(document, 'boundary_min_' + axis) >= getattr(document, 'boundary_max_' + axis):
                raise HTTPException(422, 'invalid_boundary')
    if isinstance(document, m.RoomEffect) and document.effect_type not in m.RoomEffect.EFFECT_TYPES:
        raise HTTPException(422, 'invalid_effect_type')
    if isinstance(document, m.Marker) and document.target_preset and document.target_preset.room.pk != document.room.pk:
        raise HTTPException(422, 'preset_room_mismatch')
    if isinstance(document, m.WallElement) and document.wall:
        wall = document.wall
        if abs(document.position_x or 0) > wall.width / 2 or abs(document.position_y or 0) > wall.height / 2:
            raise HTTPException(422, 'element_outside_wall_bounds')


def parent_link(document):
    if isinstance(document, m.Wall):
        return document.room, 'walls'
    if isinstance(document, m.WallElement) and document.wall:
        return document.wall, ELEMENTS[document.wall_element_type]
    return None, None


def touch(document):
    if document is not None and 'updated_time' in document._fields:
        document.update(set__updated_time=datetime.utcnow())


def save(resource, data, identifier=None):
    values = validate_payload(resource, data)
    document = get(resource, identifier) if identifier else model_for(resource)()
    previous_parent, previous_field = parent_link(document) if identifier else (None, None)
    for name, value in values.items():
        field = document._fields[name]
        if value is None and (field.required or isinstance(field, (IntField, FloatField))):
            raise HTTPException(422, {'message':'value_required', 'field':name})
        if isinstance(field, ReferenceField) and value is not None:
            value = get(MODEL_SLUG[field.document_type], value)
        if isinstance(field, DateTimeField) and value is not None:
            try:
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            except ValueError:
                raise HTTPException(422, {'message':'invalid_datetime', 'field':name}) from None
        if name == 'api_key' and value == '' and identifier:
            continue
        setattr(document, name, value)
    if 'updated_time' in document._fields:
        document.updated_time = datetime.utcnow()
    try:
        document.validate(clean=False)
        validate_geometry(document)
        if isinstance(document, m.LocationPreset):
            if m.Marker.objects(target_preset=document, room__ne=document.room).first():
                raise HTTPException(409, 'preset_is_referenced_in_another_room')
        # Legacy clean() silently clamps coordinates; API validation above rejects bad input.
        document.save()
    except NotUniqueError:
        raise HTTPException(409, 'unique_conflict') from None
    except ValidationError as error:
        raise HTTPException(422, {'message':'invalid_document', 'fields':list(error.to_dict())}) from None
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, 'invalid_document') from None
    parent, field = parent_link(document)
    if previous_parent is not None and (parent is None or previous_parent.pk != parent.pk):
        previous_parent.update(**{'pull__' + previous_field: document})
        touch(previous_parent)
    if parent is not None:
        parent.update(**{'add_to_set__' + field: document})
        touch(parent)
    if isinstance(document, m.LocationPreset) and document.is_default:
        m.LocationPreset.objects(room=document.room, pk__ne=document.pk).update(set__is_default=False)
    return document


def ensure_deletable(document):
    for model in RESOURCES.values():
        for name, field in model._fields.items():
            if isinstance(field, ReferenceField) and field.document_type == type(document):
                if model.objects(**{name: document}).first():
                    raise HTTPException(409, 'document_is_referenced')


def delete(resource, identifier):
    document = get(resource, identifier)
    ensure_deletable(document)
    parent, field = parent_link(document)
    document.delete()
    if parent is not None:
        parent.update(**{'pull__' + field: document})
        touch(parent)


def ordered_documents(parent, field, child_model, parent_field):
    # Keep persisted order, but include old records whose forward reference alone exists.
    ids = [ref.id for ref in parent._data.get(field, [])]
    documents = list(child_model.objects(**{parent_field: parent}))
    by_id = {item.pk: item for item in documents}
    return [by_id.pop(pk) for pk in ids if pk in by_id] + list(by_id.values())


def walls(room):
    return ordered_documents(room, 'walls', m.Wall, 'room')


def summary(room):
    return dict(id=str(room.pk), name=room.name, description=room.description,
                walls=[dict(id=str(w.pk), name=w.name) for w in walls(room)],
                created_time=scalar(room.created_time))


def wall_dto(wall):
    result = dto(wall)
    result['elements'] = [dto(item) for kind, slug in ELEMENTS.items()
                          for item in ordered_documents(wall, slug, RESOURCES[slug], 'wall')]
    result['design'] = None
    return result


def boundary(room):
    return {f'{side}_{axis}': getattr(room, f'boundary_{side}_{axis}') for axis in 'xyz' for side in ('min', 'max')}


def scene(room, *, admin=False, ar=None, preset=None, debug=None):
    presets = [p.to_dict() for p in m.LocationPreset.objects(room=room)]
    if preset:
        object_id(preset)
    selected = next((p for p in presets if p['id'] == preset), None) if preset else next((p for p in presets if p['is_default']), None)
    wall_list = [wall_dto(w) for w in walls(room)]
    minimap = []
    for w in wall_list:
        wx, _, wz = map(float, w['position'].split())
        angle = math.radians(float(w['rotation'].split()[1]))
        elements = [dict(name=e['name'], type=e['wall_element_type'],
                         world_x=wx + e['position_x'] * math.cos(angle),
                         world_z=wz + e['position_x'] * math.sin(angle)) for e in w['elements']]
        minimap.append({**{k: w.get(k) for k in ('id', 'name', 'position', 'rotation', 'width', 'height', 'surface_type')}, 'elements': elements})
    return dict(room=dict(id=str(room.pk), name=room.name, description=room.description), roomId=str(room.pk),
                boundary=boundary(room), presets=presets, spawn_preset=selected, walls=wall_list, wallList=minimap,
                visitorCapabilityUrl='/visitor-capability', avatarCatalog=['shiba', 'robot', 'rigged-simple', 'none'],
                isAdmin=admin, roomControlsEnabled=ar not in {'marker', 'companion'}, syncDebugEnabled=debug == 'sync',
                isArMarker=ar == 'marker', isArCompanion=ar == 'companion')
