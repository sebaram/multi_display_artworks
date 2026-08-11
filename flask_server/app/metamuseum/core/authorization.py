"""Authorization helpers shared by JSON API routes."""

from functools import wraps

from flask import jsonify
from flask_login import current_user


def admin_required(view):
    """Require an authenticated administrator and return a JSON denial."""
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin():
            return jsonify({"error": "Admin required"}), 403
        return view(*args, **kwargs)

    return wrapped_view
