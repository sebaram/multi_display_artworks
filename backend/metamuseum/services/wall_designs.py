"""Mongo-backed wall looks and immutable applied snapshots."""
import copy
import json
import math
import re
import time
import threading
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from bson import ObjectId
from fastapi import HTTPException
from mongoengine.connection import get_db
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .gallery import get, object_id, scalar, safe_json

SOURCE = 'b247fd238fe6cb2c8c860c77d13488b28b8a0290'
RENDERER = 'gsmv-wall-1'
reference_lock = threading.RLock()

def locked(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with reference_lock:
            return fn(*args, **kwargs)
    return wrapper
ROOT = Path(__file__).resolve().parents[3] / 'frontend/public/wall-presets'

def utc_now():
    value = datetime.now(timezone.utc).replace(tzinfo=None)
    return value.replace(microsecond=value.microsecond // 1000 * 1000)

def collection(name):
    return get_db()['wall_design_' + name]

def validate_config(value, raw=False):
    if not isinstance(value, dict):
        raise HTTPException(422, 'invalid_wall_look')
    value = copy.deepcopy(value)
    if raw and 'schema_version' not in value:
        # Imported source states are based on the same normalized source envelope.
        base = json.loads((Path(__file__).resolve().parents[1] / 'wall_default.json').read_text(encoding='utf8'))
        base['state'].update(value)
        state = base['state']
        if 'screens' not in value:
            state['screens'] = copy.deepcopy(base['state']['screens'])
            for screen, prefix in zip(state['screens'], ('left', 'front')):
                screen['width'] = state[prefix + 'W']; screen['height'] = state[prefix + 'H']
            state['screens'][0]['mode'] = 'raster' if state.get('leftShape') == 'raster' else 'tiles'
            bezel = state.get('bezel', 0)
            state['screens'][0].update(cols=3 if bezel in (0, 32) else bezel, rows=2 if bezel in (0, 32) else bezel, grid=bool(bezel))
        if not isinstance(state.get('screens'), list): raise HTTPException(422, 'invalid_wall_screen')
        normalized_screens = []
        for index, screen in enumerate(state.get('screens', [])):
            if not isinstance(screen, dict): raise HTTPException(422, 'invalid_wall_screen')
            normalized_screens.append({'id': screen.get('id') or f'screen-{index+1}', 'name': screen.get('name') or f'Screen {index+1}',
                'width': screen.get('width', 3840), 'height': screen.get('height', 2160), 'mode': screen.get('mode', 'raster'),
                'cols': screen.get('cols', 1), 'rows': screen.get('rows', 1), 'tileW': screen.get('tileW', 16),
                'tileH': screen.get('tileH', 9), 'aspectW': screen.get('aspectW', 16), 'aspectH': screen.get('aspectH', 9), 'grid': bool(screen.get('grid', False))})
        if not normalized_screens: raise HTTPException(422, 'invalid_wall_screen')
        state['screens'] = normalized_screens
        front = next((screen for screen in normalized_screens if screen['id'] == 'front'), normalized_screens[0])
        left = next((screen for screen in normalized_screens if screen['id'] == 'left'), normalized_screens[0])
        state.update(frontW=front['width'], frontH=front['height'], leftW=left['width'], leftH=left['height'], leftShape='tiles' if left['mode'] == 'tiles' else 'raster')
        base['logical_screen'] = front['id']
        value = base
    if set(value) != {'schema_version', 'source_commit', 'logical_screen', 'seed', 'state'}:
        raise HTTPException(422, 'invalid_wall_look')
    if value.get('schema_version') != 1 or value.get('source_commit') != SOURCE or type(value.get('seed')) is not int or not 0 <= value['seed'] <= 999999:
        raise HTTPException(422, 'invalid_wall_look')
    state = value.get('state')
    if not isinstance(state, dict):
        raise HTTPException(422, 'invalid_wall_look')
    safe_json(value)
    for key, minimum, maximum in [('speed', 0, 3), ('offset', 0, 1e10), ('epoch', 0, 1e14), ('brightness', 10, 100), ('motionAmount', 0, 2)]:
        number = state.get(key)
        if number is not None and (isinstance(number, bool) or not isinstance(number, (int, float)) or not minimum <= number <= maximum):
            raise HTTPException(422, 'wall_look_number_out_of_range')
    for key, upper in [('variant', 12), ('cue', 6)]:
        if key in state and (type(state[key]) is not int or not 0 <= state[key] < upper):
            raise HTTPException(422, 'invalid_wall_look')
    for key in ('editVideos', 'editElements'):
        if key in state: state[key] = False
    if 'activeElement' in state: state['activeElement'] = None
    if 'activeVideoLayer' in state: state['activeVideoLayer'] = None
    def walk(item):
        if type(item) is int and not -(2**63) <= item < 2**63:
            raise HTTPException(422, 'wall_look_number_out_of_range')
        if isinstance(item, str) and item.lower().startswith('blob:'):
            raise HTTPException(422, 'blob_url_forbidden')
        if isinstance(item, dict):
            for child in item.values(): walk(child)
        elif isinstance(item, list):
            for child in item: walk(child)
    walk(value)
    screens, videos, authored = state.get('screens'), state.get('videoLayers', []), state.get('authored', {})
    if not isinstance(screens, list) or not 1 <= len(screens) <= 8 or not isinstance(videos, list) or len(videos) > 8 or not isinstance(authored, dict):
        raise HTTPException(422, 'invalid_wall_look')
    ids = [s.get('id') for s in screens if isinstance(s, dict)]
    if len(ids) != len(screens) or any(not isinstance(i, str) or not i for i in ids) or len(set(ids)) != len(ids) or value.get('logical_screen') not in ids:
        raise HTTPException(422, 'invalid_wall_screen')
    def bounded(item, limits):
        if not isinstance(item, dict): raise HTTPException(422, 'invalid_wall_look')
        for key, low, high in limits:
            if key in item and (isinstance(item[key], bool) or not isinstance(item[key], (int, float)) or not low <= item[key] <= high):
                raise HTTPException(422, 'wall_look_number_out_of_range')
    transform_limits = [('x', -50, 150), ('y', -50, 150), ('size', .05, 6), ('rotation', -180, 180), ('seed', 0, 999999), ('randomness', 0, 2), ('motionSpeed', 0, 3), ('motionAmount', 0, 2), ('motionAnchor', -1e10, 1e10), ('motionOffset', -1e10, 1e10), ('textSize', 6, 400), ('textWeight', 100, 900), ('textWidth', 5, 100), ('textLineHeight', .6, 3), ('textSpacing', -.1, 1), ('textOpacity', 0, 1)]
    appearance = state.get('appearance', {})
    if not isinstance(appearance, dict): raise HTTPException(422, 'invalid_appearance')
    for entry in appearance.values():
        bounded(entry, [('glow', 0, 2), ('lighting', 0, 2), ('floor', 0, 1)])
    for screen in screens:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,50}', screen['id']): raise HTTPException(422, 'invalid_wall_screen')
        bounded(screen, [('width', 1, 16384), ('height', 1, 16384), ('cols', 1, 32), ('rows', 1, 32), ('tileW', 0.000001, 1000), ('tileH', 0.000001, 1000), ('aspectW', 0.000001, 1000), ('aspectH', 0.000001, 1000)])
    video_ids = set()
    for layer in videos:
        bounded(layer, [('x', 0, 100), ('y', 0, 100), ('width', 5, 100), ('sourceAspect', .1, 32), ('motionSpeed', 0, 3), ('motionAnchor', -1e10, 1e10), ('motionOffset', -1e10, 1e10)])
        if not isinstance(layer.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,60}', layer['id']): raise HTTPException(422, 'invalid_video_layer')
        if layer['id'] in video_ids: raise HTTPException(422, 'invalid_video_layer')
        video_ids.add(layer['id'])
        placements = layer.get('screens', {})
        if not isinstance(placements, dict) or len(placements) > 8: raise HTTPException(422, 'invalid_video_layer')
        for placement in placements.values(): bounded(placement, [('x', 0, 100), ('y', 0, 100), ('width', 5, 100)])
        clip = layer.get('customClip')
        if clip is not None:
            if not isinstance(clip, dict) or not isinstance(clip.get('url'), str): raise HTTPException(422, 'invalid_clip')
            url = clip['url']
            for _ in range(3): url = unquote(url)
            try: parsed = urlsplit(url)
            except ValueError: raise HTTPException(422, 'invalid_clip') from None
            if '\\' in url or '..' in parsed.path.split('/') or parsed.scheme not in ('', 'http', 'https') or url.startswith('//'):
                raise HTTPException(422, 'invalid_clip')
    for preset in authored.values():
        if (not isinstance(preset, dict) or not isinstance(preset.get('objects', []), list)
                or not isinstance(preset.get('edits', {}), dict)
                or len(preset.get('objects', [])) > 32 or len(preset.get('edits', {})) > 4096):
            raise HTTPException(422, 'wall_look_limit')
        for identifier, edit in preset.get('edits', {}).items():
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', identifier): raise HTTPException(422, 'invalid_element_id')
            bounded(edit, transform_limits)
        object_ids = set()
        for obj in preset.get('objects', []):
            bounded(obj, transform_limits)
            identifier = obj.get('id')
            if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', identifier) or identifier in object_ids: raise HTTPException(422, 'invalid_element_id')
            object_ids.add(identifier)
    return value

def assets(config):
    result = []
    for layer in config['state'].get('videoLayers', []):
        if not isinstance(layer, dict): raise HTTPException(422, 'invalid_video_layer')
        asset = layer.get('assetId')
        if asset:
            object_id(asset)
            if asset not in result: result.append(asset)
    return result

def check_assets(ids, thumbnail=None):
    for identifier in ids + ([thumbnail] if thumbnail else []):
        doc = collection('assets').find_one({'_id': object_id(identifier)})
        if not doc: raise HTTPException(422, 'asset_not_found')
        if identifier == thumbnail and not doc['content_type'].startswith('image/'):
            raise HTTPException(422, 'thumbnail_must_be_image')

def preset_dto(doc):
    return {'id': str(doc['_id']), **{k: scalar(doc.get(k)) for k in ('name','revision','read_only','source_key','schema_version','renderer_version','config','asset_ids','thumbnail_asset_id','created_at','updated_at')}, 'thumbnail_url': f"/api/v1/wall-assets/{doc['thumbnail_asset_id']}/content" if doc.get('thumbnail_asset_id') else None}

def preset(identifier):
    doc = collection('presets').find_one({'_id': object_id(identifier)})
    if not doc: raise HTTPException(404, 'preset_not_found')
    return doc

@locked
def create(name, config, thumbnail=None, raw=False):
    config = validate_config(config, raw=raw)
    ids = assets(config); check_assets(ids, thumbnail)
    now = utc_now()
    doc = dict(name=name, config=config, asset_ids=ids, thumbnail_asset_id=thumbnail, revision=1, read_only=False, source_key=None, schema_version=1, renderer_version=RENDERER, created_at=now, updated_at=now)
    doc['_id'] = collection('presets').insert_one(doc).inserted_id
    return preset_dto(doc)

def catalog_root(settings=None):
    if settings and settings.frontend_root and (settings.frontend_root / 'wall-presets' / 'manifest.json').is_file():
        return settings.frontend_root / 'wall-presets'
    return ROOT

def import_defaults(settings=None):
    root = catalog_root(settings)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
    col = collection('presets'); col.create_index('source_key', unique=True, partialFilterExpression={'source_key': {'$type': 'string'}})
    for item in manifest['presets']:
        data = json.loads((root / item['file']).read_text(encoding='utf8'))
        config = validate_config(data['config'])
        now = utc_now()
        col.update_one({'source_key': item['source_key']}, {'$setOnInsert': dict(name=item['name'], config=config, asset_ids=assets(config), thumbnail_asset_id=None, revision=1, read_only=True, schema_version=1, renderer_version=RENDERER, created_at=now, updated_at=now)}, upsert=True)
    return len(manifest['presets'])

@locked
def update(identifier, data):
    old = preset(identifier)
    if old['read_only']: raise HTTPException(403, 'preset_read_only')
    fields = {k: v for k,v in data.items() if k in ('name','config','thumbnail_asset_id')}
    if any(k in fields and fields[k] is None for k in ('name', 'config')):
        raise HTTPException(422, 'value_required')
    if 'config' in fields:
        fields['config'] = validate_config(fields['config']); fields['asset_ids'] = assets(fields['config'])
    check_assets(fields.get('asset_ids', old['asset_ids']), fields.get('thumbnail_asset_id', old.get('thumbnail_asset_id')))
    fields['updated_at'] = utc_now()
    doc = collection('presets').find_one_and_update({'_id': old['_id'], 'revision': data['expected_revision'], 'read_only': False}, {'$set': fields, '$inc': {'revision': 1}}, return_document=ReturnDocument.AFTER)
    if not doc: raise HTTPException(409, 'revision_conflict')
    return preset_dto(doc)

def delete(identifier, revision):
    old = preset(identifier)
    if old['read_only']: raise HTTPException(403, 'preset_read_only')
    if not collection('presets').delete_one({'_id': old['_id'], 'revision': revision}).deleted_count: raise HTTPException(409, 'revision_conflict')

def binding_dto(doc, wall):
    return {'wall_id': str(wall.pk), 'room_id': str(wall.room.pk), **{k: scalar(doc.get(k)) for k in ('revision','preset_id','preset_revision','config','asset_ids','logical_screen','seed','animation_epoch_ms','playback')}}

def get_binding(identifier):
    wall = get('walls', identifier)
    doc = collection('bindings').find_one({'_id': wall.pk})
    return binding_dto(doc, wall) if doc else None

@locked
def apply(identifier, data):
    wall = get('walls', identifier)
    if (data.get('preset_id') is None) == (data.get('config') is None): raise HTTPException(422, 'exactly_one_source_required')
    source = preset(data['preset_id']) if data.get('preset_id') else None
    config = validate_config(source['config'] if source else data['config']); ids = assets(config); check_assets(ids)
    now = int(time.time() * 1000); revision = data['expected_revision'] + 1
    state = config['state']
    playback = dict(wall_id=str(wall.pk), binding_revision=revision, revision=1, playing=not state.get('paused', False), position_seconds=state.get('offset', 0), rate=state.get('speed', 1), state_time_ms=now)
    fields = dict(revision=revision, preset_id=source['_id'] if source else None, preset_revision=source['revision'] if source else None, config=config, asset_ids=ids, logical_screen=config['logical_screen'], seed=config['seed'], animation_epoch_ms=now, playback=playback)
    col = collection('bindings')
    if data['expected_revision'] == 0:
        try: col.insert_one({'_id': wall.pk, **fields})
        except DuplicateKeyError: raise HTTPException(409, 'revision_conflict') from None
    elif not col.replace_one({'_id': wall.pk, 'revision': data['expected_revision']}, {'_id': wall.pk, **fields}).matched_count:
        raise HTTPException(409, 'revision_conflict')
    return binding_dto(fields, wall)

def unbind(identifier, revision):
    wall = get('walls', identifier)
    if not collection('bindings').delete_one({'_id': wall.pk, 'revision': revision}).deleted_count: raise HTTPException(409, 'revision_conflict')
    return str(wall.room.pk)
