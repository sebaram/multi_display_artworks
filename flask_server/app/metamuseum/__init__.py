# -*- coding: utf-8 -*-

from flask import Flask
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from flask_admin import Admin
from flask_cors import CORS
from metamuseum.core.mailing import mail

import config

login_manager = LoginManager()
bcrypt = Bcrypt()
cors = CORS()


from . import models


from flask import redirect, url_for, request 
from flask_login import login_required, current_user
from flask_admin.contrib.mongoengine import ModelView

# class AuthModelView(ModelView):
#     form_excluded_columns = ('password')
#     can_export = True
#     def is_accessible(self):
#         return not current_user.is_anonymous and current_user.is_admin()
#     def inaccessible_callback(self, name, **kwargs):
#         # redirect to login page if user doesn't have access
#         return redirect(url_for('auth.signin', next=request.url))
    
# class HTMLModelView(ModelView):
#     column_exclude_list = ('html')
#     column_default_sort = ('modified_date', True)
#     can_export = True
#     def is_accessible(self):
#         return not current_user.is_anonymous and current_user.is_admin()
#     def inaccessible_callback(self, name, **kwargs):
#         # redirect to login page if user doesn't have access
#         return redirect(url_for('auth.signin', next=request.url))


class MyModelView(ModelView):
    def is_accessible(self):
        return not current_user.is_anonymous and current_user.is_admin()
    def inaccessible_callback(self, name, **kwargs):
        # redirect to login page if user doesn't have access
        return redirect(url_for('auth.signin', next=request.url))


# --- Specialized admin views with labels and help text ---

class RoomView(MyModelView):
    column_labels = {
        'name': 'Room Name',
        'description': 'Description',
        'boundary_min_x': 'Boundary Min X',
        'boundary_max_x': 'Boundary Max X',
        'boundary_min_y': 'Boundary Min Y (floor)',
        'boundary_max_y': 'Boundary Max Y (ceiling)',
        'boundary_min_z': 'Boundary Min Z',
        'boundary_max_z': 'Boundary Max Z',
    }
    column_descriptions = {
        'name': 'Unique room identifier used in URLs',
        'boundary_min_x': 'Left boundary limit (default -10)',
        'boundary_max_x': 'Right boundary limit (default 10)',
        'boundary_min_y': 'Floor level — users cannot fall below this (default 0)',
        'boundary_max_y': 'Ceiling limit (default 5)',
        'boundary_min_z': 'Near boundary limit (default -10)',
        'boundary_max_z': 'Far boundary limit (default 10)',
    }
    form_args = {
        'name': {'description': 'Unique name for this room (used in URLs)'},
        'description': {'description': 'Brief description shown in room list'},
        'boundary_min_y': {'description': 'Floor level — set to 0 to prevent falling through ground'},
    }


class WallView(MyModelView):
    column_labels = {
        'name': 'Wall Name',
        'position': 'Position (x y z)',
        'rotation': 'Rotation (x y z)',
        'video_url': 'Video Background URL',
        'image_url': 'Image Background URL',
    }
    column_descriptions = {
        'position': 'Space-separated x y z coordinates (e.g. "0 1.5 -3")',
        'rotation': 'Space-separated x y z degrees (e.g. "0 90 0")',
        'video_url': 'URL to mp4/webm file or HLS .m3u8 stream for video background',
        'image_url': 'URL to background image for the wall surface',
        'color': 'Hex color if no image/video (e.g. #333333)',
    }
    form_args = {
        'video_url': {'description': 'Supports mp4, webm, or HLS (.m3u8). Leave blank for no video.'},
        'position': {'description': 'Format: "x y z" (e.g. "0 1.5 -3")'},
        'rotation': {'description': 'Format: "x y z" in degrees (e.g. "0 90 0")'},
    }


class ImageView(MyModelView):
    column_labels = {
        'name': 'Image Name',
        'image_url': 'Image URL',
        'position_x': 'Pos X (on wall)',
        'position_y': 'Pos Y (on wall)',
        'scale_x': 'Scale X',
        'scale_y': 'Scale Y',
        'scale_z': 'Scale Z',
        'rotation_x': 'Rotation X',
        'rotation_y': 'Rotation Y',
        'rotation_z': 'Rotation Z',
    }
    column_descriptions = {
        'image_url': 'Full URL to the image file',
        'position_x': 'Horizontal offset on the wall',
        'position_y': 'Vertical offset on the wall',
        'scale_x': 'Horizontal scale factor (1.0 = original)',
        'rotation_x': 'Rotation in degrees around X axis',
    }
    form_args = {
        'image_url': {'description': 'Direct URL to image (png, jpg, webp)'},
        'width': {'description': 'Display width in meters'},
        'height': {'description': 'Display height in meters'},
    }


class GaussianSplatView(MyModelView):
    column_labels = {
        'name': 'Splat Name',
        'splat_url': 'Splat File URL',
        'cutout_scale': 'Cutout Scale (x y z)',
        'cutout_position': 'Cutout Position (x y z)',
    }
    column_descriptions = {
        'splat_url': 'URL to .splat file (e.g. from Luma AI or Hugging Face)',
        'cutout_scale': 'Size of the clipping box (e.g. "0.5 0.5 0.5"). Leave blank to show full splat.',
        'cutout_position': 'Offset of the clipping box center (e.g. "0 0 0")',
    }
    form_args = {
        'splat_url': {'description': 'URL to .splat file hosted on Hugging Face, Luma, etc.'},
        'cutout_scale': {'description': 'Leave blank for no cutout. Format: "x y z" (e.g. "0.5 0.5 0.5")'},
        'cutout_position': {'description': 'Cutout center offset. Format: "x y z"'},
    }


class GLTFmodelView(MyModelView):
    column_labels = {
        'name': 'Model Name',
        'gltf_url': 'glTF File URL',
        'default_rotation': 'Default Rotation (x y z)',
        'position_z': 'Depth Offset (Z)',
    }
    column_descriptions = {
        'gltf_url': 'URL to .glb or .gltf file',
        'default_rotation': 'Initial rotation in degrees (e.g. "0 180 0" to face camera)',
        'position_z': 'Additional Z offset from wall surface',
    }
    form_args = {
        'gltf_url': {'description': 'URL to .glb/.gltf 3D model file'},
        'default_rotation': {'description': 'Format: "x y z" in degrees'},
    }


class WebpageView(MyModelView):
    column_labels = {
        'name': 'Webpage Name',
        'webpage_url': 'Webpage URL',
    }
    column_descriptions = {
        'webpage_url': 'URL to embed as iframe. YouTube/Twitch embed URLs also work.',
        'width': 'Display width in meters',
        'height': 'Display height in meters',
    }
    form_args = {
        'webpage_url': {'description': 'URL to embed. Some sites block iframe embedding (X-Frame-Options).'},
    }


class LocationPresetView(MyModelView):
    column_labels = {
        'name': 'Preset Name',
        'is_default': 'Default Spawn Point?',
        'position_x': 'Pos X',
        'position_y': 'Pos Y',
        'position_z': 'Pos Z',
        'rotation_x': 'Look Rot X',
        'rotation_y': 'Look Rot Y',
        'rotation_z': 'Look Rot Z',
    }
    column_descriptions = {
        'name': 'Display name shown in teleport dropdown',
        'is_default': 'If true, new visitors spawn here. Only one per room.',
        'position_x': 'World X coordinate',
        'position_y': 'World Y coordinate (height)',
        'position_z': 'World Z coordinate',
    }
    form_args = {
        'is_default': {'description': 'Mark as spawn point for new visitors. Only set one per room.'},
        'name': {'description': 'Friendly name shown in the teleport dropdown'},
    }


class RoomEffectView(MyModelView):
    column_labels = {
        'effect_type': 'Effect Type',
        'target_id': 'Target Element ID',
        'params': 'Effect Parameters',
        'active': 'Active?',
        'expires_at': 'Expires At',
        'created_by': 'Created By',
    }
    column_descriptions = {
        'effect_type': 'One of: glitter, spotlight, ambient, fog, sound, pulse, color_shift, shake, fade',
        'target_id': 'Optional: element _id to apply effect to. Leave blank for room-wide.',
        'params': 'JSON dict of effect-specific params (e.g. {"color": "#ff0", "intensity": 2})',
        'active': 'Uncheck to disable without deleting',
        'expires_at': 'Auto-deactivate after this time (optional)',
    }
    form_args = {
        'effect_type': {'description': 'Types: glitter, spotlight, ambient, fog, sound, pulse, color_shift, shake, fade'},
        'target_id': {'description': 'Element _id to target, or leave blank for whole room'},
    }


class MarkerView(MyModelView):
    column_labels = {
        'name': 'Marker Name',
        'marker_type': 'Type (hiro/pattern/image)',
        'marker_value': 'Marker Value',
        'target_position_x': 'Target Pos X',
        'target_position_y': 'Target Pos Y',
        'target_position_z': 'Target Pos Z',
        'target_preset': 'Link to Preset',
        'is_active': 'Active?',
    }
    column_descriptions = {
        'marker_type': 'hiro = built-in AR.js marker, pattern = custom printed, image = NFT image',
        'marker_value': '"hiro" for hiro type, or URL to pattern/image file',
        'target_position_y': 'Usually 1.6 (eye height)',
        'target_preset': 'Optionally link to a LocationPreset instead of manual coordinates',
        'is_active': 'Disabled markers are ignored in AR mode',
    }
    form_args = {
        'marker_type': {'description': 'hiro (built-in), pattern (custom print), or image (NFT photo)'},
        'marker_value': {'description': '"hiro" for hiro type, or URL to pattern/image file'},
    }


class LLMConfigView(MyModelView):
    column_labels = {
        'provider': 'LLM Provider',
        'api_base': 'API Base URL',
        'api_key': 'API Key',
        'model': 'Model Name',
        'temperature': 'Temperature',
        'max_tokens': 'Max Tokens',
        'is_active': 'Active?',
    }
    column_descriptions = {
        'provider': 'minimax, openai, openrouter, or anthropic',
        'api_base': 'Base URL for the API (e.g. https://api.minimax.io/v1)',
        'model': 'Model identifier (e.g. MiniMax-M2.7, gpt-4o, claude-3-opus)',
        'temperature': 'Creativity level: 0.0 = deterministic, 1.0 = creative (default 0.3)',
        'is_active': 'Only one LLM config should be active at a time',
    }
    form_args = {
        'api_key': {'description': 'Keep this secret. Required for API calls.'},
        'provider': {'description': 'Supported: minimax, openai, openrouter, anthropic'},
        'model': {'description': 'e.g. MiniMax-M2.7, gpt-4o, claude-3-opus'},
    }
    # Hide API key from list view for security
    column_exclude_list = ('api_key',)


class WhisperConfigView(MyModelView):
    column_labels = {
        'provider': 'Whisper Provider',
        'api_base': 'API Base URL',
        'api_key': 'API Key',
        'model': 'Model Name',
        'language': 'Language',
        'enabled': 'Enabled?',
    }
    column_descriptions = {
        'provider': 'openai, minimax, or local',
        'api_base': 'Base URL (e.g. https://api.openai.com/v1)',
        'model': 'Model name (default: whisper-1)',
        'language': 'ISO language code, or blank for auto-detect',
        'enabled': 'Enable/disable voice transcription globally',
    }
    form_args = {
        'api_key': {'description': 'Keep this secret. Required for transcription API calls.'},
        'language': {'description': 'e.g. "en", "ko", "ja", or blank for auto-detect'},
        'enabled': {'description': 'When enabled, voice chat audio is transcribed and shown as speech bubbles'},
    }
    # Hide API key from list view for security
    column_exclude_list = ('api_key',)


from metamuseum.models import User, LLMConfig, WhisperConfig


def create_app():
    app = Flask(__name__,
                 static_folder='static',
                 template_folder='templates')
    app.config.from_object(config)
    

    # ORM
    login_manager.init_app(app)
    mail.init_app(app)
    bcrypt.init_app(app)
    cors.init_app(app, support_credentials=True)


    # register blueprints
    from metamuseum.views import main_views
    from metamuseum.views import stream_views
    from metamuseum.views import marker_views
    from metamuseum.views import ar_companion_views
    from metamuseum.views import llm_layout
    from metamuseum.views import whisper_views
    from metamuseum import auth
    app.register_blueprint(main_views.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(stream_views.bp)
    app.register_blueprint(marker_views.bp)
    app.register_blueprint(ar_companion_views.bp)
    app.register_blueprint(llm_layout.bp)
    app.register_blueprint(whisper_views.bp)

    # Initialize SocketIO for AR companion (phone→Vision Pro relay)
    from metamuseum.core.ar_proxy import init_socketio
    sio = init_socketio(app)

    # Also init position sync using the same SocketIO instance
    from metamuseum.core.position_sync import init_socketio as init_pos_sync
    init_pos_sync(app, existing_sio=sio)
       
    # for admin page
    admin = Admin(app, name='MetaMuseum-admin', url='/kwanri')
    from metamuseum.elements.basic import Room, Wall, Image, GaussianSplat, GLTFmodel, Webpage, LocationPreset, Marker, RoomEffect
    admin.add_view(RoomView(Room))
    admin.add_view(WallView(Wall))
    admin.add_view(ImageView(Image))
    admin.add_view(GaussianSplatView(GaussianSplat))
    admin.add_view(GLTFmodelView(GLTFmodel))
    admin.add_view(WebpageView(Webpage))
    admin.add_view(LocationPresetView(LocationPreset))
    admin.add_view(RoomEffectView(RoomEffect))
    # endpoint must differ from public API blueprint name "marker" (marker_views.bp)
    admin.add_view(MarkerView(Marker, endpoint='mm_marker_admin'))
    admin.add_view(LLMConfigView(LLMConfig))
    admin.add_view(WhisperConfigView(WhisperConfig))


    return app

if __name__ == "__main__":
    # Only for debugging while developing
    app = create_app()
    app.run(host="0.0.0.0", port=80)

