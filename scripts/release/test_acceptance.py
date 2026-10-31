"""Focused, host-free acceptance guards and real-protocol framing checks."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location("release_acceptance", Path(__file__).with_name("acceptance.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class AcceptanceGuards(unittest.TestCase):
    def test_worker_probes_relative_static_media_without_allowing_external_or_unsafe_urls(self):
        readonly = next(node for node in ast.parse(release.WORKER).body
                        if isinstance(node, ast.FunctionDef) and node.name == "readonly")
        media_loop = next(node for node in readonly.body if isinstance(node, ast.For)
                          and isinstance(node.target, ast.Tuple) and node.target.elts[0].id == "collection")
        code = compile(ast.Module(body=[media_loop], type_ignores=[]), "worker-media-paths", "exec")
        def probe(value):
            record = {"_id": "legacy-id", "image_url": value, "splat_url": value, "gltf_url": value}
            before = dict(record)
            def check(condition, label):
                if not condition: raise RuntimeError(label)
            namespace = {"db": {name: SimpleNamespace(find_one=lambda query: record)
                                for name in ("image", "gaussian_splat", "g_l_t_fmodel")},
                         "http": SimpleNamespace(request=lambda *args: None),
                         "urlsplit": urlsplit, "check": check, "paths": []}
            try:
                exec(code, namespace)
                return namespace["paths"]
            finally:
                self.assertEqual(record, before)
        for value in ("static/image/dance_i.jpg", "/static/image/dance_i.jpg"):
            with self.subTest(value=value):
                self.assertEqual(probe(value), ["/static/image/dance_i.jpg"] * 3)
        for value in ("https://elsewhere.invalid/static/image.jpg", "//elsewhere.invalid/static/image.jpg",
                      "/static/../private", "static/image.jpg?token=secret", "/static/image.jpg?token=secret"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "original_media_not_local"):
                probe(value)

    def test_close_validates_both_stacks_before_removal_and_retains_data(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            directory = Path(root)
            manifest = {"candidate_image": "candidate-image", "production_image": "old-image"}
            gate = {"checks": {key: True for key in release.CHECKS}, "evidence": "private", "evidence_sha256": "digest"}
            resources = {role: {"app_container": role + "-app", "mongo_container": role + "-mongo", "network": role + "-net"}
                         for role in ("candidate", "legacy")}
            def load(path):
                if path.name == "prepared.json": return manifest
                if path.name == "operator-checks.json": return gate
                return resources[path.parent.name.removeprefix("staging-")]
            calls = []
            with patch.object(release, "read", side_effect=load), patch.object(release, "validate_binding"), \
                 patch.object(release, "digest", return_value="digest"), patch.object(release, "inspect", return_value={}), \
                 patch.object(release, "validate_stage") as validate, \
                 patch.object(release, "command", side_effect=lambda args: calls.append(args)), patch.object(release, "write"):
                validate.side_effect = [None, release.ReleaseError("legacy is not isolated")]
                with self.assertRaises(release.ReleaseError): release.close_staging(directory)
                self.assertEqual(calls, [])
                validate.side_effect = None
                release.close_staging(directory)
                self.assertEqual(calls, [["docker", "rm", "-f", "candidate-app", "candidate-mongo"],
                                         ["docker", "network", "rm", "candidate-net"],
                                         ["docker", "rm", "-f", "legacy-app", "legacy-mongo"],
                                         ["docker", "network", "rm", "legacy-net"]])
                calls.clear()
                gate["checks"][release.CHECKS[0]] = False
                with self.assertRaises(release.ReleaseError): release.close_staging(directory)
                self.assertEqual(calls, [])

    def test_document_or_reference_order_change_and_removed_index_fail(self):
        original = {"users": {"count": 2, "sha256": "original-bson-digest", "indexes": ["email-unique"]}}
        release.compare_originals(original, copy.deepcopy(original))
        for field, changed in (("count", 3), ("sha256", "changed-reference-order"), ("indexes", [])):
            current = copy.deepcopy(original)
            current["users"][field] = changed
            with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                release.compare_originals(original, current)
        with self.assertRaises(release.ReleaseError):
            release.compare_originals({}, {})

    def test_manifest_cannot_escape_private_directory(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            with self.assertRaises(release.ReleaseError):
                release.verify_hashes(Path(root), {"sha256": {"../private.env": "digest"}})

    def test_failed_evidence_does_not_create_operator_gate(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            directory = Path(root)
            checks = {name: True for name in release.CHECKS}
            checks[release.CHECKS[0]] = False
            self.assertFalse(release.evidence_finish(directory, {}, checks, {}, "operator"))
            self.assertFalse((directory / "operator-checks.json").exists())
            remaining = next(directory.glob("operator-checks.remaining.*.json"))
            result = release.read(remaining)
            self.assertFalse(result["checks"][release.CHECKS[0]])
            self.assertEqual(release.digest(result["evidence"]), result["evidence_sha256"])

    def test_required_binding_rejects_other_preparation_and_image(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            directory = Path(root)
            (directory / "prepared.json").write_text("{}", encoding="utf8")
            manifest = {"candidate_image": "sha256:candidate", "candidate_sha": "source"}
            template = dict(manifest, release_dir=str(directory), prepared_sha256=release.digest(directory / "prepared.json"))
            release.validate_binding(template, manifest, directory)
            for field in ("prepared_sha256", "candidate_image", "candidate_sha", "release_dir"):
                with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                    release.validate_binding(dict(template, **{field: "another-attempt"}), manifest, directory)

    def test_stage_refuses_extra_network_live_mount_or_external_network(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            directory = Path(root)
            stage = directory / "staging-candidate"
            resource = dict(app_container="stage-app", mongo_container="stage-mongo", image="sha256:candidate", network="stage-net", loopback_port=51737)
            app = {"Name": "/stage-app", "Id": "app-id", "Image": resource["image"], "State": {"Running": True},
                   "NetworkSettings": {"Networks": {"stage-net": {}}, "Ports": {"5000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "51737"}]}},
                   "Config": {"Env": ["MONGODB_URI=mongodb://mongo_container:27017/metamuseum", "MONGODB_DB=metamuseum"]},
                   "Mounts": [{"Destination": target, "Type": "bind", "Source": str(stage / "media" / name)} for name, target in release.MEDIA.items()]}
            mongo = {"Name": "/stage-mongo", "Id": "mongo-id", "State": {"Running": True},
                     "NetworkSettings": {"Networks": {"stage-net": {}}},
                     "Mounts": [{"Destination": "/data/db", "Type": "bind", "Source": str(stage / "mongo")},
                                {"Destination": "/data/configdb", "Type": "bind", "Source": str(stage / "mongo-configdb")}]}
            network = {"Name": "stage-net", "Internal": True, "Containers": {"app-id": {}, "mongo-id": {}}}
            with patch.object(release, "require_path"):
                release.validate_stage(directory, "candidate", resource, app, mongo, network, resource["image"])
                for mutation in ("extra-network", "live-mount", "external-network", "other-container", "live-mongo-uri", "missing-configdb", "live-configdb"):
                    a, m, n = copy.deepcopy(app), copy.deepcopy(mongo), copy.deepcopy(network)
                    if mutation == "extra-network": a["NetworkSettings"]["Networks"]["production"] = {}
                    elif mutation == "live-mount": a["Mounts"][0]["Source"] = str(release.DATA / "static_splat")
                    elif mutation == "external-network": n["Internal"] = False
                    elif mutation == "other-container": n["Containers"]["production"] = {}
                    elif mutation == "live-mongo-uri": a["Config"]["Env"][0] = "MONGODB_URI=mongodb://production:27017/metamuseum"
                    elif mutation == "missing-configdb": m["Mounts"].pop()
                    else: m["Mounts"][1]["Source"] = str(release.DATA / "mongo-configdb")
                    with self.subTest(mutation=mutation), self.assertRaises(release.ReleaseError):
                        release.validate_stage(directory, "candidate", resource, a, m, n, resource["image"])


class SocketFraming(unittest.TestCase):
    def test_engine_ping_socket_ack_and_buffered_event(self):
        class Wire:
            def __init__(self):
                self.messages = iter(['0{"sid":"engine"}', '40{"sid":"socket"}',
                                      '42["room_state",{"users":[]}]', '2', '431[{"server_time_ms":123}]'])
                self.sent = []
            def recv(self, timeout): return next(self.messages)
            def send(self, value): self.sent.append(value)
            def close(self): pass
        class HTTP:
            cookie = ""; csrf = ""
            def request(self, *args, **kwargs): return {"capability": "temporary-capability"}
        wire = Wire()
        namespace = {"json": json, "time": time, "connect": lambda *a, **k: wire,
                     "HTTP": HTTP, "C": {"origin": "http://127.0.0.1:51737"},
                     "check": lambda value, label: self.assertTrue(value, label)}
        node = next(node for node in ast.parse(release.WORKER).body if isinstance(node, ast.ClassDef) and node.name == "Socket")
        exec(compile(ast.Module(body=[node], type_ignores=[]), "worker-socket", "exec"), namespace)
        socket = namespace["Socket"](HTTP())
        self.assertEqual(socket.call("wall.clock", {}), {"server_time_ms": 123})
        self.assertEqual(socket.event("room_state"), {"users": []})
        self.assertIn("3", wire.sent)
        self.assertTrue(any(value.startswith('421["wall.clock"') for value in wire.sent))


if __name__ == "__main__":
    unittest.main()
