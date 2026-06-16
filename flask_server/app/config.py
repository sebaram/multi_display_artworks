# -*- coding: utf-8 -*-
"""Flask config — reads all sensitive values from environment variables."""
import os

# ─── MongoDB ─────────────────────────────────────────────────────────────────
# Full URI takes precedence (supports auth, replica sets, etc.)
MONGODB_URI = os.environ.get('MONGODB_URI', '')
MONGODB_HOST = os.environ.get('MONGODB_HOST', 'localhost')
MONGODB_PORT = int(os.environ.get('MONGODB_PORT', 27017))
MONGODB_DB = os.environ.get('MONGODB_DB', 'metamuseum')
# In-memory DB for tests / seed scripts
MONGODB_USE_MOCK = os.environ.get('MONGODB_MOCK', 'false').lower() == 'true'

# ─── Flask ───────────────────────────────────────────────────────────────────
DEFAULT_TITLE = "MetaMuseum"
BASE_DIR = os.getcwd()
SECRET_KEY = os.environ.get('SECRET_KEY', 'change-me-in-production')
SECURITY_PASSWORD_SALT = os.environ.get('SECURITY_PASSWORD_SALT', 'change-me-in-production')
FLASK_ADMIN_SWATCH = os.environ.get('FLASK_ADMIN_SWATCH', 'cerulean')

# ─── Email ───────────────────────────────────────────────────────────────────
MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
MAIL_PORT = int(os.environ.get('MAIL_PORT', 465))
MAIL_USE_SSL = os.environ.get('MAIL_USE_SSL', 'True') == 'True'
MAIL_USERNAME = os.environ.get('MAIL_USERNAME', '')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD', '')
MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER', MAIL_USERNAME)

# ─── LLM & Whisper ───────────────────────────────────────────────────────────
# Keys are set via Flask-Admin → LLMConfig / WhisperConfig (stored in MongoDB)
MINIMAX_API_KEY = os.environ.get('MINIMAX_API_KEY', '')
MINIMAX_API_BASE = 'https://api.minimax.io/v1'

# ─── Avatar ──────────────────────────────────────────────────────────────────
AVATAR_OPTIONS = {
    'shiba': {'name': 'Shiba Dog', 'model': None},
    'robot': {'name': 'Robot', 'model': None},
    'none': {'name': 'No Avatar', 'model': None},
}

print("BASE_DIR: ", BASE_DIR)
