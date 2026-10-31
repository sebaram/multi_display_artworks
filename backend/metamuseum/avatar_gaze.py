"""Bounded procedural-gaze configuration and solved angles; never sensor measurements."""
from copy import deepcopy
import math

LIMITS = {
    'coneDegrees': (10, 160), 'maxDistance': (.1, 100),
    'minFixationMs': (0, 10000), 'maxFixationMs': (100, 30000),
    'switchMargin': (0, 1), 'lostHoldMs': (0, 2000), 'smoothingMs': (0, 2000),
    'maxSpeedDegrees': (1, 720), 'maxYawDegrees': (0, 80), 'maxPitchDegrees': (0, 60),
    'seed': (0, 4294967295), 'exploration': (0, 1),
}
DEFAULT = dict(version=1, mode='weighted', coneDegrees=60, maxDistance=15,
               minFixationMs=600, maxFixationMs=4000, switchMargin=.15, lostHoldMs=200,
               smoothingMs=150, maxSpeedDegrees=120, maxYawDegrees=25, maxPitchDegrees=15,
               seed=1, exploration=0,
               weights=dict(center=1, proximity=.5, person=.5, speaking=1, interaction=1,
                            motion=.25, salience=.5, novelty=.25))


def _finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def normalize_gaze_config(value, *, strict=False):
    result = deepcopy(DEFAULT)
    if not isinstance(value, dict):
        if strict:
            raise ValueError('invalid_gaze_config')
        return result
    if strict and set(value) - set(DEFAULT):
        raise ValueError('unknown_gaze_config_key')
    for key in ('version', 'mode'):
        supplied = value.get(key, DEFAULT[key])
        valid = (type(supplied) is int and supplied == 1) if key == 'version' else supplied in ('forward', 'nearest', 'weighted')
        if strict and not valid:
            raise ValueError('invalid_gaze_' + key)
        if valid:
            result[key] = supplied
    for key, (low, high) in LIMITS.items():
        supplied = value.get(key, DEFAULT[key])
        valid = _finite_number(supplied)
        integer_seed = key != 'seed' or (valid and supplied == int(supplied))
        if strict and (not valid or not integer_seed or not low <= supplied <= high):
            raise ValueError('invalid_gaze_' + key)
        if valid:
            result[key] = max(low, min(high, int(supplied) if key == 'seed' else supplied))
    weights = value.get('weights', {})
    if not isinstance(weights, dict) or (strict and set(weights) - set(DEFAULT['weights'])):
        if strict:
            raise ValueError('invalid_gaze_weights')
        weights = {}
    for key, default in DEFAULT['weights'].items():
        supplied = weights.get(key, default)
        valid = _finite_number(supplied)
        if strict and (not valid or not 0 <= supplied <= 10):
            raise ValueError('invalid_gaze_weight')
        if valid:
            result['weights'][key] = max(0, min(10, supplied))
    if result['minFixationMs'] > result['maxFixationMs']:
        if strict:
            raise ValueError('invalid_gaze_fixation_range')
        result['minFixationMs'] = result['maxFixationMs']
    return result


def validate_gaze_pose(value):
    if (not isinstance(value, dict) or set(value) != {'version', 'source', 'yaw', 'pitch'}
            or type(value.get('version')) is not int or value['version'] != 1
            or value.get('source') != 'procedural'):
        raise ValueError('invalid_gaze_pose')
    for key, limit in [('yaw', 80), ('pitch', 60)]:
        angle = value.get(key)
        if not _finite_number(angle) or abs(angle) > math.radians(limit):
            raise ValueError('invalid_gaze_angle')
    return dict(value)
