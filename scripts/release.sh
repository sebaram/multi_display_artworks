#!/usr/bin/env bash
# Host-only release operations. Never enable shell tracing: backups contain secrets.
set -euo pipefail
set +x
umask 077
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [[ ${1:-} == inventory ]]; then
    shift
    exec python3 "$HERE/release/inventory.py" "$@"
fi
exec python3 "$HERE/release/operate.py" "$@"
