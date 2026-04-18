# -*- coding: utf-8 -*-
"""AR Companion routes — Vision Pro companion phone camera."""
from flask import Blueprint, render_template, request, jsonify
from flask_login import current_user
from metamuseum.elements.basic import Room, Marker

bp = Blueprint('ar_companion', __name__, url_prefix='/ar-companion')


@bp.route('')
def companion_page():
    """Companion AR page — iPhone carries the camera, Vision Pro receives pose."""
    room_id = request.args.get('room_id')
    if not room_id:
        return "room_id required", 400

    try:
        this_room = Room.objects(_id=room_id).first()
        if not this_room:
            return "Room not found", 404

        # Get markers for this room
        markers = Marker.objects(room=room_id, is_active=True)
        marker_list = [m.to_dict() for m in markers]

        return render_template('ar_companion.html',
                              room_id=room_id,
                              room_name=this_room.name,
                              markers=marker_list)
    except Exception as e:
        return f"Error: {e}", 500


@bp.route('/status')
def status():
    """Check how many devices are connected to a room."""
    from metamuseum.core.ar_proxy import ar_rooms
    room_id = request.args.get('room_id')
    if not room_id:
        return jsonify({'error': 'room_id required'}), 400

    room = ar_rooms.get(room_id, {})
    return jsonify({
        'room_id': room_id,
        'phones_count': len(room.get('phones', set())),
        'vision_pros_count': len(room.get('vision_pros', set())),
        'has_pose': room.get('latest_pose') is not None
    })
