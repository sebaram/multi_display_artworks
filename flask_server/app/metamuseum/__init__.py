# -*- coding: utf-8 -*-

from flask import Flask
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from flask_admin import Admin
from flask_admin.form import Select2Widget
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
    init_pos_sync(app)
       
    # for admin page
    admin = Admin(app, name='MetaMuseum-admin', url='/kwanri')
    from metamuseum.elements.basic import Room, Wall, Image, GaussianSplat, GLTFmodel, Webpage, LocationPreset, Marker
    admin.add_view(MyModelView(Room))
    admin.add_view(MyModelView(Wall))
    admin.add_view(MyModelView(Image))
    admin.add_view(MyModelView(GaussianSplat))
    admin.add_view(MyModelView(GLTFmodel))
    admin.add_view(MyModelView(Webpage))
    admin.add_view(MyModelView(LocationPreset))
    admin.add_view(MyModelView(Marker))
    admin.add_view(MyModelView(LLMConfig))
    admin.add_view(MyModelView(WhisperConfig))


    return app

if __name__ == "__main__":
    # Only for debugging while developing
    app = create_app()
    app.run(host="0.0.0.0", port=80)

