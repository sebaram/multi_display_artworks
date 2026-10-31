"""Host-free guards for retiring incomplete staging without touching backups/live data."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SHA = "f" * 40
OLD_IMAGE = "sha256:" + "a" * 64
MONGO_IMAGE = "sha256:" + "b" * 64
CANDIDATE_IMAGE = "sha256:" + "c" * 64


class RetirementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("release_retire", Path(__file__).with_name("retire.py"))
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name) / "operator"
        self.release = self.home / ".local/state/metamuseum/releases/failed-rc"
        (self.release / "snapshot").mkdir(parents=True)
        self.token = hashlib.sha256(str(self.release).encode()).hexdigest()[:12]
        self.original = {"Id": "d" * 64, "Image": OLD_IMAGE, "Mounts": []}
        self.mongo = {"Id": "e" * 64, "Image": MONGO_IMAGE, "Mounts": [{"Source": "/var/lib/actual-live-mongo"}]}
        self.write("container.inspect.json", self.original)
        self.write("mongo.inspect.json", self.mongo)
        hashes = {}
        for name, content in (("mongo.archive.gz", b"paired Mongo backup"), ("media.tar", b"paired media backup"), ("collections.json", b"[]")):
            (self.release / "snapshot" / name).write_bytes(content)
            hashes[name] = hashlib.sha256(content).hexdigest()
        self.write("snapshot/snapshot.json", {"production_image": OLD_IMAGE, "container_id": self.original["Id"], "sha256": hashes})
        self.containers = {
            "metamuseum_container": {"Id": self.original["Id"], "Name": "/metamuseum_container", "Image": OLD_IMAGE, "Config": {"Labels": {}}},
            "mongo_container": {"Id": self.mongo["Id"], "Name": "/mongo_container", "Image": MONGO_IMAGE, "Config": {"Labels": {}}},
        }
        self.networks = {}
        self.images = {CANDIDATE_IMAGE: {"Id": CANDIDATE_IMAGE, "Config": {"Labels": {"org.opencontainers.image.revision": SHA}}}}
        self.mutations = []
        actual_stat = Path.stat
        def private_stat(path, *args, **kwargs):
            result = actual_stat(path, *args, **kwargs)
            if path == self.home or self.home in path.parents:
                fields = list(result)
                fields[0] &= ~0o077
                fields[4] = fields[5] = 1000
                return os.stat_result(fields)
            return result
        for target, name, value in ((Path, "stat", private_stat), (Path, "home", lambda: self.home),
                                     (self.module, "command", self.docker), (self.module, "inspect", self.inspect)):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def write(self, name, value):
        (self.release / name).write_text(json.dumps(value))

    def stack(self, role="candidate", *, app=True, mongo=True):
        network = "metamuseum-release-" + self.token + "-" + role
        stage = self.release / ("staging-" + role)
        entries = {}
        for kind, present in (("app", app), ("mongo", mongo)):
            if not present:
                continue
            name = network + "-" + kind
            identifier = hashlib.sha256(name.encode()).hexdigest()
            mounts = []
            if kind == "app":
                for relative, destination in self.module.MEDIA.items():
                    source = stage / "media" / relative
                    source.parent.mkdir(parents=True, exist_ok=True)
                    if relative.endswith(".glb"):
                        source.write_bytes(b"copied GLB")
                    else:
                        source.mkdir(exist_ok=True)
                    mounts.append({"Type": "bind", "Source": str(source), "Destination": destination})
            else:
                for relative, destination in (("mongo", "/data/db"), ("mongo-configdb", "/data/configdb")):
                    source = stage / relative
                    source.mkdir(parents=True, exist_ok=True)
                    mounts.append({"Type": "bind", "Source": str(source), "Destination": destination})
            self.containers[name] = {"Id": identifier, "Name": "/" + name,
                "Image": MONGO_IMAGE if kind == "mongo" else CANDIDATE_IMAGE if role == "candidate" else OLD_IMAGE,
                "Config": {"Labels": {"metamuseum.release": self.token}, "Env": ["SECRET_KEY=never-print-me"]},
                "Mounts": mounts, "State": {"Running": False},
                "NetworkSettings": {"Networks": {network: {"NetworkID": hashlib.sha256(network.encode()).hexdigest()}}, "Ports": {"5000/tcp": None}}}
            entries[identifier] = {"Name": name}
        self.networks[network] = {"Id": hashlib.sha256(network.encode()).hexdigest(), "Name": network,
            "Internal": True, "Driver": "bridge", "Labels": {"metamuseum.release": self.token}, "Containers": entries}
        return network

    def inspect(self, kind, reference):
        rows = self.containers if kind == "container" else self.networks if kind == "network" else self.images
        if reference in rows:
            return copy.deepcopy(rows[reference])
        for item in rows.values():
            if item["Id"] == reference:
                return copy.deepcopy(item)
        raise self.module.ReleaseError("Unavailable fixture")

    def docker(self, args):
        if args[:3] in (["docker", "container", "ls"], ["docker", "network", "ls"]):
            rows = self.containers if args[1] == "container" else self.networks
            value = args[args.index("--filter") + 1]
            if value.startswith("label=metamuseum.release="):
                token = value.split("=", 2)[2]
                found = [item["Id"] for item in rows.values() if (item.get("Config", {}).get("Labels", {}) if args[1] == "container" else item.get("Labels", {})).get("metamuseum.release") == token]
            else:
                name = value.removeprefix("name=^").removeprefix("/").removesuffix("$")
                found = [rows[name]["Id"]] if name in rows else []
            return "\n".join(found).encode()
        if args[:4] == ["docker", "container", "rm", "--force"]:
            name = next(name for name, item in self.containers.items() if item["Id"] == args[4])
            self.mutations.append(("container", name))
            del self.containers[name]
            for network in self.networks.values():
                network["Containers"].pop(args[4], None)
            return b""
        if args[:3] == ["docker", "network", "rm"]:
            name = next(name for name, item in self.networks.items() if item["Id"] == args[3])
            self.assertEqual(self.networks[name]["Containers"], {})
            self.mutations.append(("network", name))
            del self.networks[name]
            return b""
        self.fail("Unexpected Docker operation: " + repr(args))

    def retire(self):
        return self.module.retire(self.release, SHA, "test-operator")

    def test_partial_failed_stack_can_retire_with_no_resource_manifest_and_stopped_app(self):
        self.stack()
        preserved = {file: file.read_bytes() for file in self.release.rglob("*") if file.is_file()}
        result = self.retire()
        self.assertEqual(result["containers_removed"], 2)
        self.assertEqual(result["networks_removed"], 1)
        self.assertEqual(set(self.containers), {"metamuseum_container", "mongo_container"})
        for path, content in preserved.items():
            self.assertEqual(path.read_bytes(), content)

    def test_only_mongo_or_no_resources_is_safe(self):
        self.stack(app=False)
        self.assertEqual(self.retire()["containers_removed"], 1)
        self.assertEqual(self.retire()["containers_removed"], 0)

    def test_legacy_uses_captured_image_and_accepts_original_five_mounts(self):
        network = self.stack("legacy")
        app = self.containers[network + "-app"]
        app["Mounts"] = [mount for mount in app["Mounts"] if mount["Destination"] != self.module.MEDIA["wall_media"]]
        self.assertEqual(self.retire()["containers_removed"], 2)

    def test_orphaned_own_container_with_absent_network_can_retire(self):
        network = self.stack(app=False)
        del self.networks[network]
        result = self.retire()
        self.assertEqual(result["containers_removed"], 1)
        self.assertEqual(result["networks_removed"], 0)

    def test_release_path_and_ownership_are_checked_before_docker_mutation(self):
        self.stack()
        with self.assertRaises(self.module.ReleaseError):
            self.module.retire(self.release.parent, SHA, "test-operator")
        current_stat = Path.stat
        def foreign_owner(path, *args, **kwargs):
            result = current_stat(path, *args, **kwargs)
            fields = list(result)
            if path == self.release:
                fields[4] = 2000
            return os.stat_result(fields)
        with patch.object(Path, "stat", foreign_owner), self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])

    def test_prepared_release_and_changed_snapshot_are_rejected_before_removal(self):
        self.stack()
        self.write("prepared.json", {})
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        (self.release / "prepared.json").unlink()
        (self.release / "snapshot/media.tar").write_bytes(b"changed")
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])

    def test_second_stack_failure_prevents_any_first_stack_removal(self):
        self.stack("candidate")
        legacy = self.stack("legacy")
        self.networks[legacy]["Internal"] = False
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])

    def test_foreign_endpoint_or_second_network_is_rejected(self):
        network = self.stack()
        self.networks[network]["Containers"]["9" * 64] = {"Name": "unrelated-service"}
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        del self.networks[network]["Containers"]["9" * 64]
        self.containers[network + "-app"]["NetworkSettings"]["Networks"]["tlx-mongo_default"] = {}
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])

    def test_live_mount_wrong_image_missing_label_and_anonymous_mongo_volume_fail_closed(self):
        network = self.stack()
        app = self.containers[network + "-app"]
        mongo = self.containers[network + "-mongo"]
        for kind in ("live_mount", "wrong_revision", "missing_label", "anonymous_volume"):
            original_app, original_mongo = copy.deepcopy(app), copy.deepcopy(mongo)
            if kind == "live_mount":
                app["Mounts"][-1]["Source"] = "/var/www/metamuseum/data/wall_media"
            elif kind == "wrong_revision":
                self.images[CANDIDATE_IMAGE]["Config"]["Labels"]["org.opencontainers.image.revision"] = "0" * 40
            elif kind == "missing_label":
                app["Config"]["Labels"] = {}
            else:
                mongo["Mounts"][-1]["Type"] = "volume"
            with self.subTest(kind=kind), self.assertRaises(self.module.ReleaseError):
                self.retire()
            app.clear(); app.update(original_app)
            mongo.clear(); mongo.update(original_mongo)
            self.images[CANDIDATE_IMAGE]["Config"]["Labels"]["org.opencontainers.image.revision"] = SHA
        self.assertEqual(self.mutations, [])

    def test_unrecognized_token_resource_is_rejected(self):
        network = self.stack()
        stranger = copy.deepcopy(self.containers[network + "-app"])
        stranger.update(Id="8" * 64, Name="/unrecognized-stage")
        self.containers["unrecognized-stage"] = stranger
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])

    def test_stage_symlink_is_rejected(self):
        network = self.stack()
        source = Path(self.containers[network + "-mongo"]["Mounts"][-1]["Source"])
        source.rmdir()
        target = self.release / "other-data"
        target.mkdir()
        try:
            source.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("Host does not permit symlinks")
        with self.assertRaises(self.module.ReleaseError):
            self.retire()
        self.assertEqual(self.mutations, [])


if __name__ == "__main__":
    unittest.main()
