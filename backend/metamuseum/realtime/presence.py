"""Pure room-presence state operations."""

from .profile import normalize_profile
import math
import secrets
import struct
import time
from ..schemas_avatar import validate_avatar_pose
from ..avatar_catalog import CORE_RIG, RIG_VERSION, avatar_catalog
_HUMANOID_IDS = frozenset(p['id'] for p in avatar_catalog()['presets'] if p['rigVersion'] == RIG_VERSION)


def _legacy_head(pose):
    # Forward kinematics for the compatibility head anchor only; no IK on server.
    values = struct.unpack('<98f', pose['floats'])
    position, q, scale = list(values[:3]), values[3:7], pose['bodyScale']
    def rotate(v, q):
        x,y,z,w=q; a,b,c=v
        tx,ty,tz=2*(y*c-z*b),2*(z*a-x*c),2*(x*b-y*a)
        return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx]
    def product(a,b):
        x,y,z,w=a; X,Y,Z,W=b
        result=[w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]
        length=math.sqrt(sum(n*n for n in result)); return [n/length for n in result]
    for i,(_,_,offset) in enumerate(CORE_RIG[:6]):
        offset=[n+(values[7+j] if i==0 else 0) for j,n in enumerate(offset)]
        position=[a+b*scale for a,b in zip(position,rotate(offset,q))]
        q=product(q,values[10+i*4:14+i*4])
    position=[a+b*scale for a,b in zip(position,rotate([0,.08,0],q))]
    # Three YXZ Euler decomposition, matching the legacy camera convention.
    x,y,z,w=q; m23=2*(y*z-x*w)
    pitch=math.asin(-max(-1,min(1,m23)))
    yaw=math.atan2(2*(x*z+y*w),1-2*(x*x+y*y))
    roll=math.atan2(2*(x*y+z*w),1-2*(x*x+z*z))
    return dict(zip('xyz',position)),dict(zip('xyz',[math.degrees(pitch),math.degrees(yaw),math.degrees(roll)]))


class PresenceService:
    """Own in-memory presence state keyed by room and Socket.IO session ID."""

    def __init__(self):
        self.rooms = {}
        self.rates = {}

    @staticmethod
    def _public_presence(user):
        return {
            "userId": user["userId"],
            "displayName": user["displayName"],
            "avatarId": user["avatarId"],
            "color": user["color"],
            **({'appearance': user['appearance']} if 'appearance' in user else {}),
            "position": user["position"],
            "rotation": user["rotation"],
            "leftHand": user["leftHand"],
            "rightHand": user["rightHand"],
            "handTracking": user["handTracking"],
            **({'avatarPose': user['avatarPose']} if 'avatarPose' in user else {}),
        }

    def join(self, room_id, sid, visitor_id, profile, position, rotation):
        normalized_profile = normalize_profile(profile)
        presence = {
            "userId": visitor_id,
            **normalized_profile,
            "position": position,
            "rotation": rotation,
            "leftHand": None,
            "rightHand": None,
            "handTracking": False,
            '_generation': secrets.token_hex(16),
        }
        room = self.rooms.setdefault(room_id, {})
        displaced_sid = next((
            active_sid
            for active_sid, user in room.items()
            if active_sid != sid and user["userId"] == visitor_id
        ), None)
        if displaced_sid:
            room.pop(displaced_sid)
        existing = [
            self._public_presence(user)
            for active_sid, user in room.items()
            if active_sid != sid
        ]
        room[sid] = presence
        self.rates.setdefault(sid, {'tokens': 5., 'at': time.monotonic()})
        return self._public_presence(presence), existing, displaced_sid

    def update_position(self, room_id, sid, payload):
        user = self.rooms.get(room_id, {}).get(sid)
        if not user:
            return None

        user["position"] = payload.get("position", user["position"])
        user["rotation"] = payload.get("rotation", user["rotation"])
        user["leftHand"] = payload.get("leftHand")
        user["rightHand"] = payload.get("rightHand")
        user["handTracking"] = payload.get("handTracking", user["handTracking"])
        return dict(self._public_presence(user), room_id=room_id)

    def update_profile(self, room_id, sid, profile):
        user = self.rooms.get(room_id, {}).get(sid)
        if not user:
            return None

        normalized_profile = normalize_profile(profile)
        user.pop('appearance', None)
        user.update(normalized_profile)
        if not self._humanoid(user):
            user.pop('avatarPose', None)
        return {
            "userId": user["userId"],
            **normalized_profile,
            "appearance": normalized_profile.get("appearance"),
            "room_id": room_id,
        }

    def leave(self, room_id, sid):
        room = self.rooms.get(room_id)
        if not room:
            return None
        user = room.pop(sid, None)
        if not user:
            return None
        if not room:
            self.rooms.pop(room_id, None)
        return {"userId": user["userId"], "room_id": room_id}

    def leave_all(self, sid):
        events = []
        for room_id in list(self.rooms):
            event = self.leave(room_id, sid)
            if event:
                events.append(event)
        self.rates.pop(sid, None)
        return events

    def has_room(self, room_id):
        return room_id in self.rooms

    @staticmethod
    def _humanoid(user):
        return user.get('avatarId') in _HUMANOID_IDS

    def generation(self, room_id, sid):
        return self.rooms.get(room_id, {}).get(sid, {}).get('_generation')

    def update_avatar_pose(self, room_id, sid, generation, packet, *, now=None):
        user = self.rooms.get(room_id, {}).get(sid)
        if not user or generation != user['_generation'] or not self._humanoid(user):
            return None
        pose = validate_avatar_pose(packet)
        if pose is None:
            return None
        last = user.get('avatarPose', {}).get('pose')
        if last and (pose['sequence'] <= last['sequence'] or pose['sampleTime'] < last['sampleTime']):
            return None
        now = time.monotonic() if now is None else now
        rate = self.rates[sid]
        rate['tokens'] = min(5., rate['tokens'] + max(0, now-rate['at'])*20)
        rate['at'] = now
        if rate['tokens'] < 1:
            return None
        rate['tokens'] -= 1
        user['avatarPose'] = dict(generation=generation, serverTime=time.time()*1000, pose=pose)
        user['position'], user['rotation'] = _legacy_head(pose)
        return dict(userId=user['userId'], room_id=room_id, position=user['position'], rotation=user['rotation'], **user['avatarPose'])

    def user_id(self, room_id, sid):
        return self.rooms.get(room_id, {}).get(sid, {}).get("userId")

    def sid_for_user(self, room_id, visitor_id):
        return next((
            sid
            for sid, user in self.rooms.get(room_id, {}).items()
            if user["userId"] == visitor_id
        ), None)

    def public_room_state(self, room_id, exclude_sid=None):
        return [
            self._public_presence(user)
            for sid, user in self.rooms.get(room_id, {}).items()
            if sid != exclude_sid
        ]

    def public_rooms(self):
        return {
            room_id: [self._public_presence(user) for user in users.values()]
            for room_id, users in self.rooms.items()
        }
