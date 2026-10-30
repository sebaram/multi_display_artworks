import json
import struct
from pathlib import Path
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]

def test_catalog_route_is_canonical_and_matches_real_glb(settings):
    from metamuseum.asgi import create_app
    from metamuseum.avatar_catalog import avatar_catalog
    # No lifespan/database required for a public static catalog.
    client = TestClient(create_app(settings))
    response = client.get('/api/v1/avatars/catalog')
    assert response.status_code == 200
    catalog = response.json()
    assert catalog == avatar_catalog()
    fixture = json.loads((ROOT / 'frontend/public/avatars/catalog.fixture.json').read_text())
    assert fixture == catalog
    presets = {p['id']: p for p in catalog['presets']}
    assert {'shiba', 'robot', 'rigged-simple', 'none'} <= presets.keys()
    humanoids = [p for p in presets.values() if p['kind'] == 'humanoid']
    assert len(humanoids) == 4
    raw = (ROOT / 'frontend/public/avatars/common-humanoid.glb').read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert (magic, version, length) == (0x46546C67, 2, len(raw))
    size, _ = struct.unpack_from('<II', raw, 12)
    model = json.loads(raw[20:20+size])
    for preset in humanoids:
        assert preset['assetUrl'] == '/avatars/common-humanoid.glb'
        assert [model['nodes'][j]['name'] for j in model['skins'][0]['joints']] == preset['coreBones']
        for name, rest in preset['restPose'].items():
            node = next(n for n in model['nodes'] if n['name'] == name)
            assert node['translation'] == rest['position']
        assert preset['headAnchor'] in [n['name'] for n in model['nodes']]
    assert len(model['skins'][0]['joints']) == 22
    assert {a['name'] for a in model['animations']} == {'idle', 'walk'}
    triangles = sum(model['accessors'][p['indices']]['count']//3 for m in model['meshes'] for p in m['primitives'])
    assert triangles <= 20000
    assert len(model['materials']) == 2
    body = model['meshes'][0]['primitives'][0]
    assert {'JOINTS_0', 'WEIGHTS_0'} <= body['attributes'].keys()

def test_generated_collar_overlaps_neck_without_a_background_gap():
    raw = (ROOT / 'frontend/public/avatars/common-humanoid.glb').read_bytes()
    size, _ = struct.unpack_from('<II', raw, 12)
    model = json.loads(raw[20:20+size])
    binary_offset = 20 + size + 8
    mesh = model['meshes'][0]
    accessor = model['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
    view = model['bufferViews'][accessor['bufferView']]
    values = struct.unpack_from('<'+'f'*(accessor['count']*3), raw, binary_offset+view.get('byteOffset',0))
    def ys(region):
        part = mesh['extras']['regions'][region]
        return values[part['start']*3+1:(part['start']+part['count'])*3:3]
    assert max(ys('torso')) >= min(ys('neck')), 'visible gap between shirt collar and neck'
