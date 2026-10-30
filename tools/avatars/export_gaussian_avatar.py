#!/usr/bin/env python3
"""Export the locally licensed original FLAME 2023 / GaussianAvatars subject 306.

Run offline; this is deliberately not an upload handler. Model data stays under
the ignored FLAME/derived directory. Only NumPy is needed, including for the old
Chumpy ndarray and SciPy CSC containers in the official pickle.

FLAME topology/teeth behavior follows Shenhan Qian et al., GaussianAvatars,
revision 29b0021308d45c6dce0b522044a4893e189c7a23 (CC-BY-NC-SA-4.0,
https://github.com/ShenhanQian/GaussianAvatars/blob/main/LICENSE.md).
Its FLAME/LBS sources retain separate MPG/SMPL-X license requirements; see
https://github.com/vchoutas/smplx/blob/main/LICENSE and the user's model license.
No rights to distribute FLAME or the subject are granted by this exporter.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import hashlib
import io
import json
from pathlib import Path
import pickle
import shutil
import zipfile

import numpy as np
try:
    from numpy._core.multiarray import _reconstruct
except ImportError:  # NumPy 1.x uses the older pickle module path.
    from numpy.core.multiarray import _reconstruct


REVISION = "29b0021308d45c6dce0b522044a4893e189c7a23"
FLAME_SOURCE_SHA256 = "09f4052a3df4251539b20af907475dd58ab9a2048d1761703c3d55480de278b5"
MODEL_KEYS = {"v_template", "shapedirs", "posedirs", "J_regressor", "weights", "kintree_table", "f"}


class LegacyArray:
    """Data container only: do not import or execute old Chumpy code."""

    def __setstate__(self, state):
        self.__dict__.update(state)


class LegacyCSC(LegacyArray):
    def dense(self):
        rows, cols = self._shape
        result = np.zeros((rows, cols), dtype=np.float32)
        if len(self.indptr) != cols + 1 or self.indptr[-1] != len(self.data):
            raise ValueError("Malformed joint regressor CSC data")
        for col in range(cols):
            start, end = self.indptr[col:col + 2]
            result[self.indices[start:end], col] = self.data[start:end]
        return result


class ModelUnpickler(pickle.Unpickler):
    """Allow only the numeric containers present in the official local assets."""

    def find_class(self, module, name):
        allowed = {
            ("numpy.core.multiarray", "_reconstruct"): _reconstruct,
            ("numpy._core.multiarray", "_reconstruct"): _reconstruct,
            ("numpy", "ndarray"): np.ndarray,
            ("numpy", "dtype"): np.dtype,
            ("__builtin__", "set"): builtins.set,
            ("builtins", "set"): builtins.set,
            ("chumpy.ch", "Ch"): LegacyArray,
            ("scipy.sparse.csc", "csc_matrix"): LegacyCSC,
            ("scipy.sparse._csc", "csc_matrix"): LegacyCSC,
        }
        if (module, name) not in allowed:
            raise pickle.UnpicklingError(f"Unsupported model container: {module}.{name}")
        return allowed[module, name]


def asset_bytes(path: Path, basename: str) -> bytes:
    if path.suffix.lower() != ".zip":
        return path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        matches = [n for n in archive.namelist() if Path(n).name == basename and not n.startswith("__MACOSX/")]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {basename} in {path}")
        return archive.read(matches[0])


def numeric(value, shape, name):
    if isinstance(value, LegacyCSC):
        value = value.dense()
    elif isinstance(value, LegacyArray):
        value = value.x
    result = np.asarray(value, dtype=np.float32)
    if result.shape != shape or not np.isfinite(result).all():
        raise ValueError(f"Invalid {name}: expected finite {shape}, got {result.shape}")
    return result


def source_constants(source_path: Path):
    """Read literal topology tables from the pinned source without importing it."""
    source = source_path.read_bytes()
    if hashlib.sha256(source).hexdigest() != FLAME_SOURCE_SHA256:
        raise ValueError(f"flame.py must match the pinned revision {REVISION}")
    tree = ast.parse(source)
    tables = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("f_teeth_upper", "f_teeth_lower"):
                    tables[target.id] = np.asarray(ast.literal_eval(node.value.args[0]), dtype=np.uint32)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "register_buffer":
            if node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value in ("lip_outside_ring_upper", "lip_outside_ring_lower"):
                tables[node.args[0].value] = np.asarray(ast.literal_eval(node.args[1].args[0]), dtype=np.int32)
    if set(tables) != {"f_teeth_upper", "f_teeth_lower", "lip_outside_ring_upper", "lip_outside_ring_lower"}:
        raise ValueError("Missing pinned FLAME teeth topology tables")
    return tables


def augment_model(model, tables):
    """Same vertex order, shape inheritance, weights and face order as add_teeth."""
    vertices = numeric(model["v_template"], (5023, 3), "v_template")
    directions = numeric(model["shapedirs"], (5023, 3, 400), "shapedirs")
    posedirs = numeric(model["posedirs"], (5023, 3, 36), "posedirs").reshape(-1, 36).T
    regressor = numeric(model["J_regressor"], (5, 5023), "J_regressor")
    weights = numeric(model["weights"], (5023, 5), "weights")
    parents = np.asarray(model["kintree_table"][0], dtype=np.int32)
    parents[0] = -1
    if parents.tolist() != [-1, 0, 1, 1, 1]:
        raise ValueError("Unexpected original FLAME joint order")
    upper, lower = (tables[f"lip_outside_ring_{part}"] for part in ("upper", "lower"))
    a, b = vertices[upper], vertices[lower]
    distance = np.linalg.norm(a - b, axis=1, keepdims=True).mean()
    middle = (a + b) / np.float32(2)
    middle[:, 1] = middle[:, 1].mean()
    middle[:, 2] -= distance * np.float32(1.5)
    offset = np.array([0, distance, 0], dtype=np.float32)
    upper_edge = middle + offset * np.float32(.1)
    upper_root = upper_edge + offset * np.float32(2)
    lower_edge = middle - offset * np.float32(.1)
    lower_edge[:, 2] -= distance * np.float32(.4)
    lower_root = lower_edge - offset * np.float32(2)
    back = np.array([0, 0, distance], dtype=np.float32)
    teeth = np.concatenate((upper_root, lower_root, upper_edge, lower_edge,
                            upper_root - back, upper_edge - back, lower_root - back, lower_edge - back))
    teeth_dirs = np.zeros((120, 3, 400), dtype=np.float32)
    identity_mean = (directions[upper, :, :300] + directions[lower, :, :300]) / np.float32(2)
    for ring in range(8):
        teeth_dirs[ring * 15:(ring + 1) * 15, :, :300] = identity_mean
    teeth_weights = np.zeros((120, 5), dtype=np.float32)
    teeth_weights[np.r_[0:15, 30:45, 60:90], 1] = 1
    teeth_weights[np.r_[15:30, 45:60, 90:120], 2] = 1
    faces = np.asarray(model["f"], dtype=np.uint32)
    if faces.shape != (9976, 3):
        raise ValueError("Unexpected original FLAME face topology")
    return {
        "template": np.concatenate((vertices, teeth)),
        "directions": np.concatenate((directions, teeth_dirs)),
        "poseDirections": np.concatenate((posedirs.reshape(36, 5023, 3), np.zeros((36, 120, 3), dtype=np.float32)), axis=1),
        "jointRegressor": np.pad(regressor, ((0, 0), (0, 120))),
        "weights": np.concatenate((weights, teeth_weights)),
        "parents": parents,
        "faces": np.concatenate((faces, tables["f_teeth_upper"] + 5023, tables["f_teeth_lower"] + 5023)),
    }


def reference_vertices(rig, parameters):
    """Independent vectorized float64 FLAME equations for browser parity checks.

    Dynamic offset is intentionally absent: the pinned FlameHead.forward accepts
    it but never applies it. Root centering is off, matching subject 306's viewer.
    """
    shaped = rig["template"].astype(np.float64) + np.einsum("e,evc->vc", parameters["expression"], rig["expressionDirections"].astype(np.float64))
    joints = rig["jointRegressor"].astype(np.float64) @ shaped
    pose = np.concatenate([parameters[key] for key in ("rotation", "neck", "jaw", "eyes")]).reshape(5, 3)
    rotations = []
    for vector in pose:
        angle = np.linalg.norm(vector + 1e-8)
        x, y, z = vector / angle
        skew = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
        rotations.append(np.eye(3) + np.sin(angle) * skew + (1 - np.cos(angle)) * (skew @ skew))
    rotations = np.asarray(rotations)
    feature = (rotations[1:] - np.eye(3)).reshape(36)
    posed = shaped + np.einsum("p,pvc->vc", feature, rig["poseDirections"].astype(np.float64))
    chain = []
    for joint, parent in enumerate(rig["parents"]):
        transform = np.eye(4)
        transform[:3, :3] = rotations[joint]
        transform[:3, 3] = joints[joint] if parent == -1 else joints[joint] - joints[parent]
        chain.append(transform if parent == -1 else chain[parent] @ transform)
    transforms = np.asarray(chain)
    transforms[:, :3, 3] -= np.einsum("jik,jk->ji", transforms[:, :3, :3], joints)
    skinning = np.einsum("vj,jab->vab", rig["weights"].astype(np.float64), transforms)
    vertices = np.einsum("vab,vb->va", skinning, np.column_stack((posed, np.ones(len(posed)))))[:, :3]
    if parameters.get("zeroCenteredAtRoot", False):
        vertices -= joints[0]
    return (vertices + parameters["translation"]).astype(np.float32)


def array_descriptor(file, offset, array):
    types = {"f": "float32", "u": "uint32", "i": "int32"}
    return {"file": file, "byteOffset": offset, "length": array.size, "type": types[array.dtype.kind], "shape": list(array.shape)}


def write_arrays(path: Path, arrays):
    descriptors = {}
    with path.open("wb") as output:
        for name, value in arrays.items():
            dtype = {"f": "<f4", "u": "<u4", "i": "<i4"}[value.dtype.kind]
            array = np.ascontiguousarray(value, dtype=dtype)
            descriptors[name] = array_descriptor(path.name, output.tell(), array)
            output.write(array.tobytes())
    return descriptors


def references(defaults):
    neutral = {key: [0.] * len(value) for key, value in defaults.items()}
    cases = {"neutral": neutral, "frame0": defaults}
    for name, axis, angle in (("eyes-left", 1, np.deg2rad(25)), ("eyes-right", 1, -np.deg2rad(25)),
                              ("eyes-up", 0, np.deg2rad(15)), ("eyes-down", 0, -np.deg2rad(15))):
        params = {key: list(value) for key, value in neutral.items()}
        params["eyes"][axis] = params["eyes"][axis + 3] = float(angle)
        cases[name] = params
    cases["jaw"] = {**neutral, "jaw": [.2, 0., 0.]}
    expression = [0.] * 100
    expression[:3] = [1., -.5, .25]
    cases["expression"] = {**neutral, "expression": expression}
    cases["combined"] = {**defaults, "rotation": [.07, -.11, .03], "neck": [.02, .04, -.03],
                         "jaw": [.19, .01, -.02], "eyes": [.15, .3, .02, -.1, -.25, -.01],
                         "translation": [.01, -.02, .03]}
    return cases


def export(args):
    private_root = args.private_root.resolve()
    output = args.output.resolve()
    if not output.is_relative_to(private_root / "derived"):
        raise ValueError("Restricted assets may only be written under FLAME/derived")
    source_path = args.source_root / "flame_model/flame.py"
    tables = source_constants(source_path)
    with args.ply.open("rb") as source:
        header = []
        while source.tell() < 16384:
            line = source.readline()
            header.append(line)
            if line == b"end_header\n":
                break
        else:
            raise ValueError("Unsupported or missing native PLY header")
    if not {b"format binary_little_endian 1.0\n", b"element vertex 89021\n", b"property float binding_0\n"}.issubset(header):
        raise ValueError("Expected the original bound subject 306 PLY")
    model_data = asset_bytes(args.model, "flame2023.pkl")
    model = ModelUnpickler(io.BytesIO(model_data), encoding="latin1").load()
    if not isinstance(model, dict) or not MODEL_KEYS.issubset(model):
        raise ValueError("Expected the original FLAME 2023 model with jaw rotation")
    mask_data = asset_bytes(args.masks, "FLAME_masks.pkl")
    masks = ModelUnpickler(io.BytesIO(mask_data), encoding="latin1").load()
    if not isinstance(masks, dict) or not {"left_eyeball", "right_eyeball", "lips"}.issubset(masks):
        raise ValueError("Expected the official FLAME vertex masks")
    rig = augment_model(model, tables)
    template_faces = []
    with (args.source_root / "flame_model/assets/flame/head_template_mesh.obj").open() as source:
        for line in source:
            if line.startswith("f "):
                template_faces.append([int(part.split("/")[0]) - 1 for part in line.split()[1:]])
    if not np.array_equal(template_faces, rig["faces"][:9976]):
        raise ValueError("Template OBJ face ordering differs from the model")
    with np.load(args.parameters, allow_pickle=False) as motion:
        identity = numeric(motion["shape"].reshape(-1), (300,), "subject shape")
        offset = motion["static_offset"].reshape(-1, 3)
        if offset.shape == (5023, 3):
            offset = np.pad(offset, ((0, 120), (0, 0)))
        offset = numeric(offset, (5143, 3), "subject static_offset")
        rig["template"] += np.einsum("s,vcs->vc", identity, rig["directions"][:, :, :300])
        rig["template"] += offset
        rig["expressionDirections"] = rig.pop("directions")[:, :, 300:400].transpose(2, 0, 1).copy()
        defaults = {}
        for name, key, length in (("expression", "expr", 100), ("rotation", "rotation", 3),
                                  ("neck", "neck_pose", 3), ("jaw", "jaw_pose", 3),
                                  ("eyes", "eyes_pose", 6), ("translation", "translation", 3)):
            defaults[name] = numeric(motion[key][0], (length,), key).tolist()
        # Upstream accepts but ignores dynamic_offset; record its presence rather than applying it.
        ignored_dynamic = "dynamic_offset" in motion.files
    rig["restJoints"] = (rig["jointRegressor"] @ rig["template"]).astype(np.float32)
    rig["leftEyeVertices"] = np.asarray(masks["left_eyeball"], dtype=np.uint32)
    rig["rightEyeVertices"] = np.asarray(masks["right_eyeball"], dtype=np.uint32)
    if rig["faces"].shape != (10144, 3) or len(rig["template"]) != 5143:
        raise ValueError("Unexpected augmented FLAME topology")
    if not np.allclose(rig["weights"].sum(axis=1), 1, atol=1e-5):
        raise ValueError("Invalid skinning weight sums")
    output.mkdir(parents=True, exist_ok=True)
    descriptors = write_arrays(output / "rig.bin", rig)
    cases = references(defaults)
    expected = {name: reference_vertices(rig, parameters) for name, parameters in cases.items()}
    if not all(np.isfinite(vertices).all() for vertices in expected.values()):
        raise ValueError("Reference pose evaluation produced non-finite vertices")
    reference_arrays = write_arrays(output / "references.bin", expected)
    reference_json = {"sourceRevision": REVISION, "method": "independent-vectorized-numpy-float64-flame-equations",
                      "absoluteToleranceMeters": 2e-6,
                      "cases": [{"name": name, "parameters": parameters, "vertices": reference_arrays[name]}
                                for name, parameters in cases.items()]}
    (output / "references.json").write_text(json.dumps(reference_json, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(args.ply, output / "point_cloud.ply")
    manifest = {
        "format": "gaussian-avatars-native-v1", "byteOrder": "little-endian", "subject": "306",
        "sourceRevision": REVISION, "licenseStatus": "private-local-only",
        "rights": {"model": "Original FLAME 2023; user-provided licensed local asset",
                   "code": "GaussianAvatars CC-BY-NC-SA-4.0; inherited FLAME/LBS MPG terms also apply",
                   "subject": "Upstream demo 306; redistribution permission not established",
                   "publicDistribution": False},
        "vertexCount": 5143, "faceCount": 10144, "jointCount": 5, "expressionCount": 100,
        "jointOrder": ["root", "neck", "jaw", "left-eye", "right-eye"],
        "coordinates": "upstream FLAME meters; axis-angle radians; no root centering or axis flip",
        "identity": {"shapeCoefficientsBaked": 300, "staticOffsetBaked": True, "teethAdded": 120},
        "dynamicOffset": "ignored to match pinned FlameHead.forward" if ignored_dynamic else "absent",
        "defaultParameters": defaults, "arrays": descriptors,
        "gaussian": {"file": "point_cloud.ply", "count": 89021},
        "references": "references.json",
        "sources": {"modelSha256": hashlib.sha256(model_data).hexdigest(),
                    "masksSha256": hashlib.sha256(mask_data).hexdigest(),
                    "parametersSha256": hashlib.sha256(args.parameters.read_bytes()).hexdigest(),
                    "plySha256": hashlib.sha256(args.ply.read_bytes()).hexdigest(),
                    "flameSourceSha256": FLAME_SOURCE_SHA256},
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "vertices": 5143, "faces": 10144,
                      "gaussians": 89021, "referencePoses": len(cases),
                      "rigBytes": (output / "rig.bin").stat().st_size,
                      "licenseStatus": manifest["licenseStatus"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-root", type=Path, default=Path("FLAME"))
    parser.add_argument("--model", type=Path, default=Path("FLAME/FLAME2023.zip"))
    parser.add_argument("--masks", type=Path, default=Path("FLAME/FLAME_masks.zip"))
    parser.add_argument("--source-root", type=Path, default=Path("FLAME/upstream"))
    parser.add_argument("--parameters", type=Path, default=Path("FLAME/upstream/media/306/flame_param.npz"))
    parser.add_argument("--ply", type=Path, default=Path("FLAME/upstream/media/306/point_cloud.ply"))
    parser.add_argument("--output", type=Path, default=Path("FLAME/derived/web"))
    export(parser.parse_args())


if __name__ == "__main__":
    main()
