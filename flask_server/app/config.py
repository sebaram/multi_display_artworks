# -*- coding: utf-8 -*-
"""
Created on Fri May 14 17:50:33 2021

@author: kctm
"""
import os




MONGODB_SETTINGS = {"host":'ask_juyoung_for_this'}
MONGODB_CONNECT = False

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


print("BASE_DIR: ",BASE_DIR)

