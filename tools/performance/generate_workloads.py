"""Deterministic, synthetic app workloads; never resets/deletes Mongo databases.

Run with .venv_legacy/Scripts/python.exe tools/performance/generate_workloads.py
Assets/manifest are generated locally by default. Add --seed to insert/update only
owned performance documents after the existing isolated-instance guard succeeds.
Serve the fixtures directory on 127.0.0.1:8767 with CORS enabled for texture loads.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/playwright/performance"
FIXTURES = OUTPUT / "fixtures"
DATABASE = "metamuseum_perf_20261029"
PREFIX = "perf20261029-"
MEDIA_ORIGIN = "http://127.0.0.1:8767"
FIXED_TIME = datetime(2026, 10, 29)
WALL_HEIGHT = 6.0
TEXTURE_SIZE = 1024
SPLAT_POINTS = 100_000
SPHERE_SEGMENTS = 72
FFMPEG = ROOT / ".venv_legacy/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"


def oid(label):
    from bson import ObjectId
    return ObjectId(hashlib.sha256((PREFIX + label).encode()).hexdigest()[:24])


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def make_png(index):
    """Actual distinct RGB pixels; moderate compressibility, fixed decoded size."""
    rows = []
    for tile_y in range(32):
        row = bytearray(b"\0")
        for tile_x in range(32):
            value = hashlib.sha256(struct.pack("<III", index, tile_x, tile_y)).digest()
            row.extend(bytes(48 + channel % 192 for channel in value[:3]) * 32)
        rows.extend([bytes(row)] * 32)
    ihdr = struct.pack(">IIBBBBB", TEXTURE_SIZE, TEXTURE_SIZE, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(b"".join(rows), 6)) + png_chunk(b"IEND", b"")


def make_glb():
    positions, normals, colors, indices = [], [], bytearray(), []
    n = SPHERE_SEGMENTS
    for row in range(n + 1):
        latitude = math.pi * row / n
        for column in range(n + 1):
            longitude = math.tau * column / n
            x = math.sin(latitude) * math.cos(longitude)
            y = math.cos(latitude)
            z = math.sin(latitude) * math.sin(longitude)
            positions.extend((x * .5, y * .5, .55 + z * .5))
            normals.extend((x, y, z))
            colors.extend((round((x + 1) * 110) + 25, round((y + 1) * 110) + 25, round((z + 1) * 110) + 25, 255))
    for row in range(n):
        for column in range(n):
            a = row * (n + 1) + column
            b = a + n + 1
            if row:
                indices.extend((a, a + 1, b))
            if row < n - 1:
                indices.extend((a + 1, b + 1, b))
    chunks = [struct.pack(f"<{len(positions)}f", *positions), struct.pack(f"<{len(normals)}f", *normals), bytes(colors), struct.pack(f"<{len(indices)}H", *indices)]
    offsets, binary = [], bytearray()
    for chunk in chunks:
        while len(binary) % 4:
            binary.append(0)
        offsets.append(len(binary))
        binary.extend(chunk)
    count = (n + 1) ** 2
    document = {
        "asset": {"version": "2.0", "generator": "Synthetic performance fixture"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": .7}, "doubleSided": False}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [{"buffer": 0, "byteOffset": offset, "byteLength": len(chunk), "target": 34963 if i == 3 else 34962} for i, (offset, chunk) in enumerate(zip(offsets, chunks))],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": count, "type": "VEC3", "min": [-.5, -.5, .05], "max": [.5, .5, 1.05]},
            {"bufferView": 1, "componentType": 5126, "count": count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5121, "normalized": True, "count": count, "type": "VEC4"},
            {"bufferView": 3, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
        ],
    }
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    length = 12 + 8 + len(encoded) + 8 + len(binary)
    data = struct.pack("<III", 0x46546C67, 2, length) + struct.pack("<I4s", len(encoded), b"JSON") + encoded + struct.pack("<I4s", len(binary), b"BIN\0") + binary
    return data, {"vertices": count, "triangles": len(indices) // 3, "mesh_primitives": 1}


def make_splat():
    """32-byte .splat records: xyz, scale, RGBA, normalized quaternion wxyz."""
    rng = random.Random(20261029)
    data = bytearray()
    bounds = [[math.inf, -math.inf] for _ in range(3)]
    for i in range(SPLAT_POINTS):
        y = 1 - 2 * (i + .5) / SPLAT_POINTS
        phi = i * math.pi * (3 - math.sqrt(5))
        radius = .46 * (0.78 + .22 * rng.random())
        x = radius * math.sqrt(1 - y * y) * math.cos(phi)
        z = radius * math.sqrt(1 - y * y) * math.sin(phi)
        y *= radius
        # The checked-in renderer negates source Z when reading .splat records.
        source_z = -(.55 + z)
        for axis, value in enumerate((x, y, source_z)):
            bounds[axis][0] = min(bounds[axis][0], value)
            bounds[axis][1] = max(bounds[axis][1], value)
        scale = .0045 + .0015 * rng.random()
        color = (round((x / .46 + 1) * 100) + 40, round((y / .46 + 1) * 100) + 40, round((z / .46 + 1) * 100) + 40, 220)
        data.extend(struct.pack("<6f8B", x, y, source_z, scale, scale, scale, *color, 255, 128, 128, 128))
    return bytes(data), {"points": SPLAT_POINTS, "record_bytes": 32, "source_bounds": bounds, "renderer_local_bounds": [[bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1]], [-bounds[2][1], -bounds[2][0]]], "cutout_scale": "1.2 1.2 1.2", "cutout_position": "0 0 0.55"}


def write_asset(relative, data, kind, **characteristics):
    path = FIXTURES / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"path": relative, "url": f"{MEDIA_ORIGIN}/{relative}", "type": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), **characteristics}


def make_video(width, height):
    path = FIXTURES / f"video-{width}x{height}-30fps-crf26.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    # The owned filename pins the encoding settings; completed files are reusable.
    if not path.exists():
        temporary = path.with_suffix(".encoding.mp4")
        command = [str(FFMPEG), "-hide_banner", "-loglevel", "error", "-y", "-filter_threads", "2", "-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate=30", "-t", "6", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "26", "-pix_fmt", "yuv420p", "-threads", "4", "-movflags", "+faststart", str(temporary)]
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        temporary.replace(path)
    return write_asset(path.name, path.read_bytes(), "video", width=width, height=height, frames_per_second=30, duration_seconds=6, codec="H264", pixel_format="yuv420p", audio=False, source="FFmpeg lavfi testsrc2 moving pattern", encoding={"encoder": "libx264", "preset": "fast", "crf": 26, "threads": 4}, usage="Shared source URL; separate muted looping HTMLVideoElement per video wall")


def make_assets():
    result = [write_asset("images/shared-1024.png", make_png(0), "image", width=TEXTURE_SIZE, height=TEXTURE_SIZE, distinct_pixels=True)]
    for index in range(300):
        result.append(write_asset(f"images/unique-{index:03d}-1024.png", make_png(index + 1), "image", width=TEXTURE_SIZE, height=TEXTURE_SIZE, distinct_pixels=True))
    glb, shape = make_glb()
    result.append(write_asset("models/sphere-10224-triangles.glb", glb, "gltf", **shape))
    splat, shape = make_splat()
    result.append(write_asset("splats/cloud-100000.splat", splat, "gaussian_splat", **shape))
    result.append(write_asset("video.mp4", (ROOT / "frontend/tests/fixtures/media/video.mp4").read_bytes(), "video", source="frontend/tests/fixtures/media/video.mp4", width=160, height=90, frames_per_second=24, duration_seconds=6, usage="Shared URL across video walls; each wall creates a separate HTMLVideoElement"))
    result.extend((make_video(1920, 1080), make_video(3840, 2160)))
    for index in range(20):
        html = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic webpage {index + 1}</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:hsl({index * 17} 65% 25%);color:white;font:24px system-ui}}main{{text-align:center;padding:24px}}button{{font:inherit;padding:8px 24px}}</style><main><h1>Synthetic exhibit {index + 1:02d}</h1><p>Local deterministic HTML fixture</p><button onclick="this.textContent=Number(this.textContent)+1">0</button></main></html>'''
        result.append(write_asset(f"webpages/exhibit-{index:02d}.html", html.encode(), "webpage", dynamic_animation=False, external_resources=0))
    return result


def workload_specs():
    specs = []
    for length in (10, 30, 100):
        for count in (0, 25, 100, 300, 1000):
            specs.append((f"images-shared-L{length}-N{count}", length, count, "images-shared"))
    specs.append(("images-shared-L30-N3000-stress", 30, 3000, "images-shared"))
    for profile, counts in (("images-unique", (25, 100, 300)), ("gltf", (10, 50, 100)), ("gaussian_splat", (1, 4, 8)), ("webpage", (5, 20))):
        specs.extend((f"{profile}-L30-N{count}", 30, count, profile) for count in counts)
    specs.extend((("binding-L30-one-wall", 30, 0, "binding-one"), ("binding-L30-four-walls", 30, 0, "binding-four")))
    specs.extend((("video-L30-one-wall", 30, 0, "video-walls"), ("video-L30-four-walls", 30, 0, "video-walls")))
    specs.extend((("video-1080p-L30-one-wall", 30, 0, "video-walls-1080p"), ("video-1080p-L30-four-walls", 30, 0, "video-walls-1080p"), ("video-4k-L30-one-wall", 30, 0, "video-walls-4k")))
    specs.extend((("mixed-L30-N100", 30, 100, "mixed"), ("mixed-L30-N300", 30, 300, "mixed")))
    return specs


def make_workloads(golden, assets, specs=None):
    from bson import json_util
    templates = {}
    for entry in golden["documents"]:
        templates.setdefault(entry["model"], (entry["collection"], json_util.loads(json.dumps(entry["document"]))))
    asset_map = {item["path"]: item for item in assets}
    entries, cases = [], []

    def clone(model, label):
        collection, document = templates[model]
        document = copy.deepcopy(document)
        document.update(_id=oid(label), name=PREFIX + label)
        if "description" in document:
            document["description"] = "Synthetic isolated performance workload; no real artwork or visitor data"
        for field in ("created_time", "updated_time"):
            if field in document:
                document[field] = FIXED_TIME
        entries.append({"model": model, "collection": collection, "document": document})
        return document

    for slug, length, count, profile in (workload_specs() if specs is None else specs):
        room = clone("Room", slug)
        room.update(walls=[], boundary_min_x=-length / 2 + .25, boundary_max_x=length / 2 - .25, boundary_min_y=0.0, boundary_max_y=WALL_HEIGHT, boundary_min_z=-length / 2 + .25, boundary_max_z=length / 2 - .25)
        wall_docs = []
        for name, position, rotation in (
            ("north", f"0 {WALL_HEIGHT / 2} {-length / 2}", "0 0 0"),
            ("east", f"{length / 2} {WALL_HEIGHT / 2} 0", "0 -90 0"),
            ("south", f"0 {WALL_HEIGHT / 2} {length / 2}", "0 180 0"),
            ("west", f"{-length / 2} {WALL_HEIGHT / 2} 0", "0 90 0"),
            ("floor", "0 -0.1 0", "-90 0 0"),
        ):
            wall = clone("Wall", f"{slug}-{name}")
            wall.update(room=room["_id"], images=[], splats=[], gltfs=[], webpages=[], position=position, rotation=rotation, width=float(length), height=float(length) if name == "floor" else WALL_HEIGHT, depth=.2, color="#293541" if name == "floor" else "#e0e2e4", image_url="", video_url="", surface_type="floor" if name == "floor" else "wall")
            room["walls"].append(wall["_id"])
            wall_docs.append(wall)
        preset = clone("LocationPreset", f"{slug}-spawn")
        preset.update(room=room["_id"], position_x=0.0, position_y=1.6, position_z=0.0, rotation_x=0.0, rotation_y=0.0, rotation_z=0.0, is_default=True)
        used_assets = set()
        video_wall_count = (1 if "one-wall" in slug else 4) if profile.startswith("video-walls") else 0
        if video_wall_count:
            video_path = {"video-walls": "video.mp4", "video-walls-1080p": "video-1920x1080-30fps-crf26.mp4", "video-walls-4k": "video-3840x2160-30fps-crf26.mp4"}[profile]
            for wall in wall_docs[:video_wall_count]:
                wall["video_url"] = asset_map[video_path]["url"]
            used_assets.add(video_path)
        element_type = "image" if profile.startswith("images-") else profile
        type_counts = {"image": count * 70 // 100, "gltf": count * 20 // 100, "gaussian_splat": count * 2 // 100, "webpage": count * 8 // 100} if profile == "mixed" else {element_type: count} if count else {}
        element_specs = [(kind, number) for kind, quantity in type_counts.items() for number in range(quantity)]
        for index, (element_type, type_index) in enumerate(element_specs):
            wall_index, slot = index % 4, index // 4
            wall = wall_docs[wall_index]
            on_wall = (count + 3 - wall_index) // 4
            columns = min(on_wall, math.ceil(math.sqrt(on_wall * length / WALL_HEIGHT)))
            rows = math.ceil(on_wall / columns)
            cell_width, cell_height = length * .90 / columns, WALL_HEIGHT * .85 / rows
            x = (slot % columns + .5) * cell_width - length * .45
            y = WALL_HEIGHT * .425 - (slot // columns + .5) * cell_height
            size = min(cell_width, cell_height) * .78
            model, field, url_field = {"image": ("Image", "images", "image_url"), "gltf": ("GLTFmodel", "gltfs", "gltf_url"), "gaussian_splat": ("GaussianSplat", "splats", "splat_url"), "webpage": ("Webpage", "webpages", "webpage_url")}[element_type]
            element = clone(model, f"{slug}-element-{index:04d}")
            element.update(wall=wall["_id"], position=f"{x:.6f} {y:.6f} 0.25", position_x=x, position_y=y, scale_x=1.0, scale_y=1.0, scale_z=1.0, rotation_x=0.0, rotation_y=0.0, rotation_z=0.0, wall_element_type=element_type)
            if element_type == "image":
                asset_path = f"images/unique-{type_index:03d}-1024.png" if profile in {"images-unique", "mixed"} else "images/shared-1024.png"
                element.update(width=size, height=size)
            elif element_type == "gltf":
                asset_path = "models/sphere-10224-triangles.glb"
                size = min(2.0, size)
                element.update(scale_x=size, scale_y=size, scale_z=size, position_z=.25, default_rotation="0 0 0")
            elif element_type == "gaussian_splat":
                asset_path = "splats/cloud-100000.splat"
                size = min(2.0, size)
                element.update(scale_x=size, scale_y=size, scale_z=size, cutout_scale="1.2 1.2 1.2", cutout_position="0 0 0.55")
            else:
                asset_path = f"webpages/exhibit-{type_index % 20:02d}.html"
                element.update(width=size, height=size * .65)
            element[url_field] = asset_map[asset_path]["url"]
            used_assets.add(asset_path)
            wall[field].append(element["_id"])
        asset_list = sorted(used_assets)
        texture_count = sum(asset_map[path]["type"] == "image" for path in asset_list)
        case = {
            "slug": slug, "room_id": str(room["_id"]), "room_name": room["name"],
            "room_side_m": length, "room_area_m2": length ** 2, "wall_height_m": WALL_HEIGHT,
            "wall_count": 5, "element_count": count, "element_types": type_counts, "profile": profile,
            "videoWallCount": video_wall_count,
            "room_path": f"/room?room_id={room['_id']}",
            "walls": [{"id": str(wall["_id"]), "name": wall["name"], "surface": wall["surface_type"], "position": wall["position"], "rotation": wall["rotation"], "element_count": sum(len(wall[field]) for field in ("images", "splats", "gltfs", "webpages"))} for wall in wall_docs],
            "spawn": {"position": "0 1.6 0", "rotation": "0 0 0"},
            "asset_paths": asset_list, "unique_asset_count": len(asset_list), "asset_network_bytes_once": sum(asset_map[path]["bytes"] for path in asset_list),
            "image_texture_count_expected_if_cached": texture_count,
            "image_decoded_rgba_bytes": texture_count * TEXTURE_SIZE ** 2 * 4,
            "image_rgba_bytes_with_mipmaps_estimate": math.ceil(texture_count * TEXTURE_SIZE ** 2 * 4 * 4 / 3),
            "model_triangles_total": type_counts.get("gltf", 0) * 10224,
            "splat_points_total": type_counts.get("gaussian_splat", 0) * SPLAT_POINTS,
            "geometry_triangles_estimate": 60 + type_counts.get("gltf", 0) * 10224 + 2 * (type_counts.get("image", 0) + type_counts.get("webpage", 0)) + type_counts.get("gaussian_splat", 0) * SPLAT_POINTS * 2,
            "notes": [],
        }
        if profile == "images-shared":
            case["notes"].append("All image elements reuse one exact 1024x1024 PNG URL; geometry/DOM count grows while texture cache reuse is possible.")
        if profile == "images-unique":
            case["notes"].append("Every image URL contains distinct actual RGB pixels; 4 MiB decoded RGBA per unique image before mipmaps and driver overhead.")
        if element_type in {"gltf", "gaussian_splat"}:
            case["notes"].append("Instances share the same source URL; renderer geometry/GPU allocation reuse must be observed rather than assumed.")
        if element_type == "webpage":
            case["notes"].append("Current room renderer mounts webpage placeholders; iframe loads only when the user selects an element. These counts measure placeholder elements, not simultaneous iframe rendering.")
        if profile == "mixed":
            case["notes"].append("High-footprint combined scene: 70% distinct 1024x1024 image textures, 20% shared-source 10224-triangle models, 2% shared-source 100k-point splats, 8% webpage placeholders. No design bindings; 300-element scene reuses 20 HTML URLs for 24 placeholders.")
            case["notes"].append(f"Images alone require approximately {case['image_decoded_rgba_bytes'] / 1048576:.0f} MiB decoded RGBA, or {case['image_rgba_bytes_with_mipmaps_estimate'] / 1048576:.0f} MiB with mipmaps, before models, splat buffers, render targets and driver overhead.")
        if profile.startswith("binding-"):
            case["binding_wall_ids"] = [str(wall["_id"]) for wall in wall_docs[:1 if profile == "binding-one" else 4]]
            case["notes"].append("Empty scene reserved for the measurement harness to bind media/interactive wall designs; generator adds no wall design documents.")
        if profile == "video-walls":
            case["notes"].append("Functional low-resolution baseline: existing 160x90@24fps six-second MP4 through a separate muted looping HTMLVideoElement per video wall; no artwork elements.")
        if video_wall_count:
            video_asset = asset_map[video_path]
            case["video"] = {key: video_asset[key] for key in ("path", "width", "height", "frames_per_second", "duration_seconds", "bytes")}
            case["video_decode_pixels_per_second"] = video_asset["width"] * video_asset["height"] * video_asset["frames_per_second"] * video_wall_count
            if profile != "video-walls":
                case["notes"].append("Moving testsrc2 H264/yuv420p video, six seconds, 30fps, libx264 preset fast CRF26, no audio; each video wall owns a separate video element.")
        cases.append(case)
    return entries, cases


def self_check(golden, entries, cases, assets, *, expected_case_count=36, check_media=True):
    schemas = {item["model"]: item for item in golden["schemas"]}
    by_id = {entry["document"]["_id"]: entry for entry in entries}
    assert len(by_id) == len(entries), "duplicate fixture ObjectId"
    assert len(cases) == expected_case_count and len({case["slug"] for case in cases}) == expected_case_count
    assert len({asset["sha256"] for asset in assets if asset["type"] == "image"}) == 301
    for entry in entries:
        document = entry["document"]
        schema = schemas[entry["model"]]
        assert entry["collection"] == schema["collection"]
        assert document["name"].startswith(PREFIX)
        assert set(document) <= set(schema["fields"]), (entry["model"], set(document) - set(schema["fields"]))
        for field, spec in schema["fields"].items():
            if spec["required"]:
                assert field in document, (entry["model"], field)
        if schema["allow_inheritance"]:
            assert document["_cls"] == entry["model"]
        for field, spec in schema["fields"].items():
            reference = spec.get("reference_model") or spec.get("list_reference_model")
            if reference and field in document:
                values = document[field] if isinstance(document[field], list) else [document[field]]
                assert all(by_id[value]["model"] == reference for value in values), (entry["model"], field)
        if "wall" in document:
            wall = by_id[document["wall"]]["document"]
            assert abs(document["position_x"]) < wall["width"] / 2
            assert abs(document["position_y"]) < wall["height"] / 2
    by_string_id = {str(key): entry for key, entry in by_id.items()}
    types_by_wall = {}
    for entry in entries:
        document = entry["document"]
        if "wall" in document:
            counts = types_by_wall.setdefault(document["wall"], {})
            kind = document["wall_element_type"]
            counts[kind] = counts.get(kind, 0) + 1
    for case in cases:
        assert sum(wall["element_count"] for wall in case["walls"]) == case["element_count"]
        assert max(wall["element_count"] for wall in case["walls"][:4]) - min(wall["element_count"] for wall in case["walls"][:4]) <= 1
        actual_types = {}
        for wall_id in by_string_id[case["room_id"]]["document"]["walls"]:
            for kind, quantity in types_by_wall.get(wall_id, {}).items():
                actual_types[kind] = actual_types.get(kind, 0) + quantity
        assert actual_types == case["element_types"], (case["slug"], actual_types)
    if not check_media:
        for asset in assets:
            data = (FIXTURES / asset["path"]).read_bytes()
            assert len(data) == asset["bytes"] and hashlib.sha256(data).hexdigest() == asset["sha256"]
        return {"passed": True, "document_count": len(entries), "case_count": len(cases), "checks": ["legacy collection/field schema", "required fields", "inheritance _cls", "ObjectId references", "wall bounds and distribution", "element type counts", "existing asset bytes/hashes unchanged"], "media_decoded_or_encoded": False}
    pixel_hashes = set()
    for asset in assets:
        data = (FIXTURES / asset["path"]).read_bytes()
        assert len(data) == asset["bytes"] and hashlib.sha256(data).hexdigest() == asset["sha256"]
        if asset["type"] == "image":
            assert data[:8] == b"\x89PNG\r\n\x1a\n"
            offset, compressed = 8, bytearray()
            while offset < len(data):
                size = struct.unpack_from(">I", data, offset)[0]
                kind, payload = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + size]
                assert zlib.crc32(kind + payload) & 0xFFFFFFFF == struct.unpack_from(">I", data, offset + 8 + size)[0]
                if kind == b"IHDR":
                    assert struct.unpack(">IIBBBBB", payload) == (1024, 1024, 8, 2, 0, 0, 0)
                if kind == b"IDAT":
                    compressed.extend(payload)
                offset += 12 + size
            pixels = zlib.decompress(compressed)
            assert len(pixels) == 1024 * (1 + 1024 * 3)
            pixel_hashes.add(hashlib.sha256(pixels).hexdigest())
        elif asset["type"] == "gltf":
            assert struct.unpack_from("<III", data) == (0x46546C67, 2, len(data))
            json_size = struct.unpack_from("<I", data, 12)[0]
            gltf = json.loads(data[20:20 + json_size])
            assert gltf["accessors"][3]["count"] // 3 == 10224
            binary = data[28 + json_size:]
            indices = gltf["bufferViews"][3]
            assert max(struct.unpack_from(f"<{gltf['accessors'][3]['count']}H", binary, indices["byteOffset"])) < gltf["accessors"][0]["count"]
        elif asset["type"] == "gaussian_splat":
            assert len(data) == SPLAT_POINTS * 32
            for record in struct.iter_unpack("<6f8B", data):
                assert all(math.isfinite(value) for value in record[:6])
                assert -.6 < record[0] < .6 and -.6 < record[1] < .6 and -.05 < -record[2] < 1.15
                assert all(0 < scale < .01 for scale in record[3:6])
                assert record[-4:] == (255, 128, 128, 128)
        elif asset["type"] == "video":
            result = subprocess.run([str(FFMPEG), "-hide_banner", "-threads", "4", "-i", str(FIXTURES / asset["path"]), "-frames:v", "1", "-an", "-f", "null", "-"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf8", errors="replace")
            assert f"{asset['width']}x{asset['height']}" in result.stderr
            assert f"{asset['frames_per_second']} fps" in result.stderr
            assert "Video: h264" in result.stderr and "yuv420p" in result.stderr
            assert "Duration: 00:00:06." in result.stderr
            (OUTPUT / f"{Path(asset['path']).stem}-decode-proof.log").write_text(result.stderr, encoding="utf8")
    assert len(pixel_hashes) == 301, "unique URLs must have distinct decoded pixels"
    return {"passed": True, "document_count": len(entries), "case_count": len(cases), "distinct_png_pixel_hashes": len(pixel_hashes), "checks": ["legacy collection/field schema", "required fields", "inheritance _cls", "ObjectId references", "wall bounds and distribution", "asset hashes", "PNG chunks and decoded distinct pixels", "GLB header, triangle count and indices", "100000 splat records and cutout bounds", "MP4 H264 dimensions, fps, six-second duration and first-frame FFmpeg decode"]}


def seed(golden, entries, *, insert_only=False):
    """No production config import, arbitrary URI, database drop, or record delete."""
    from bson import json_util
    from pymongo import ReplaceOne, UpdateOne
    sys.path.insert(0, str(ROOT / "backend/tests/fixtures"))
    from isolated_db import connect
    client = connect()  # Validates URI, actual server address, and external marker.
    try:
        assert client.address == ("127.0.0.1", 27028)
        assert DATABASE == "metamuseum_perf_20261029"
        database = client[DATABASE]
        auth_inserted = 0
        for entry in [] if insert_only else golden["documents"]:
            if entry["model"] != "User":
                continue
            document = json_util.loads(json.dumps(entry["document"]))
            existing = database[entry["collection"]].find_one({"$or": [{"_id": document["_id"]}, {"email": document["email"]}]})
            if existing and (existing["_id"] != document["_id"] or existing["email"] != document["email"]):
                raise RuntimeError("Refusing to overwrite a conflicting auth fixture")
            result = database[entry["collection"]].update_one({"_id": document["_id"]}, {"$setOnInsert": document}, upsert=True)
            auth_inserted += result.upserted_id is not None
        groups = {}
        for entry in entries:
            groups.setdefault(entry["collection"], []).append(entry["document"])
        summary = {}
        for collection, documents in groups.items():
            owned = {document["_id"]: document["name"] for document in documents}
            for existing in database[collection].find({"$or": [{"_id": {"$in": list(owned)}}, {"name": {"$in": list(owned.values())}}]}, {"name": 1}):
                if owned.get(existing["_id"]) != existing.get("name"):
                    raise RuntimeError(f"Refusing conflicting fixture ownership in {collection}")
            operations = [UpdateOne({"_id": document["_id"], "name": document["name"]}, {"$setOnInsert": document}, upsert=True) if insert_only else ReplaceOne({"_id": document["_id"], "name": document["name"]}, document, upsert=True) for document in documents]
            result = database[collection].bulk_write(operations, ordered=True)
            actual = database[collection].count_documents({"_id": {"$in": list(owned)}})
            assert actual == len(documents), (collection, actual, len(documents))
            summary[collection] = {"expected_owned": len(documents), "present_owned": actual, "inserted": result.upserted_count, "modified": result.modified_count}
        return {"database": DATABASE, "server": "127.0.0.1:27028", "guard": "backend/tests/fixtures/isolated_db.connect()", "reset_or_delete_performed": False, "insert_only": insert_only, "auth_documents_inserted": auth_inserted, "auth_documents_requested": 0 if insert_only else 2, "collections": summary}
    finally:
        client.close()


def append_mixed(golden, *, seed_database):
    """Append only mixed cases while another process measures existing fixtures."""
    from bson import json_util
    manifest_path = OUTPUT / "workload-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    original_cases = copy.deepcopy(manifest["cases"])
    original_asset_hashes = {item["path"]: item["sha256"] for item in manifest["assets"]}
    base_document_path = OUTPUT / "fixture-documents.json"
    base_bytes = base_document_path.read_bytes()
    base_hash = hashlib.sha256(base_bytes).hexdigest()
    base_entries = json_util.loads(base_bytes.decode("utf8"))
    entries, cases = make_workloads(golden, manifest["assets"], [spec for spec in workload_specs() if spec[3] == "mixed"])
    assert all(entry["document"]["name"].startswith((PREFIX + "mixed-L30-N100", PREFIX + "mixed-L30-N300")) for entry in entries)
    assert {entry["document"]["_id"] for entry in entries}.isdisjoint(entry["document"]["_id"] for entry in base_entries)
    checks = self_check(golden, entries, cases, manifest["assets"], expected_case_count=2, check_media=False)
    proof = {"self_check": checks, "database_operations_scope": "Only mixed-L30-N100 and mixed-L30-N300 documents; $setOnInsert only; auth skipped", "existing_case_count": len(original_cases), "existing_cases_preserved": True, "base_document_sha256": base_hash, "existing_assets_sha256": original_asset_hashes, "new_room_ids": {case["slug"]: case["room_id"] for case in cases}, "seed": seed(golden, entries, insert_only=True) if seed_database else {"performed": False}}
    existing = {case["slug"] for case in manifest["cases"]}
    manifest["cases"].extend(case for case in cases if case["slug"] not in existing)
    assert manifest["cases"][:len(original_cases)] == original_cases
    assert hashlib.sha256(base_document_path.read_bytes()).hexdigest() == base_hash
    manifest["fixture_version"] = "2026-10-29-v3"
    manifest["self_check"].update(case_count=len(manifest["cases"]), document_count=len(base_entries) + len(entries), mixed_append_check=checks)
    manifest["additional_document_files"] = ["mixed-fixture-documents.json"]
    (OUTPUT / "mixed-fixture-documents.json").write_text(json_util.dumps(entries, json_options=json_util.CANONICAL_JSON_OPTIONS, indent=2), encoding="utf8")
    (OUTPUT / "mixed-workload-seed-summary.json").write_text(json.dumps(proof, indent=2), encoding="utf8")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf8")
    print(json.dumps({"manifest": str(manifest_path), "case_count": len(manifest["cases"]), "new_cases": cases, "proof": proof}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", action="store_true", help="Seed owned synthetic documents into the fixed guarded performance DB")
    parser.add_argument("--append-mixed", action="store_true", help="Append only the two mixed scenes using existing assets; preserve existing scenes and media, skip media decoding")
    args = parser.parse_args()
    from bson import json_util
    golden = json.loads((ROOT / "contracts/legacy-bson.json").read_text(encoding="utf8"))
    if args.append_mixed:
        append_mixed(golden, seed_database=args.seed)
        return
    assets = make_assets()
    entries, cases = make_workloads(golden, assets)
    checks = self_check(golden, entries, cases, assets)
    manifest = {
        "format_version": 1, "fixture_version": "2026-10-29-v3", "synthetic": True,
        "database": DATABASE, "mongo_server": "127.0.0.1:27028", "media_origin": MEDIA_ORIGIN,
        "geometry_policy": "Four inward-facing 6m-high walls plus floor; room side varies independently of count; elements round-robin across walls and fitted in wall-local grids; center spawn; measurement should perform 360-degree yaw.",
        "measurement_limitations": ["Synthetic scenes do not establish performance on absent mobile or Quest hardware.", "PNG network compression is deliberately efficient; texture allocation/decode dimensions are real.", "One shared source URL does not guarantee GPU geometry/texture sharing; measure renderer allocations.", "Webpage elements are placeholders until selection; these cases do not mount concurrent iframes.", "Interactive design bindings are supplied separately by the measurement harness."],
        "asset_totals": {"files": len(assets), "bytes": sum(asset["bytes"] for asset in assets), "pngs": 301, "model_triangles": 10224, "splat_points": SPLAT_POINTS},
        "assets": assets, "cases": cases, "self_check": checks,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "fixture-documents.json").write_text(json_util.dumps(entries, json_options=json_util.CANONICAL_JSON_OPTIONS, indent=2), encoding="utf8")
    (OUTPUT / "workload-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
    proof = {"self_check": checks, "asset_totals": manifest["asset_totals"], "room_ids": {case["slug"]: case["room_id"] for case in cases}, "schema_source": "contracts/legacy-bson.json", "seed": seed(golden, entries) if args.seed else {"performed": False}}
    (OUTPUT / "workload-seed-summary.json").write_text(json.dumps(proof, indent=2), encoding="utf8")
    print(json.dumps({"manifest": str(OUTPUT / "workload-manifest.json"), "case_count": len(cases), "documents": len(entries), "assets": manifest["asset_totals"], "self_check": checks["passed"], "seed": proof["seed"]}, indent=2))


if __name__ == "__main__":
    main()
