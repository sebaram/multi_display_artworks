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


def call_llm(system_prompt, user_prompt):
    """Call MiniMax API directly via requests (OpenAI-compatible)."""
    import requests
    import app.config as cfg

    api_key = cfg.MINIMAX_API_KEY
    if not api_key:
        return None, 'MINIMAX_API_KEY not configured'

    try:
        resp = requests.post(
            f'{cfg.MINIMAX_API_BASE}/chat/completions',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'MiniMax-M2.7',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                'temperature': 0.3,
                'max_tokens': 1024
            },
            timeout=30
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
