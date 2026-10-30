# Original humanoid v1

The model, thumbnail, and generator were created for MetaMuseum on 2026-10-30.
No downloaded model, scan, likeness, texture, or third-party character was used.
These original assets and generator are dedicated to the public domain under
CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/

Reproduce from repository root: `.venv/Scripts/python.exe tools/avatars/generate_humanoid.py`.
The generator uses Python's standard library and the canonical server rig/catalog.
`catalog.fixture.json` is a generated test fixture, never the runtime catalog.

`common-humanoid.glb` is glTF 2.0, meters, Y up, forward -Z, identity bind
rotations and unit scale. Its 22 core bones and parent offsets are frozen in
`backend/metamuseum/avatar_catalog.py`. The body is an actual weighted
SkinnedMesh; accessories attach to HeadAnchor under the head bone. Body uses
one material and accessories share one additional material. Palette bands in
TEXCOORD_0.x select skin/top/bottom/hair/eyes via instance material uniforms.
The shared 1px white texture contains no external data. All source meshes
are original tapered ring surfaces. Idle/walk clips are included as a starting
point; owner-side motion/IK arrives in later tasks. `asset-inspection.json`
records generated budgets. Normals are calculated by the runtime loader adapter.
