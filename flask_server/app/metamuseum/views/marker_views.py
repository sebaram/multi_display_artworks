# -*- coding: utf-8 -*-
from flask import Blueprint, jsonify, request
from flask_login import current_user
from metamuseum.elements.basic import Marker, Room, LocationPreset

bp = Blueprint('marker', __name__, url_prefix='/marker')


def require_admin():
    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403


@bp.route('/room/<room_id>/markers', methods=['GET'])
def list_markers(room_id):
    """List all active markers for a room."""
    markers = Marker.objects(room=room_id, is_active=True)
    return jsonify([m.to_dict() for m in markers])


@bp.route('/<marker_id>/config', methods=['GET'])
def get_marker_config(marker_id):
    """Get marker config for AR mode (position mapping, etc)."""
    try:
        marker = Marker.objects.get(_id=marker_id)
        return jsonify(marker.to_dict())
    except Marker.DoesNotExist:
        return jsonify({'error': 'Marker not found'}), 404


@bp.route('/by-value/<marker_type>/<marker_value>', methods=['GET'])
def get_marker_by_value(marker_type, marker_value):
    """Look up marker by its type+value (e.g. hiro, or pattern URL)."""
    try:
        marker = Marker.objects.get(marker_type=marker_type, marker_value=marker_value, is_active=True)
        return jsonify(marker.to_dict())
    except Marker.DoesNotExist:
        return jsonify({'error': 'Marker not found'}), 404


@bp.route('/<marker_id>', methods=['PUT'])
def update_marker(marker_id):
    """Update marker config (admin only)."""
    err = require_admin()
    if err:
        return err

    try:
        marker = Marker.objects.get(_id=marker_id)
        data = request.json

        for field in ['name', 'description', 'marker_type', 'marker_value',
                      'target_position_x', 'target_position_y', 'target_position_z',
                      'target_rotation_x', 'target_rotation_y', 'target_rotation_z',
                      'offset_x', 'offset_y', 'offset_z', 'is_active']:
            if field in data:
                setattr(marker, field, data[field])

        if 'target_preset_id' in data:
            marker.target_preset = LocationPreset.objects.get(_id=data['target_preset_id'])

        marker.save()
        return jsonify(marker.to_dict())
    except Marker.DoesNotExist:
        return jsonify({'error': 'Marker not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@bp.route('/<marker_id>', methods=['DELETE'])
def delete_marker(marker_id):
    """Delete marker (admin only)."""
    err = require_admin()
    if err:
        return err

    try:
        marker = Marker.objects.get(_id=marker_id)
        marker.delete()
        return jsonify({'status': 'deleted'})
    except Marker.DoesNotExist:
        return jsonify({'error': 'Marker not found'}), 404
