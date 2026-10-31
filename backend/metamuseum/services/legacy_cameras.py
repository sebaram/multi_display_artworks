"""Short-lived HTTP camera snapshots, independent of signed room presence."""
from datetime import datetime, timedelta, timezone
import math
from threading import Lock

from ..models import OnlineUser

MAX_CAMERAS = 1000
_write_lock = Lock()


def _number(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and abs(value) <= 1_000_000 and math.isfinite(value))


def _vector(value):
    return isinstance(value, dict) and set(value) == {'x', 'y', 'z'} and all(_number(n) for n in value.values())


def _hand(value, depth=0):
    if depth > 4:
        return False
    if value is None:
        return True
    if isinstance(value, dict):
        return len(value) <= 32 and all(
            isinstance(key, str) and 0 < len(key) <= 64 and not key.startswith('$') and '.' not in key
            and _hand(item, depth + 1) for key, item in value.items())
    if isinstance(value, list):
        return len(value) <= 32 and all(_hand(item, depth + 1) for item in value)
    return _number(value)


def validate(data):
    if not isinstance(data, dict) or not isinstance(data.get('userId'), str) or not data['userId'].strip():
        raise ValueError('userId required')
    if len(data['userId']) > 200 or any(ord(char) < 32 for char in data['userId']):
        raise ValueError('invalid userId')
    if not _vector(data.get('position')) or not _vector(data.get('rotation')):
        raise ValueError('finite position and rotation required')
    values = {key: data[key] for key in ('userId', 'position', 'rotation')}
    for key in ('leftHand', 'rightHand'):
        if key in data and data[key] is not None:
            if not isinstance(data[key], dict) or not _hand(data[key]):
                raise ValueError('invalid hand data')
            values[key] = data[key]
    if 'handTrackingEnabled' in data and data['handTrackingEnabled'] is not None:
        tracking = data['handTrackingEnabled']
        if (not isinstance(tracking, dict) or set(tracking) - {'enabled', 'device'}
                or ('enabled' in tracking and not isinstance(tracking['enabled'], bool))
                or ('device' in tracking and (not isinstance(tracking['device'], str) or len(tracking['device']) > 100))):
            raise ValueError('invalid hand tracking data')
        values['handTrackingEnabled'] = tracking
    return values


def save(data):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # One runtime worker owns writes; prune expired telemetry before admitting a new ID.
    with _write_lock:
        OnlineUser.objects(update_time__lt=now - timedelta(seconds=5)).delete()
        user = OnlineUser.objects(session_id=data['userId']).first()
        if user is None:
            if OnlineUser.objects.count() >= MAX_CAMERAS:
                return False
            user = OnlineUser(session_id=data['userId'], update_time=now)
        user.camera_position = data['position']
        user.camera_rotation = data['rotation']
        for key, field in (('leftHand', 'left_hand'), ('rightHand', 'right_hand'),
                           ('handTrackingEnabled', 'hand_tracking_enabled')):
            if key in data:
                setattr(user, field, data[key])
        user.update_time = now
        user.save()
    return True


def recent():
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
    result = []
    for user in OnlineUser.objects(update_time__gte=cutoff).limit(MAX_CAMERAS):
        data = {'userId': user.session_id, 'position': user.camera_position, 'rotation': user.camera_rotation,
                'leftHand': user.left_hand, 'rightHand': user.right_hand,
                'handTrackingEnabled': user.hand_tracking_enabled}
        try:
            validate(data)
        except ValueError:
            continue
        result.append(data)
    return result
