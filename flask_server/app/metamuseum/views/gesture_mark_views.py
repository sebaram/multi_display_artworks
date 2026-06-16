# -*- coding: utf-8 -*-
"""Gesture Mark — touchpoint streaming from watch to glasses/phone.

Provides:
  - /gesture-mark/test        → Input testing page with N targets and touchpoint canvas
  - /gesture-mark/stream      → SSE stream for touchpoint data (watch → display)
  - SocketIO events for real-time touchpoint relay

Architecture:
  Watch (touch source) → SocketIO/SSE → Glasses/Phone (display)
  The watch sends touchpoint data (x, y, type: start|trace|end).
  The display renders them on a watch-face canvas with in-trace-out visualization.
"""
from flask import Blueprint, render_template, request, jsonify, Response
import json
import time
import threading
from queue import Queue, Empty
import urllib.request
import logging

log = logging.getLogger(__name__)

bp = Blueprint('gesture_mark', __name__, url_prefix='/gesture-mark')

# ─── Global state ───
_touchpoint_queues = []  # list of Queue for SSE subscribers
_lock = threading.Lock()
_latest_touchpoints = []  # keep last gesture for late joiners
_gesture_result = ''  # last recognized gesture string

# GlassAI server relay config
_GLASSAI_RELAY_URL = None  # Set to 'http://host:8000' to relay touchpoints


def configure_glassai_relay(url):
    """Set the GlassAI server URL for touchpoint relay."""
    global _GLASSAI_RELAY_URL
    _GLASSAI_RELAY_URL = url.rstrip('/') if url else None


def _relay_to_glassai(data):
    """Async relay touchpoint/gesture data to GlassAI server."""
    if not _GLASSAI_RELAY_URL:
        return
    try:
        json_data = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{_GLASSAI_RELAY_URL}/api/gesture-mark/touchpoint",
            data=json_data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Best-effort relay


def broadcast_touchpoint(data):
    """Push a touchpoint to all SSE subscribers and relay to GlassAI."""
    global _latest_touchpoints
    with _lock:
        _latest_touchpoints.append(data)
        # Keep only last 500 points
        if len(_latest_touchpoints) > 500:
            _latest_touchpoints = _latest_touchpoints[-500:]
        dead = []
        for i, q in enumerate(_touchpoint_queues):
            try:
                q.put_nowait(data)
            except Exception:
                dead.append(i)
        for i in reversed(dead):
            _touchpoint_queues.pop(i)
    # Async relay to GlassAI
    threading.Thread(target=_relay_to_glassai, args=(data,), daemon=True).start()


def broadcast_gesture_result(result_str):
    """Push a recognized gesture result to all subscribers."""
    global _gesture_result
    global _gesture_result
    with _lock:
        _gesture_result = result_str
        data = {'datatype': 'gesture_result', 'result_str': result_str,
                'timestamp': time.time()}
        dead = []
        for i, q in enumerate(_touchpoint_queues):
            try:
                q.put_nowait(data)
            except Exception:
                dead.append(i)
        for i in reversed(dead):
            _touchpoint_queues.pop(i)


# ─── SocketIO handlers (registered by init function) ───
_socketio_registered = False


def init_gesture_mark_socketio(sio):
    """Register SocketIO handlers on the shared SocketIO instance."""
    global _socketio_registered
    if _socketio_registered:
        return
    _socketio_registered = True

    @sio.on('gesture_mark.join')
    def on_join(data):
        """Client joins the gesture mark room."""
        from flask_socketio import join_room
        join_room('gesture_mark')
        # Send latest state
        with _lock:
            sio.emit('gesture_mark.state', {
                'touchpoints': _latest_touchpoints[-100:],
                'gesture_result': _gesture_result
            }, room=request.sid)

    @sio.on('gesture_mark.touchpoint')
    def on_touchpoint(data):
        """Watch sends a touchpoint: {x, y, type, pressure?}."""
        point = {
            'x': data.get('x', 0),
            'y': data.get('y', 0),
            'type': data.get('type', 'trace'),  # start | trace | end
            'pressure': data.get('pressure', 0.5),
            'timestamp': time.time()
        }
        broadcast_touchpoint(point)
        # Relay via SocketIO to all display clients
        sio.emit('gesture_mark.touchpoint', point, room='gesture_mark',
                 skip_sid=request.sid)

    @sio.on('gesture_mark.gesture')
    def on_gesture(data):
        """Recognized gesture result from watch."""
        result_str = data.get('result_str', '')
        broadcast_gesture_result(result_str)
        sio.emit('gesture_mark.gesture', {
            'result_str': result_str,
            'timestamp': time.time()
        }, room='gesture_mark', skip_sid=request.sid)

    @sio.on('gesture_mark.target_select')
    def on_target_select(data):
        """Watch selected a target via gesture."""
        target_id = data.get('target_id')
        step = data.get('step', 0)
        sio.emit('gesture_mark.target_select', {
            'target_id': target_id,
            'step': step,
            'timestamp': time.time()
        }, room='gesture_mark', skip_sid=request.sid)

    @sio.on('gesture_mark.clear')
    def on_clear(data):
        """Clear all touchpoints (new gesture starting)."""
        global _latest_touchpoints
        with _lock:
            _latest_touchpoints.clear()
        sio.emit('gesture_mark.clear', {}, room='gesture_mark')


# ─── HTTP routes ───

@bp.route('/test')
def test_page():
    """Input testing page: show N targets and allow gesture selection."""
    num_targets = request.args.get('targets', 8, type=int)
    return render_template('gesture_mark_test.html', num_targets=num_targets)


@bp.route('/stream')
def sse_stream():
    """SSE stream for touchpoint data (fallback for non-SocketIO clients)."""
    q = Queue(maxsize=200)
    with _lock:
        _touchpoint_queues.append(q)

    def generate():
        try:
            while True:
                try:
                    data = q.get(timeout=30)
                    yield f"data: {json.dumps(data)}\n\n"
                except Empty:
                    # Keepalive
                    yield f": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _lock:
                try:
                    _touchpoint_queues.remove(q)
                except ValueError:
                    pass

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache',
                             'X-Accel-Buffering': 'no'})


@bp.route('/api/touchpoint', methods=['POST'])
def api_touchpoint():
    """HTTP POST endpoint for watch to send touchpoint data."""
    data = request.json
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    point = {
        'x': data.get('x', 0),
        'y': data.get('y', 0),
        'type': data.get('type', 'trace'),
        'pressure': data.get('pressure', 0.5),
        'timestamp': time.time()
    }
    broadcast_touchpoint(point)
    return jsonify({'status': 'ok'})


@bp.route('/api/gesture', methods=['POST'])
def api_gesture():
    """HTTP POST endpoint for recognized gesture."""
    data = request.json
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    result_str = data.get('result_str', '')
    broadcast_gesture_result(result_str)
    return jsonify({'status': 'ok', 'gesture': result_str})


@bp.route('/api/state')
def api_state():
    """Get current gesture mark state."""
    with _lock:
        return jsonify({
            'touchpoints': _latest_touchpoints[-100:],
            'gesture_result': _gesture_result
        })
