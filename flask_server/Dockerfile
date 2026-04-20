# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV STATIC_PATH=/app/static

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && \
    pip install -r /tmp/requirements.txt

# Copy application (exclude config.py — use config.py.example and set env vars)
COPY app /app

# Copy config example — actual config must come from env vars or secrets manager
COPY app/config.py.example /app/config.py.example

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

# Production: pass config via environment variables
#   MONGODB_HOST, MONGODB_PORT, MONGODB_DB
#   SECRET_KEY, SECURITY_PASSWORD_SALT
#   MAIL_USERNAME, MAIL_PASSWORD
#   MINIMAX_API_KEY
CMD ["python", "-c", "from app import create_app; app = create_app(); from metamuseum.core.position_sync import init_socketio; init_socketio(app)"]
