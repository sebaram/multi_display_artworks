#!/usr/bin/env bash
#
# One-time setup of the production data root for metamuseum.
#
# Application code is baked into the image; this script stages the things that
# must NOT come from git — secrets, and the large media that MongoDB documents
# reference by path.
#
# Copies rather than moves, so the old tree at /var/www/metamuseum/app stays
# intact as a fallback. Safe to re-run.
#
# Usage:  bash scripts/init_host_data.sh

set -euo pipefail

OLD=/var/www/metamuseum/app
DATA=/var/www/metamuseum/data

if [[ ! -d $OLD ]]; then
    echo "error: $OLD not found — nothing to migrate" >&2
    exit 1
fi

echo "==> creating data root at $DATA"
mkdir -p "$DATA"/{static_image,static_splat,static_gltf,streams}

# --- media referenced from MongoDB, not from code --------------------------
#   GaussianSplat 'hail_splat' -> static/splat/hail.splat
#   Image 'matisse_danceI'     -> static/image/dance_i.jpg
#   GLTFmodel 'dance'          -> static/gltf/matisse_dance.glb
echo "==> copying DB-referenced media"
rsync -a "$OLD/metamuseum/static/image/" "$DATA/static_image/" 2>/dev/null || true
rsync -a "$OLD/metamuseum/static/splat/" "$DATA/static_splat/" 2>/dev/null || true
for f in matisse_dance.glb wheel.glb; do
    if [[ -f $OLD/metamuseum/static/gltf/$f ]]; then
        rsync -a "$OLD/metamuseum/static/gltf/$f" "$DATA/static_gltf/"
    fi
done

# Runtime scratch for streaming
mkdir -p "$DATA/streams"

# --- secrets ---------------------------------------------------------------
# config.py reads everything from the environment and ships with empty
# defaults, so this file is required for the container to work.
if [[ -f $DATA/metamuseum.env ]]; then
    echo "==> $DATA/metamuseum.env already exists — leaving it alone"
else
    echo "==> writing $DATA/metamuseum.env template"
    umask 077
    cat > "$DATA/metamuseum.env" <<'ENVEOF'
# Production secrets. Host-only — never commit.
MONGODB_URI=mongodb://USER:PASSWORD@mongo_container:27017/metamuseum?authMechanism=DEFAULT&authSource=admin
MONGODB_HOST=mongo_container
MONGODB_PORT=27017
MONGODB_DB=metamuseum
SECRET_KEY=change-me
SECURITY_PASSWORD_SALT=change-me
FLASK_ADMIN_SWATCH=cerulean
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=465
MAIL_USE_SSL=True
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_DEFAULT_SENDER=
TZ=Asia/Seoul
ENVEOF
    echo "!! fill in the real values in $DATA/metamuseum.env before deploying" >&2
fi

# The container runs as 'appuser', which debian-slim creates as the first
# regular account — uid/gid 1000, matching the host's ejuyoung.
echo "==> setting ownership to uid/gid 1000 (container 'appuser')"
chown -R 1000:1000 "$DATA" 2>/dev/null || \
    echo "   (skipped chown — re-run with sudo if the app cannot read its data)"
chmod -R u=rwX,g=rX,o= "$DATA/static_image" "$DATA/static_splat" "$DATA/static_gltf"
chmod -R u=rwX,g=rwX,o= "$DATA/streams"
chmod 640 "$DATA/metamuseum.env"

echo
echo "==> done. data root:"
du -sh "$DATA"/* 2>/dev/null | sed 's/^/    /'
echo
echo "Next: docker compose -f docker-compose.prod.yml up -d --build"
