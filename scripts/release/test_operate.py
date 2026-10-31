"""Focused host-free checks for data isolation and switch failure boundaries."""
import importlib.util
import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name("operate.py")


class SafetyChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("release_operate", MODULE)
        cls.release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.release)

    def test_staging_refuses_live_directory_or_parent(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            live = Path(root) / "data"
            live.mkdir()
            for unsafe in (live, live / "staging", live.parent):
                with self.subTest(path=unsafe), self.assertRaises(self.release.ReleaseError):
                    self.release.assert_isolated(unsafe, [live])
            self.release.assert_isolated(Path(root) / "release", [live])

    def test_candidate_db_probe_avoids_live_mounts_and_application_startup(self):
        calls = []
        with patch.object(self.release, "command", side_effect=lambda args: calls.append(args) or b""):
            self.release.probe_candidate_database("sha256:candidate")
        args = calls[0]
        self.assertIn("--read-only", args)
        self.assertNotIn("--mount", args)
        self.assertNotIn("-v", args)
        self.assertEqual(args[args.index("--env-file") + 1], str(self.release.ENV_FILE))
        self.assertNotIn("create_app", args[-1])
        self.assertIn("connect_database", args[-1])
        with patch.object(self.release, "command", side_effect=self.release.ReleaseError("database check failed")):
            with self.assertRaises(self.release.ReleaseError):
                self.release.probe_candidate_database("sha256:candidate")

    def test_cutover_imports_packaged_defaults_without_seed_or_reset(self):
        calls = []
        with patch.object(self.release, "command", side_effect=lambda args: calls.append(args) or b""):
            self.release.import_candidate_presets("private-app")
        args = calls[0]
        self.assertEqual(args[:5], ["docker", "exec", "private-app", "python", "-c"])
        self.assertIn("import_defaults", args[-1])
        self.assertIn("44", args[-1])
        self.assertNotIn("seed", args[-1])
        self.assertNotIn("drop", args[-1])

    def test_mongo_dump_failure_redacts_uri_and_decoded_credentials(self):
        env = {"MONGODB_URI": "mongodb://operator:secret%40value@mongo_container/metamuseum?authSource=admin", "MONGODB_DB": "metamuseum"}
        failure = SimpleNamespace(returncode=1, stderr=("error: " + env["MONGODB_URI"] + " operator secret@value").encode())
        with patch.object(self.release.subprocess, "run", return_value=failure), self.assertRaises(self.release.ReleaseError) as raised:
            self.release.dump_mongo(env, None)
        message = str(raised.exception)
        self.assertNotIn(env["MONGODB_URI"], message)
        self.assertNotIn("secret@value", message)
        self.assertNotIn("operator", message)
        self.assertIn("Mongo dump failed", message)

    def test_staging_refuses_symlink_into_live_media(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            live = Path(root) / "data"
            live.mkdir()
            link = Path(root) / "alias"
            try:
                link.symlink_to(live, target_is_directory=True)
            except OSError:
                self.skipTest("Host does not permit symlinks")
            with self.assertRaises(self.release.ReleaseError):
                self.release.assert_isolated(link / "copy", [live])

    def test_wheel_mount_directory_cannot_pass_file_validation(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            wheel = Path(root) / "wheel.glb"
            wheel.mkdir()
            with self.assertRaises(self.release.ReleaseError):
                self.release.require_path(wheel, is_file=True)

    def test_five_legacy_mounts_are_accepted_but_other_missing_mounts_fail(self):
        release = self.release
        mounts = [{"Type": "bind", "Source": str(release.DATA / name), "Destination": destination}
                  for name, destination in release.MEDIA.items() if name != "wall_media"]
        release.validate_current_mounts(mounts)
        with self.assertRaises(release.ReleaseError):
            release.validate_current_mounts(mounts[:-1])

    def test_archive_rejects_link_and_parent_traversal(self):
        import io
        import tarfile
        for name, member_type in (("../wall_media/secret", tarfile.REGTYPE), ("wall_media/link", tarfile.SYMTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
                archive = Path(root) / "media.tar"
                with tarfile.open(archive, "w") as stream:
                    member = tarfile.TarInfo(name)
                    member.type = member_type
                    stream.addfile(member, io.BytesIO())
                with self.assertRaises(self.release.ReleaseError):
                    self.release.extract_media(archive, Path(root) / "restored")

    def test_preflight_failure_never_invokes_rollback(self):
        events = []
        def preflight():
            events.append("preflight")
            raise self.release.ReleaseError("bad mount")
        with self.assertRaises(self.release.ReleaseError):
            self.release.guarded_switch(preflight, lambda: events.append("switch"), lambda: events.append("rollback"))
        self.assertEqual(events, ["preflight"])

    def test_failed_switch_rolls_back_its_own_saved_configuration(self):
        events = []
        def switch():
            events.append("switch")
            raise self.release.ReleaseError("health check")
        with self.assertRaises(self.release.ReleaseError):
            self.release.guarded_switch(lambda: events.append("preflight"), switch, lambda: events.append("rollback"))
        self.assertEqual(events, ["preflight", "switch", "rollback"])

    def test_successful_switch_does_not_rollback(self):
        events = []
        self.release.guarded_switch(lambda: events.append("preflight"), lambda: events.append("switch"), lambda: events.append("rollback"))
        self.assertEqual(events, ["preflight", "switch"])

    def test_original_container_still_present_is_resumed_without_compose_rollback(self):
        original = {"Id": "old-container", "Image": "old-image"}
        self.assertEqual(self.release.recovery_action(original, original, "candidate-image"), "resume")
        self.assertEqual(self.release.recovery_action(original, {"Id": "new-container", "Image": "candidate-image"}, "candidate-image"), "rollback")
        self.assertEqual(self.release.recovery_action(original, None, "candidate-image"), "rollback")
        with self.assertRaises(self.release.ReleaseError):
            self.release.recovery_action(original, {"Id": "other-container", "Image": "other-image"}, "candidate-image")

    def test_private_hold_cannot_accept_a_public_or_other_attempt_container(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            attempt = Path(root)
            held = {"candidate_image": "candidate-image", "private_port": 51739}
            current = {"Image": "candidate-image", "State": {"Running": True},
                       "NetworkSettings": {"Ports": {"5000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "51739"}]}},
                       "Config": {"Labels": {"com.docker.compose.project.config_files": str(attempt / "compose.private.json")}}}
            self.release.validate_hold_container(held, current, attempt)
            for kind in ("public", "other_attempt", "wrong_image"):
                changed = copy.deepcopy(current)
                if kind == "public":
                    changed["NetworkSettings"]["Ports"]["5000/tcp"][0]["HostPort"] = "51736"
                elif kind == "other_attempt":
                    changed["Config"]["Labels"]["com.docker.compose.project.config_files"] = "/old-attempt/compose.private.json"
                else:
                    changed["Image"] = "some-other-image"
                with self.subTest(kind=kind), self.assertRaises(self.release.ReleaseError):
                    self.release.validate_hold_container(held, changed, attempt)

    def test_stopped_private_candidate_can_be_rolled_back_but_not_promoted(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            attempt = Path(root)
            held = {"candidate_image": "candidate-image", "private_port": 51739}
            current = {"Image": "candidate-image", "State": {"Running": False},
                       "HostConfig": {"PortBindings": {"5000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "51739"}]}},
                       "Config": {"Labels": {"com.docker.compose.project.config_files": str(attempt / "compose.private.json")}}}
            self.release.validate_hold_container(held, current, attempt, allow_inactive=True)
            with self.assertRaises(self.release.ReleaseError):
                self.release.validate_hold_container(held, current, attempt)

    def test_explicit_rollback_restores_original_after_successful_promotion(self):
        self._assert_published_rollback("promoted.json")

    def test_explicit_rollback_recovers_interrupted_publication(self):
        self._assert_published_rollback("promotion-started.json")

    def test_published_rollback_refuses_a_record_from_another_hold(self):
        self._assert_published_rollback("promoted.json", bound=False)

    def _assert_published_rollback(self, publication_record, bound=True):
        release = self.release
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            attempt = Path(root)
            original = {"Id": "original-container", "Image": "original-image"}
            (attempt / "container.inspect.json").write_text(json.dumps(original))
            (attempt / "compose.original.json").write_text('{"original":"captured config"}')
            (attempt / "compose.public.json").write_text('{"image":"candidate-image"}')
            held = {"candidate_image": "candidate-image", "candidate_sha": "a" * 40, "private_port": 51739,
                    "sha256": {name: hashlib.sha256((attempt / name).read_bytes()).hexdigest()
                               for name in ("container.inspect.json", "compose.original.json", "compose.public.json")}}
            (attempt / "hold.json").write_text(json.dumps(held))
            (attempt / publication_record).write_text(json.dumps({"candidate_image": "candidate-image", "candidate_sha": "a" * 40,
                "attempt_dir": str(attempt), "hold_sha256": hashlib.sha256((attempt / "hold.json").read_bytes()).hexdigest() if bound else "another-hold"}))
            current = {"Id": "published-container", "Image": "candidate-image", "State": {"Running": True},
                "NetworkSettings": {"Ports": {"5000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "51736"}]}},
                "Config": {"Labels": {"com.docker.compose.project.config_files": str(attempt / "compose.public.json")}}}
            events = []
            def docker(args):
                if args[:3] == ["docker", "container", "ls"]:
                    return current["Id"].encode()
                if args[:2] == ["docker", "stop"] and args[-1] == "published-container":
                    events.append("stop-published")
                    current["State"]["Running"] = False
                    return b""
                if args == ["docker", "compose", "-p", "metamuseum", "-f", str(attempt / "compose.original.json"),
                            "up", "-d", "--no-build", "--pull", "never", "--no-deps", "app"]:
                    events.append("restore-exact-original-config")
                    current.update(Id="restored-original-container", Image="original-image")
                    current["State"]["Running"] = True
                    return b""
                self.fail("Unexpected Docker operation: " + repr(args))
            real_stat = Path.stat
            def private_directory_stat(path, *args, **kwargs):
                result = real_stat(path, *args, **kwargs)
                return SimpleNamespace(st_mode=0o40700) if path == attempt else result
            with patch.object(Path, "stat", private_directory_stat), patch.object(release, "command", side_effect=docker), \
                 patch.object(release, "inspect", side_effect=lambda kind, name: current), \
                 patch.object(release, "wait_health"), \
                 patch.object(release, "require_port_free", side_effect=AssertionError("Published port is intentionally occupied")):
                if bound:
                    release.rollback(SimpleNamespace(attempt_dir=attempt, manual_rollback_approved=True))
                else:
                    with self.assertRaises(release.ReleaseError):
                        release.rollback(SimpleNamespace(attempt_dir=attempt, manual_rollback_approved=True))
            if not bound:
                self.assertEqual(events, [])
                self.assertFalse((attempt / "code-rollback.json").exists())
                return
            self.assertEqual(events, ["stop-published", "restore-exact-original-config"])
            record = json.loads((attempt / "code-rollback.json").read_text())
            self.assertEqual(record["restored_image"], "original-image")
            self.assertFalse(record["data_restored"])

    def test_published_rollback_rejects_another_attempt_image_or_port(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            attempt = Path(root)
            held = {"candidate_image": "candidate-image", "private_port": 51739}
            current = {"Image": "candidate-image", "State": {"Running": True},
                "NetworkSettings": {"Ports": {"5000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "51736"}]}},
                "Config": {"Labels": {"com.docker.compose.project.config_files": str(attempt / "compose.public.json")}}}
            self.release.validate_hold_container(held, current, attempt, published=True)
            for kind in ("other_attempt", "wrong_image", "public_interface"):
                changed = copy.deepcopy(current)
                if kind == "other_attempt":
                    changed["Config"]["Labels"]["com.docker.compose.project.config_files"] = "/old-attempt/compose.public.json"
                elif kind == "wrong_image":
                    changed["Image"] = "unrelated-image"
                else:
                    changed["NetworkSettings"]["Ports"]["5000/tcp"][0]["HostIp"] = "0.0.0.0"
                with self.subTest(kind=kind), self.assertRaises(self.release.ReleaseError):
                    self.release.validate_hold_container(held, changed, attempt, published=True)

    def test_uid1000_probe_needs_no_fork_or_identity_change(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            with patch.object(self.release.os, "geteuid", return_value=1000, create=True), \
                 patch.object(self.release.os, "fork", side_effect=AssertionError("UID1000 should probe directly"), create=True):
                self.release.uid_write_probe(Path(root))
            self.assertEqual(list(Path(root).iterdir()), [])

    def test_already_owned_copies_do_not_need_chown(self):
        with patch.object(Path, "stat", return_value=SimpleNamespace(st_uid=1000, st_gid=1000)), \
             patch.object(self.release.os, "chown", side_effect=AssertionError("Already UID1000-owned"), create=True):
            self.release.set_app_owner(Path("copied-media"))

    def test_mongo_declared_volumes_have_separate_isolated_binds(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            stage = Path(root) / "stage"
            binds = self.release.mongo_bind_paths(stage, {"/data/db": {}, "/data/configdb": {}})
            self.assertEqual(binds, {"/data/db": stage / "mongo", "/data/configdb": stage / "mongo-configdb"})
            with self.assertRaises(self.release.ReleaseError):
                self.release.mongo_bind_paths(stage, {"/data/db": {}, "/unexpected-volume": {}})

    def test_candidate_wrong_database_or_live_media_target_is_rejected(self):
        release = self.release
        env = {"MONGODB_URI": "mongodb://mongo_container:27017/metamuseum", "MONGODB_DB": "metamuseum",
               "SECRET_KEY": "private-session", "SECURITY_PASSWORD_SALT": "private-salt"}
        candidate = {"services": {"app": {"container_name": "metamuseum_container", "environment": dict(env, ENVIRONMENT="production"),
                     "volumes": [{"type": "bind", "source": str(release.DATA / name), "target": target} for name, target in release.MEDIA.items()],
                     "ports": [{"host_ip": "127.0.0.1", "published": "51736", "target": 5000}], "networks": {"mongo": {}}}},
                     "networks": {"mongo": {"name": "tlx-mongo_default", "external": True}}}
        release.validate_candidate_compose(candidate, env)
        for kind in ("database", "media", "port", "workers"):
            changed = copy.deepcopy(candidate)
            service = changed["services"]["app"]
            if kind == "database":
                service["environment"]["MONGODB_DB"] = "empty_staging"
            elif kind == "media":
                service["volumes"][-1]["source"] = "/tmp/empty-wall-media"
            elif kind == "port":
                service["ports"][0]["host_ip"] = "0.0.0.0"
            else:
                service["command"] = ["uvicorn", "metamuseum.asgi:app", "--workers", "4"]
            with self.subTest(kind=kind), self.assertRaises(release.ReleaseError):
                release.validate_candidate_compose(changed, env)

    def test_valid_archive_restores_copy_without_changing_source(self):
        import tarfile
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            source = Path(root) / "source"
            source.mkdir()
            file = source / "asset.mp4"
            file.write_bytes(b"paired uploaded media")
            archive = Path(root) / "media.tar"
            with tarfile.open(archive, "w") as stream:
                stream.add(source, arcname="wall_media")
            restored = Path(root) / "staging"
            self.release.extract_media(archive, restored)
            copy = restored / "wall_media" / "asset.mp4"
            self.assertEqual(copy.read_bytes(), b"paired uploaded media")
            copy.unlink()
            self.assertEqual(file.read_bytes(), b"paired uploaded media")


if __name__ == "__main__":
    unittest.main()
