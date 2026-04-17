import time
from collections import defaultdict
from threading import Lock
from flask import request, jsonify


class SimpleRateLimiter:
    def __init__(self):
        self._hits = defaultdict(list)
        self._lock = Lock()
    
    def is_allowed(self, key: str, max_hits: int, window_seconds: int) -> bool:
        now = time.time()
        with self._lock:
            self._hits[key] = [t for t in self._hits[key] if now - t < window_seconds]
            if len(self._hits[key]) >= max_hits:
                return False
            self._hits[key].append(now)
            return True


rate_limiter = SimpleRateLimiter()


def rate_limit(key: str, max_hits: int, window_seconds: int):
    """Simple decorator-based rate limiter."""
    def decorator(f):
        def wrapper(*args, **kwargs):
            if not rate_limiter.is_allowed(key, max_hits, window_seconds):
                return jsonify({'error': 'rate limit exceeded'}), 429
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator