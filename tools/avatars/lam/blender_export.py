"""Blender 4.4 equivalent of LAM's tools/convertFBX2GLB.py (Apache-2.0).

The old export_colors argument was removed. These options preserve the skin and
ARKit shape keys used by the official browser SDK.
"""
from pathlib import Path
import sys
import bpy

source, target = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB',
    export_skins=True, export_texcoords=False, export_normals=False,
    export_vertex_color='NONE')
if not target.is_file():
    raise RuntimeError('GLB export produced no file')
