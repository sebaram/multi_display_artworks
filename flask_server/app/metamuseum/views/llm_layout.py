# -*- coding: utf-8 -*-
"""LLM-powered auto-layout for arranging artworks in a room."""
import json
import logging
from flask import Blueprint, request, jsonify
from flask_login import current_user
from metamuseum.elements.basic import Room, Wall, Image, GaussianSplat, WallElement

logger = logging.getLogger(__name__)
bp = Blueprint('llm_layout', __name__, url_prefix='/api')

SYSTEM_PROMPT = """You are an expert virtual gallery curator. Given a list of artworks and walls, arrange the artworks according to the curator's instructions.

You must respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "arrangements": [
    {"element_id": "id1", "wall_name": "target_wall_name", "position_x": 0.0, "position_y": 1.2, "position_z": 0.0},
    ...
  ],
  "explanation": "Brief description of the arrangement logic used."
}

Rules:
- position_y is height on wall (1.0-1.5m is eye level, 0.0 is bottom)
- position_x: horizontal position on the wall (-width/2 to +width/2 from center)
- position_z: depth offset from wall surface (usually 0)
- Match artworks to walls based on: style, period, theme, nationality, size
- Group related artworks together on the same wall
- Vary heights slightly for visual interest while keeping at comfortable viewing height
- Return ALL elements in the arrangements array"""


USER_PROMPT_TEMPLATE = """Curator's instruction: "{instruction}"

Walls available:
{walls}

Artworks to arrange:
{elements}

Respond with ONLY valid JSON."""


@bp.route('/auto-layout', methods=['POST'])
def auto_layout():
    """Arrange artworks in a room using natural language instructions via LLM."""
    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403

    data = request.json
    room_id = data.get('room_id')
    instruction = data.get('prompt', '').strip()

    if not room_id:
        return jsonify({'error': 'room_id required'}), 400
    if not instruction:
        return jsonify({'error': 'prompt/instruction required'}), 400

    # Get room
    room = Room.objects(_id=room_id).first()
    if not room:
        return jsonify({'error': 'Room not found'}), 404

    # Gather walls
    walls = Wall.objects(room=room_id)
    wall_list = []
    for w in walls:
        wall_list.append({
            'name': w.name,
            'position': f'{w.position_x} {w.position_y} {w.position_z}',
            'width': getattr(w, 'width', 3.0),
            'height': getattr(w, 'height', 2.0),
            'rotation': f'{getattr(w, "rotation_x", 0)} {getattr(w, "rotation_y", 0)} {getattr(w, "rotation_z", 0)}'
        })

    # Gather images and gaussian splats
    elements = []
    for wall in walls:
        for ele in WallElement.objects(wall=wall):
            if ele.wall_element_type in ('image', 'gaussiansplat'):
                elements.append({
                    'id': str(ele._id),
                    'name': getattr(ele, 'name', 'Untitled'),
                    'type': ele.wall_element_type,
                    'wall_name': wall.name,
                    'description': getattr(ele, 'description', '') or getattr(ele, 'name', '')
                })

    if not elements:
        return jsonify({'error': 'No placeable elements found in room'}), 400

    # Build prompt
    walls_str = '\n'.join(
        f"- {w['name']}: at position ({w['position']}), size {w['width']}m wide x {w['height']}m tall"
        for w in wall_list
    )
    elements_str = '\n'.join(
        f"- {e['name']} ({e['type']}, current wall: {e['wall_name']})"
        for e in elements
    )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        instruction=instruction,
        walls=walls_str,
        elements=elements_str
    )

    # Call LLM
    arrangements, explanation = call_llm(SYSTEM_PROMPT, user_prompt)

    if arrangements is None:
        return jsonify({'error': explanation}), 500

    return jsonify({
        'arrangements': arrangements,
        'explanation': explanation
    })


EFFECTS_SYSTEM_PROMPT = """You are an expert virtual gallery curator controlling visual and audio effects.

You control these effect types:
- glitter: particle sparkles that float in the room. params: density (1-100), color (hex), duration (seconds)
- spotlight: focused light beam on a specific artwork. params: target_id, intensity (0-1), color (hex)
- ambient: change room lighting atmosphere. params: type (warm|cool|dramatic|subtle), intensity (0-1)
- fog: add atmospheric depth fog. params: density (0-1), color (hex)
- sound: play ambient audio. params: url (audio file URL), volume (0-1), loop (bool)
- pulse: pulsing glow effect on an artwork. params: target_id, color (hex), speed (slow|medium|fast)
- color_shift: tint the room lighting. params: color (hex), intensity (0-1)
- shake: camera shake effect. params: intensity (0.1-1.0), duration (seconds)
- fade: fade in/out effect. params: type (in|out), duration (seconds)

You respond with ONLY valid JSON:
{
  "effects": [
    {"effect_type": "spotlight", "target_id": "element_id_or_empty", "params": {"intensity": 0.8, "color": "#FFFF88"}, "description": "Focus light on the portrait"},
    {"effect_type": "ambient", "target_id": "", "params": {"type": "dramatic", "intensity": 0.6}, "description": "Dramatic spotlight atmosphere"}
  ],
  "explanation": "brief explanation"
}

Rules:
- Do NOT invent new effect types beyond the ones listed
- target_id can be empty string if effect applies to whole room
- Use element names or IDs from the provided list
- Keep effects simple and impactful — 2-4 effects max
- duration/fade effects auto-expire
- Respond with ONLY JSON (no markdown, no explanation)
"""

EFFECTS_USER_TEMPLATE = """Curator's instruction: "{instruction}"

Room: {room_name}
All elements in this room:
{elements}

Available walls:
{walls}

Respond with ONLY valid JSON."""


@bp.route('/apply-layout', methods=['POST'])
def apply_layout():
    """Apply LLM-generated layout to elements (update positions in DB)."""
    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403

    data = request.json
    arrangements = data.get('arrangements', [])

    if not arrangements:
        return jsonify({'error': 'arrangements required'}), 400

    results = []
    for arr in arrangements:
        element_id = arr.get('element_id')
        wall_name = arr.get('wall_name')
        px = arr.get('position_x', 0)
        py = arr.get('position_y', 1.2)
        pz = arr.get('position_z', 0)

        try:
            ele = WallElement.objects(_id=element_id).first()
            if not ele:
                results.append({'id': element_id, 'status': 'not_found'})
                continue

            # Update position fields
            ele.position_x = px
            ele.position_y = py
            ele.position_z = pz
            ele.save()
            results.append({'id': element_id, 'status': 'ok'})
        except Exception as e:
            logger.error(f'Error applying layout to {element_id}: {e}')
            results.append({'id': element_id, 'status': 'error', 'msg': str(e)})

    return jsonify({'results': results})


@bp.route('/auto-effect', methods=['POST'])
def auto_effect():
    """Trigger visual/audio effects in a room using natural language via LLM."""
    from bson import ObjectId
    from datetime import datetime, timedelta

    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403

    data = request.json
    room_id = data.get('room_id')
    instruction = data.get('prompt', '').strip()

    if not room_id:
        return jsonify({'error': 'room_id required'}), 400
    if not instruction:
        return jsonify({'error': 'prompt/instruction required'}), 400

    room = Room.objects(_id=room_id).first()
    if not room:
        return jsonify({'error': 'Room not found'}), 404

    # Gather all elements in room
    walls = Wall.objects(room=room_id)
    elements = []
    for wall in walls:
        for ele in WallElement.objects(wall=wall):
            elements.append({
                'id': str(ele._id),
                'name': getattr(ele, 'name', ''),
                'type': ele.wall_element_type,
                'wall_name': wall.name
            })

    wall_list = '\n'.join(f"- {w.name}" for w in walls)
    elements_str = '\n'.join(f"- {e['name']} ({e['type']})" for e in elements)

    user_prompt = EFFECTS_USER_TEMPLATE.format(
        instruction=instruction,
        room_name=room.name,
        elements=elements_str,
        walls=wall_list
    )

    effect_list, explanation = call_llm(EFFECTS_SYSTEM_PROMPT, user_prompt)

    if effect_list is None:
        return jsonify({'error': explanation}), 500

    # Store effects in DB
    from metamuseum.elements.basic import RoomEffect
    results = []
    for fx in effect_list:
        effect_type = fx.get('effect_type')
        if effect_type not in RoomEffect.EFFECT_TYPES:
            continue

        target_id = fx.get('target_id', '')
        params = fx.get('params', {})
        desc = fx.get('description', '')

        # Auto-expire duration-based effects
        duration = params.get('duration')
        expires_at = None
        if duration:
            expires_at = datetime.utcnow() + timedelta(seconds=int(duration))

        effect = RoomEffect(
            room=room,
            effect_type=effect_type,
            target_id=target_id,
            params=params,
            description=desc,
            created_by=current_user.username if current_user.is_authenticated else 'admin',
            expires_at=expires_at,
            active=True
        )
        effect.save()
        results.append(effect.to_dict())

    # Broadcast active effects to all users in room
    try:
        from metamuseum.core.position_sync import socketio
        socketio.emit('room_effects', {
            'room_id': room_id,
            'effects': RoomEffect.get_active_for_room(room_id).to_json() if hasattr(RoomEffect.get_active_for_room(room_id), 'to_json') else [r.to_dict() for r in results]
        }, room=room_id)
    except Exception as e:
        logger.warning(f'Could not broadcast effects: {e}')

    return jsonify({
        'effects': results,
        'explanation': explanation
    })


@bp.route('/clear-effects', methods=['POST'])
def clear_effects():
    """Clear all active effects in a room."""
    from bson import ObjectId
    if not current_user.is_authenticated or not current_user.is_admin():
        return jsonify({'error': 'Admin required'}), 403

    room_id = request.json.get('room_id') if request.is_json else request.form.get('room_id')
    if not room_id:
        return jsonify({'error': 'room_id required'}), 400

    from metamuseum.elements.basic import RoomEffect
    RoomEffect.clear_room(room_id)

    try:
        from metamuseum.core.position_sync import socketio
        socketio.emit('room_effects_cleared', {'room_id': room_id}, room=room_id)
    except Exception:
        pass

    return jsonify({'status': 'ok'})


def call_llm(system_prompt, user_prompt):
    """Call LLM using active config from MongoDB (supports any OpenAI-compatible provider)."""
    import requests
    from metamuseum.models import LLMConfig

    config = LLMConfig.get_active()
    if not config:
        return None, 'No LLM config set. Add one via Flask-Admin (LLMConfig model) or set MINIMAX_API_KEY env var.'

    api_key = config.api_key
    api_base = config.api_base
    model = config.model

    if not api_key:
        return None, 'LLM API key not configured'

    try:
        resp = requests.post(
            f'{api_base.rstrip("/")}/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': model,
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                'temperature': config.temperature,
                'max_tokens': config.max_tokens
            },
            timeout=60
        )
        resp.raise_for_status()
        data = resp.json()
        content = data['choices'][0]['message']['content'].strip()

        # Strip markdown code blocks if present
        if content.startswith('```'):
            lines = content.split('\n')
            content = '\n'.join(lines[1:-1])

        result = json.loads(content)
        arrangements = result.get('arrangements', [])
        explanation = result.get('explanation', '')
        return arrangements, explanation

    except json.JSONDecodeError as e:
        logger.error(f'LLM returned invalid JSON: {e}\nContent: {content[:500]}')
        return None, f'LLM returned invalid JSON: {e}'
    except Exception as e:
        logger.error(f'LLM call failed: {e}')
        return None, str(e)
