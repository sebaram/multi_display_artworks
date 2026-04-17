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
                "userId": u.session_id
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
        return render_template('wall_aframe.html', aframe_list=aframe_list, camera_d=camera_d)
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
            return render_template('element_aframe.html', aframe=this_element.to_aframe(), avatar=avatar)
        else:
            return render_template('element.html', img_link=this_element.image_url, img_description=this_element.description)
    except Exception as e:
        logger.error(f"Error loading element {element_id}: {e}")
        return "Database unavailable", 503