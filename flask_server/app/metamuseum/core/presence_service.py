"""Pure room-presence state operations."""

from collections import defaultdict

from metamuseum.core.visitor_profile import normalize_profile


class PresenceService:
    """Own in-memory presence state keyed by room and Socket.IO session ID."""

    def __init__(self):
        self.rooms = defaultdict(dict)

    @staticmethod
    def _public_presence(user):
        return {
            "userId": user["userId"],
            "displayName": user["displayName"],
            "avatarId": user["avatarId"],
            "color": user["color"],
            "position": user["position"],
            "rotation": user["rotation"],
            "leftHand": user["leftHand"],
            "rightHand": user["rightHand"],
            "handTracking": user["handTracking"],
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
        }
        existing = self.public_room_state(room_id, exclude_sid=sid)
        self.rooms[room_id][sid] = presence
        return self._public_presence(presence), existing

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
        user.update(normalized_profile)
        return {
            "userId": user["userId"],
            **normalized_profile,
            "room_id": room_id,
        }

    def leave(self, room_id, sid):
        user = self.rooms.get(room_id, {}).pop(sid, None)
        if not user:
            return None
        return {"userId": user["userId"], "room_id": room_id}

    def leave_all(self, sid):
        events = []
        for room_id in list(self.rooms):
            event = self.leave(room_id, sid)
            if event:
                events.append(event)
        return events

    def has_room(self, room_id):
        return room_id in self.rooms

    def user_id(self, room_id, sid):
        return self.rooms.get(room_id, {}).get(sid, {}).get("userId")

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
