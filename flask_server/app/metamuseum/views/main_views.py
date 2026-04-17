# -*- coding: utf-8 -*-
from flask import Blueprint
from flask import current_app, render_template, send_from_directory, abort, send_file, request, redirect, url_for, flash, jsonify, session
import logging

import os
from os import listdir
from os.path import isfile, join
import math
from datetime import datetime, timedelta

from metamuseum.core.pyAframe import Box, Sphere, Cylinder, Plane, Sky
from metamuseum.core.ratelimit import rate_limiter
from metamuseum.elements.basic import Room, Wall, WallElement, Image, GaussianSplat, GLTFmodel
from metamuseum.elements.user import OnlineUser

logger = logging.getLogger(__name__)
bp = Blueprint('main', __name__, url_prefix='/')


@bp.route("/")
def main_page():
    try:
        all_rooms = Room.objects().order_by('-created_time')
        return render_template('link_list.html', all_rooms=all_rooms)
    except Exception as e:
        logger.error(f"Error loading main page: {e}")
        return "Database unavailable. Please try again later.", 503


@bp.route("/health")
def health():
    try:
        Room.objects.first()
        return jsonify({"status": "ok", "db": "connected"})
    except Exception as e:
        return jsonify({"status": "error", "db": str(e)}), 503


@bp.route("/room")
def room():
    room_id = request.args.get('room_id')
    if not room_id:
        return "room_id required", 400
    
    try:
        this_room = Room.objects(_id=room_id).first()
        if not this_room:
            return "Room not found", 404
        aframe_list = [this_room.to_aframe()]
        avatar = request.args.get('avatar', 'shiba')
        if avatar not in ('shiba', 'robot', 'none'):
            avatar = 'shiba'
        return render_template('room_aframe.html', aframe_list=aframe_list, camera_d=3, avatar=avatar)
    except Exception as e:
        logger.error(f"Error loading room {room_id}: {e}")
        return "Database unavailable", 503


@bp.route('/camera-data', methods=['POST'])
def receive_camera_data():
    try:
        data = request.json
        if not data or 'userId' not in data:
            return jsonify({"error": "userId required"}), 400

        session_id = data['userId']
        
        # Rate limit: 30 requests per 60 seconds per userId
        if not rate_limiter.is_allowed(f"camera:{session_id}", max_hits=30, window_seconds=60):
            return jsonify({"error": "rate limit exceeded"}), 429

        if not data.get('position') or not data.get('rotation'):
            return jsonify({"error": "position and rotation required"}), 400

        this_user = OnlineUser.objects(session_id=session_id).first()
        if this_user is None:
            this_user = OnlineUser(session_id=session_id)

        this_user.camera_position = data['position']
        this_user.camera_rotation = data['rotation']
        
        # Optional hand tracking data
        if data.get('leftHand'):
            this_user.left_hand = data['leftHand']
        if data.get('rightHand'):
            this_user.right_hand = data['rightHand']
        if data.get('handTrackingEnabled'):
            this_user.hand_tracking_enabled = data['handTrackingEnabled']
        
        this_user.update_time = datetime.utcnow()
        this_user.save()

        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"Error in receive_camera_data: {e}")
        return jsonify({"error": "server error"}), 500


@bp.route('/get-cameras', methods=['GET'])
def get_cameras():
    try:
        # Rate limit: 10 requests per 60 seconds per IP
        client_ip = request.remote_addr or 'unknown'
        if not rate_limiter.is_allowed(f"getcameras:{client_ip}", max_hits=10, window_seconds=60):
            return jsonify({"error": "rate limit exceeded"}), 429

        last_time = datetime.utcnow() - timedelta(seconds=5)
        online_users = OnlineUser.objects(update_time__gte=last_time)
        camera_positions = [
            {
                "position": u.camera_position,
                "rotation": u.camera_rotation,
                "userId": u.session_id,
                "leftHand": u.left_hand,
                "rightHand": u.right_hand,
                "handTrackingEnabled": u.hand_tracking_enabled,
            }
            for u in online_users
        ]
        return jsonify(camera_positions)
    except Exception as e:
        logger.error(f"Error in get_cameras: {e}")
        return jsonify([])


@bp.route("/wall")
def wall():
    wall_id = request.args.get('wall_id')
    if not wall_id:
        return "wall_id required", 400

    try:
        this_wall = Wall.objects(_id=wall_id).first()
        if not this_wall:
            return "Wall not found", 404

        aframe_list = [this_wall.to_aframe()]
        camera_d = this_wall.width / 2
        refresh_interval = request.args.get('refresh')
        return render_template('wall_aframe.html', aframe_list=aframe_list, camera_d=camera_d, refresh_interval=refresh_interval)
    except Exception as e:
        logger.error(f"Error loading wall {wall_id}: {e}")
        return "Database unavailable", 503


@bp.route("/element")
def wall_element():
    element_id = request.args.get('wall_element_id')
    ele_type = request.args.get('type')
    display_type = request.args.get('display_type')

    if not element_id or not ele_type:
        return "wall_element_id and type required", 400

    try:
        if ele_type == "image":
            this_element = Image.objects(_id=element_id).first()
        elif ele_type == "gaussian_splat":
            this_element = GaussianSplat.objects(_id=element_id).first()
            display_type = "aframe"
        elif ele_type == "gltf":
            this_element = GLTFmodel.objects(_id=element_id).first()
            display_type = "aframe"
        else:
            return "define element type", 400

        if not this_element:
            return "Element not found", 404

        if display_type == "aframe":
            avatar = request.args.get('avatar', 'shiba')
            if avatar not in ('shiba', 'robot', 'none'):
                avatar = 'shiba'
            
            # Extra params for gaussian_splat cutout UI
            extra = {}
            if ele_type == "gaussian_splat":
                extra['element_type'] = ele_type
                extra['element_id'] = str(this_element._id)
                extra['cutout_scale'] = this_element.cutout_scale
                extra['cutout_position'] = this_element.cutout_position
            
            return render_template('element_aframe.html', 
                                  aframe=this_element.to_aframe(), 
                                  avatar=avatar, 
                                  **extra)
        else:
            return render_template('element.html', img_link=this_element.image_url, img_description=this_element.description)
    except Exception as e:
        logger.error(f"Error loading element {element_id}: {e}")
        return "Database unavailable", 503


@bp.route("/element/<element_id>/<element_type>", methods=['PATCH'])
def update_element(element_id, element_type):
    """Update element position and optional parameters (for drag-to-move, cutout editing)"""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        if element_type == "image":
            element = Image.objects(_id=element_id).first()
        elif element_type == "gaussian_splat":
            element = GaussianSplat.objects(_id=element_id).first()
        elif element_type == "gltf":
            element = GLTFmodel.objects(_id=element_id).first()
        else:
            return jsonify({"error": "Unknown element type"}), 400

        if not element:
            return jsonify({"error": "Element not found"}), 404

        if 'position_x' in data:
            element.position_x = float(data['position_x'])
        if 'position_y' in data:
            element.position_y = float(data['position_y'])
        
        # Cutout params for gaussian_splat
        if element_type == "gaussian_splat":
            if 'cutout_scale' in data:
                element.cutout_scale = data['cutout_scale']
            if 'cutout_position' in data:
                element.cutout_position = data['cutout_position']

        element.save()
        return jsonify({"status": "success", "element_id": str(element._id)})
    except Exception as e:
        logger.error(f"Error updating element {element_id}: {e}")
        return jsonify({"error": str(e)}), 500