"""Canonical, public avatar allowlist. Coordinates are meters, Y up, forward -Z."""
from copy import deepcopy
import os
from pathlib import Path

RIG_VERSION = 'humanoid-v1'
# Ordered parent-relative bind offsets; identity bind rotations, no scale.
CORE_RIG = [
    ('hips', None, [0, .92, 0]), ('spine', 'hips', [0, .16, 0]),
    ('chest', 'spine', [0, .16, 0]), ('upperChest', 'chest', [0, .12, 0]),
    ('neck', 'upperChest', [0, .10, 0]), ('head', 'neck', [0, .10, 0]),
    ('leftShoulder', 'upperChest', [-.16, 0, 0]), ('leftUpperArm', 'leftShoulder', [-.08, 0, 0]),
    ('leftLowerArm', 'leftUpperArm', [0, -.28, 0]), ('leftHand', 'leftLowerArm', [0, -.25, 0]),
    ('rightShoulder', 'upperChest', [.16, 0, 0]), ('rightUpperArm', 'rightShoulder', [.08, 0, 0]),
    ('rightLowerArm', 'rightUpperArm', [0, -.28, 0]), ('rightHand', 'rightLowerArm', [0, -.25, 0]),
    ('leftUpperLeg', 'hips', [-.10, -.02, 0]), ('leftLowerLeg', 'leftUpperLeg', [0, -.42, 0]),
    ('leftFoot', 'leftLowerLeg', [0, -.40, 0]), ('leftToes', 'leftFoot', [0, -.03, -.14]),
    ('rightUpperLeg', 'hips', [.10, -.02, 0]), ('rightLowerLeg', 'rightUpperLeg', [0, -.42, 0]),
    ('rightFoot', 'rightLowerLeg', [0, -.40, 0]), ('rightToes', 'rightFoot', [0, -.03, -.14]),
]
LEGACY = {
    'shiba': dict(label='Shiba', kind='gltf', assetUrl='/static/gltf/shiba/scene.gltf'),
    'robot': dict(label='Robot', kind='primitive', assetUrl=None),
    'rigged-simple': dict(label='Rigged Simple', kind='gltf', assetUrl='/static/gltf/rigged-simple/RiggedSimple.glb'),
    'none': dict(label='None', kind='none', assetUrl=None),
}

def avatar_catalog():
    presets = []
    for identifier, label, colors, hair, hat, glasses in [
        ('casual', 'Casual', ['#DDA477', '#4587C4', '#26364D', '#402D24', '#292B34'], 'short', 'none', 'none'),
        ('sporty', 'Sporty', ['#B87B55', '#E86B50', '#202D36', '#222222', '#252B32'], 'short', 'cap', 'none'),
        ('explorer', 'Explorer', ['#EDBD94', '#8B9B5B', '#6A5843', '#643D26', '#374532'], 'short', 'cap', 'round'),
        ('humanoid-robot', 'Humanoid Robot', ['#B6CFD5', '#758C9E', '#394C60', '#334656', '#4ED4DA'], 'none', 'none', 'none'),
    ]:
        presets.append(dict(
            id=identifier, label=label, kind='humanoid', assetUrl='/avatars/common-humanoid.glb',
            thumbnail='/avatars/humanoid-thumbnail.svg', rigVersion=RIG_VERSION,
            coreBones=[b[0] for b in CORE_RIG], rigMap={b[0]: b[0] for b in CORE_RIG},
            restPose={name: dict(parent=parent, position=position, orientation=[0, 0, 0, 1]) for name, parent, position in CORE_RIG},
            materialSlots={'skin': 'Body', 'top': 'Body', 'bottom': 'Body', 'hair': 'Attachments', 'eyes': 'Body'},
            headAnchor='HeadAnchor', capabilities=dict(colors=True, face=True, hair=True, accessories=True, fullBody=True),
            budgets=dict(triangles=20000, bones=70, bodyMaterials=2, accessoryMaterials=2, textureSize=1024),
            options=dict(faceId=['friendly', 'calm'], hairId=['none', 'short'], hatId=['none', 'cap'], glassesId=['none', 'round']),
            compatibility={'cap': {'hides': ['short']}},
            defaultAppearance=dict(schemaVersion=2, presetId=identifier, colors=dict(zip(['skin', 'top', 'bottom', 'hair', 'eyes'], colors)), faceId='friendly', hairId=hair, hatId=hat, glassesId=glasses),
        ))
    for identifier, legacy in LEGACY.items():
        presets.append(dict(id=identifier, **legacy, thumbnail=None, rigVersion=None, coreBones=[], rigMap={}, restPose={}, materialSlots={}, headAnchor=None,
                            capabilities=dict(colors=identifier == 'robot', face=False, hair=False, accessories=False, fullBody=False), budgets=None, options={}, compatibility={}, defaultAppearance=None))
    # Private demo assets are opt-in and never part of a production catalog/build.
    native_root = os.environ.get('GAUSSIAN_AVATAR_ROOT')
    if (native_root and os.environ.get('ENVIRONMENT', 'development') != 'production'
            and all((Path(native_root) / name).is_file() for name in ['manifest.json', 'rig.bin', 'point_cloud.ply'])):
        native = deepcopy(presets[0])
        native.update(id='gaussian-306', label='GaussianAvatars 306 · Local research bust',
                      nativeGaussian='subject-306', thumbnail=None,
                      capabilities=dict(colors=False, face=False, hair=False, accessories=False, fullBody=False),
                      options=dict(faceId=['none'], hairId=['none'], hatId=['none'], glassesId=['none']), compatibility={})
        native['defaultAppearance'].update(presetId='gaussian-306', faceId='none', hairId='none', hatId='none', glassesId='none')
        native['budgets']['gaussians'] = 89021
        presets.append(native)
    return deepcopy(dict(schemaVersion=2, presets=presets))
