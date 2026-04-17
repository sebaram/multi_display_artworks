# -*- coding: utf-8 -*-
"""
Created on Fri May 14 17:50:33 2021

@author: kctm
"""
import os



MONGODB_HOST = os.environ.get('MONGODB_HOST', 'localhost')
MONGODB_PORT = int(os.environ.get('MONGODB_PORT', 27017))
MONGODB_DB = os.environ.get('MONGODB_DB', 'metamuseum')

DEFAULT_TITLE = "MetaMuseum"

BASE_DIR = os.getcwd()

SQLALCHEMY_TRACK_MODIFICATIONS = False
SECRET_KEY = "something only you know"
SECURITY_PASSWORD_SALT = "something only you know"

FLASK_ADMIN_SWATCH = 'cerulean'


MAIL_SERVER = 'smtp.gmail.com'
MAIL_PORT = 465
MAIL_USE_SSL = True
MAIL_USERNAME = 'ejuyoung@gmail.com'
MAIL_PASSWORD = 'something only you know'
MAIL_DEFAULT_SENDER = 'ejuyoung@gmail.com'


AVATAR_OPTIONS = {
    'shiba': {'name': 'Shiba Dog', 'model': None},
    'robot': {'name': 'Robot', 'model': None},
    'none': {'name': 'No Avatar', 'model': None},
}

print("BASE_DIR: ",BASE_DIR)

