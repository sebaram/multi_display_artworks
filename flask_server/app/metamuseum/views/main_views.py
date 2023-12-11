# -*- coding: utf-8 -*-
from flask import Blueprint
from flask import current_app, render_template, send_from_directory, abort, send_file, request, redirect, url_for, flash, jsonify, session


import os
from os import listdir
from os.path import isfile, join
import math
from datetime import datetime, timedelta

from metamuseum import db
from metamuseum.core.pyAframe import Box, Sphere, Cylinder, Plane, Sky
from metamuseum.elements.basic import Room, Wall, WallElement, Image, GaussianSplat,GLTFmodel
from metamuseum.elements.user import OnlineUser

bp = Blueprint('main', __name__, url_prefix='/')


@bp.route("/")
def main_page():
    # list all rooms sort by created time
    all_rooms = Room.objects().order_by('-created_time')
    return render_template('link_list.html', all_rooms=all_rooms)


@bp.route("/room")
def room():
    
    room_id = request.args.get('room_id')
    this_room = Room.objects(_id=room_id).first()

    aframe_list = [this_room.to_aframe()]

    return render_template('room_aframe.html', aframe_list=aframe_list, camera_d=3)

@bp.route('/camera-data', methods=['POST'])
def receive_camera_data():
    data = request.json

    session_id = data['userId']
    this_user = OnlineUser.objects(session_id=session_id).first()
    if this_user is None:
        this_user = OnlineUser(session_id=session_id)
        this_user.save()

    this_user.camera_position = data['position']
    this_user.camera_rotation = data['rotation']
    this_user.update_time = datetime.utcnow()
    this_user.save()

    return jsonify({"status": "success"})

@bp.route('/get-cameras', methods=['GET'])
def get_cameras():
    camera_positions = []

    # filter OnlineUser by time not been longer than 5 seconds
    last_time = datetime.utcnow() - timedelta(seconds=5)
    online_users = OnlineUser.objects(update_time__gte=last_time)
    for this_user in online_users:
        camera_positions.append({"position": this_user.camera_position, "rotation": this_user.camera_rotation, "userId": this_user.session_id})

    return jsonify(camera_positions)

@bp.route("/wall")
def wall():
    wall_id = request.args.get('wall_id')
    this_wall = Wall.objects(_id=wall_id).first()

    aframe_list = [this_wall.to_aframe()]

    camera_d = this_wall.width / 2
    return render_template('wall_aframe.html', aframe_list=aframe_list, camera_d=camera_d)

@bp.route("/element")
def wall_element():
    element_id = request.args.get('wall_element_id')
    ele_type = request.args.get('type')
    display_type = request.args.get('display_type')

    if ele_type == "image":
        this_element = Image.objects(_id=element_id).first()
    elif ele_type == "gaussian_splat":
        this_element = GaussianSplat.objects(_id=element_id).first()
        display_type = "aframe" # only allow aframe display for gaussian splat
    elif ele_type == "gltf":
        this_element = GLTFmodel.objects(_id=element_id).first()
        display_type = "aframe"
    else:
        return "define element type"
    
    if display_type == "aframe":
        return render_template('element_aframe.html', aframe=this_element.to_aframe())
    else:
        return render_template('element.html', img_link=this_element.image_url, img_description=this_element.description)

