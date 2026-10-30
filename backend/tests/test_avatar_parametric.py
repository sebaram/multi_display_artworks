import math
import pytest
from pydantic import ValidationError
from metamuseum.avatar_catalog import avatar_catalog
from metamuseum.schemas_avatar import AvatarAppearanceV2, normalize_appearance
from metamuseum.realtime.profile import normalize_profile

def look():
    return avatar_catalog()['presets'][0]['defaultAppearance']

def test_parametric_roundtrip_and_legacy_absence():
    value = look()
    assert 'parametric' not in AvatarAppearanceV2(**value).model_dump(exclude_none=True)
    value['parametric'] = {'model': 'smplx', 'betas': [0, .2, -10]}
    assert AvatarAppearanceV2(**value).model_dump(exclude_none=True)['parametric'] == value['parametric']
    assert normalize_appearance(value)['parametric'] == value['parametric']
    assert normalize_profile({'appearance': value})['appearance']['parametric'] == value['parametric']

@pytest.mark.parametrize('parametric', [
    {'model': 'other', 'betas': []}, {'model': 'smpl', 'betas': [True]},
    {'model': 'smpl', 'betas': [math.inf]}, {'model': 'smpl', 'betas': [math.nan]},
    {'model': 'smpl', 'betas': [10.1]}, {'model': 'smpl', 'betas': [0] * 301},
    {'model': 'smpl', 'betas': [], 'url': 'bad'}, {'model': 'smpl', 'betas': ['1']},
    {'model': 'smpl', 'betas': [10 ** 1000]},
])
def test_invalid_metadata_rejected_at_write_and_dropped_from_untrusted_profile(parametric):
    value = {**look(), 'parametric': parametric}
    with pytest.raises(ValidationError):
        AvatarAppearanceV2(**value)
    assert 'parametric' not in normalize_appearance(value)
