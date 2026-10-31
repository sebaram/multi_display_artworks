"""Pure trust-boundary checks: no Mongo fixtures or device access."""
import json
from pathlib import Path
import struct
import subprocess

import pytest

from metamuseum.avatar_catalog import avatar_catalog
from metamuseum.avatar_gaze import DEFAULT, normalize_gaze_config
from metamuseum.schemas_avatar import AvatarAppearanceV2, normalize_appearance, validate_avatar_pose


def packet():
    numbers = [0.] * 98
    for i in [6, *range(13, 98, 4)]:
        numbers[i] = 1
    return dict(version=2, rigVersion='humanoid-v1', sequence=0, sampleTime=0, bodyScale=1,
                tracking=dict(head=True, left=False, right=False), teleport=False,
                floats=struct.pack('<98f', *numbers))


def test_optional_gaze_roundtrip_and_legacy_profile():
    appearance = avatar_catalog()['presets'][0]['defaultAppearance']
    assert AvatarAppearanceV2.model_validate(appearance).model_dump(exclude_none=True) == appearance
    look = {**appearance, 'gaze': {'coneDegrees': 80}}
    canonical = AvatarAppearanceV2.model_validate(look).model_dump(exclude_none=True)
    assert canonical['gaze'] == {**DEFAULT, 'coneDegrees': 80}
    assert normalize_appearance(canonical) == canonical
    p = packet()
    assert validate_avatar_pose(p) == p
    p['gaze'] = dict(version=1, source='procedural', yaw=.3, pitch=-.1)
    assert validate_avatar_pose(p) == p
    assert len(p['floats']) == 392


@pytest.mark.parametrize('gaze', [None, {}, dict(version=True, source='procedural', yaw=0, pitch=0),
    dict(version=1, source='sensor', yaw=0, pitch=0),
    dict(version=1, source='procedural', yaw=float('nan'), pitch=0),
    dict(version=1, source='procedural', yaw=2, pitch=0),
    dict(version=1, source='procedural', yaw=0, pitch=0, targetId='private')])
def test_invalid_pose_gaze_rejected(gaze):
    assert validate_avatar_pose({**packet(), 'gaze': gaze}) is None


@pytest.mark.parametrize('config', [{'version': True}, {'coneDegrees': float('nan')}, {'coneDegrees': 161},
    {'weights': {'surprise': 1}}, {'weights': {'person': True}}, {'seed': .1},
    {'minFixationMs': 1000, 'maxFixationMs': 100}, {'unsupported': 1}, {'seed': 10**400}])
def test_invalid_profile_gaze_rejected(config):
    with pytest.raises(ValueError):
        normalize_gaze_config(config, strict=True)


def test_frontend_backend_defaults_and_canonical_config_match():
    root = Path(__file__).resolve().parents[2]
    script = "import {normalizeGazeConfig} from './frontend/src/avatar/gaze-config.js'; console.log(JSON.stringify([{}, {coneDegrees:80,weights:{speaking:2}},{mode:'forward'}].map(x=>normalizeGazeConfig(x,true))))"
    result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root, capture_output=True, text=True, check=True)
    values = [{}, dict(coneDegrees=80, weights=dict(speaking=2)), dict(mode='forward')]
    assert json.loads(result.stdout) == [normalize_gaze_config(v, strict=True) for v in values]
