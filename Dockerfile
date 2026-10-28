# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS web
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app \
    FRONTEND_ROOT=/app/web MEDIA_ROOT=/app/metamuseum/static \
    WALL_MEDIA_ROOT=/app/wall_media STREAM_ROOT=/app/streams
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home appuser
COPY backend/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock
COPY backend/metamuseum/ ./metamuseum/
COPY scripts/import_wall_presets.py ./scripts/import_wall_presets.py
COPY --from=web /build/dist/ ./web/
RUN mkdir -p wall_media streams && chown -R appuser:appuser wall_media streams
USER appuser
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health',timeout=5)"
# The room cache and pointer coalescer deliberately have a single process owner.
CMD ["uvicorn", "metamuseum.asgi:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "1", "--proxy-headers"]
