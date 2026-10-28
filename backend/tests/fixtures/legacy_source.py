"""Explicit archive path for historical capture tools, never runtime code."""
import os
from pathlib import Path


def legacy_root():
    value = os.environ.get('LEGACY_ROOT')
    if not value:
        raise RuntimeError('Set LEGACY_ROOT to flask_server/ from the pinned historical Git archive; see contracts/README.md')
    root = Path(value).resolve()
    if not (root / 'app/metamuseum/__init__.py').is_file():
        raise RuntimeError('LEGACY_ROOT does not contain the historical Flask application')
    return root
