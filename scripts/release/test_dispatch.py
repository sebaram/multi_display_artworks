"""Host-free release input and GitHub gate regressions."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import dispatch


SHA = "a" * 40
OTHER = "b" * 40
REPO = "sebaram/multi_display_artworks"


class DispatchTests(unittest.TestCase):
    def test_staging_selects_distinct_available_ports_outside_production(self):
        ports = dispatch.staging_ports()
        self.assertEqual(len(set(ports)), 2)
        self.assertTrue(all(1024 <= port <= 65535 and port not in (51736, 51739) for port in ports))

    def test_release_and_attempt_paths_stay_in_private_state(self):
        home = Path(tempfile.gettempdir()) / "operator"
        release, attempt = dispatch.release_paths(home, "v2-rc1", "cutover-20261031T120000Z-123")
        self.assertEqual(release, home / ".local/state/metamuseum/releases/v2-rc1")
        self.assertEqual(attempt, release / "cutover-20261031T120000Z-123")

    def test_path_inputs_reject_traversal_absolute_paths_and_shell_text(self):
        for value in ("", "..", "../release", "/tmp/release", "x/y", "a\\b", "x;id", "X", "a" * 65):
            with self.subTest(release_id=value), self.assertRaises(dispatch.DispatchError):
                dispatch.release_paths(Path(tempfile.gettempdir()), value)
        for value in ("..", "../attempt", "/tmp/x", "a\\b", "a b", "$(id)"):
            with self.subTest(attempt=value), self.assertRaises(dispatch.DispatchError):
                dispatch.release_paths(Path(tempfile.gettempdir()), "release", value)

    def test_sha_must_be_full_lowercase_hex(self):
        self.assertEqual(dispatch.validate_sha(SHA), SHA)
        for value in ("abc1234", "A" * 40, "g" * 40, "a" * 41, "a" * 39 + "\n"):
            with self.subTest(value=value), self.assertRaises(dispatch.DispatchError):
                dispatch.validate_sha(value)

    def test_candidate_metadata_requires_matching_release_versions(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "frontend").mkdir()
            (root / "backend").mkdir()
            (root / "frontend/package.json").write_text(json.dumps({"version": "2.0.0-rc.1"}))
            (root / "backend/pyproject.toml").write_text('[project]\nname = "app"\nversion = "2.0.0-rc.1"\n')
            self.assertEqual(dispatch.candidate_version(root), "2.0.0-rc.1")
            (root / "backend/pyproject.toml").write_text('[project]\nversion = "2.0.0"\n')
            with self.assertRaises(dispatch.DispatchError):
                dispatch.candidate_version(root)

    def test_stable_2_0_metadata_is_accepted(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "frontend").mkdir()
            (root / "backend").mkdir()
            (root / "frontend/package.json").write_text('{"version":"2.0.0"}')
            (root / "backend/pyproject.toml").write_text('[project]\nversion = "2.0.0"\n')
            self.assertEqual(dispatch.candidate_version(root), "2.0.0")

    def test_ci_gate_accepts_exact_successful_push_and_quality_job(self):
        paths = []

        def fetch(path):
            paths.append(path)
            if "/jobs?" in path:
                return {"jobs": [{"name": "quality", "status": "completed", "conclusion": "success"}]}
            return {"workflow_runs": [{"id": 23, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success"}]}

        self.assertEqual(dispatch.assert_push_quality(SHA, REPO, fetch), 23)
        self.assertIn("head_sha=" + SHA, paths[0])
        self.assertIn("event=push", paths[0])
        self.assertIn("/actions/runs/23/jobs?", paths[1])

    def test_ci_gate_rejects_manual_wrong_sha_running_and_failed_runs(self):
        for change in ({"event": "workflow_dispatch"}, {"head_sha": OTHER}, {"status": "in_progress"}, {"conclusion": "failure"}):
            run = {"id": 23, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success", **change}
            with self.subTest(change=change), self.assertRaises(dispatch.DispatchError):
                dispatch.assert_push_quality(SHA, REPO, lambda path: {"workflow_runs": [run]})

    def test_ci_gate_does_not_hide_newer_failure_behind_older_success(self):
        runs = [
            {"id": 24, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "failure"},
            {"id": 23, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success"},
        ]
        with self.assertRaises(dispatch.DispatchError):
            dispatch.assert_push_quality(SHA, REPO, lambda path: {"workflow_runs": runs})

    def test_ci_gate_rejects_skipped_or_missing_quality_job(self):
        for jobs in ([], [{"name": "quality", "status": "completed", "conclusion": "skipped"}]):
            def fetch(path):
                return {"jobs": jobs} if "/jobs?" in path else {"workflow_runs": [
                    {"id": 23, "head_sha": SHA, "event": "push", "status": "completed", "conclusion": "success"}]}
            with self.subTest(jobs=jobs), self.assertRaises(dispatch.DispatchError):
                dispatch.assert_push_quality(SHA, REPO, fetch)

    def test_cutover_requires_dispatch_on_master_at_current_master_sha(self):
        fetch = lambda path: {"object": {"sha": SHA}}
        dispatch.assert_master("refs/heads/master", SHA, REPO, fetch)
        for ref, sha in (("refs/heads/codex/candidate", SHA), ("refs/heads/master", OTHER)):
            with self.subTest(ref=ref, sha=sha), self.assertRaises(dispatch.DispatchError):
                dispatch.assert_master(ref, sha, REPO, fetch)

    def test_acceptance_candidate_cannot_silently_change(self):
        dispatch.assert_record_candidate({"candidate_sha": SHA}, SHA)
        with self.assertRaises(dispatch.DispatchError):
            dispatch.assert_record_candidate({"candidate_sha": OTHER}, SHA)

    def test_rollback_uses_explicit_attempt_without_new_ci_or_master(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            home = Path(root)
            attempt = home / ".local/state/metamuseum/releases/release/cutover-123"
            attempt.mkdir(parents=True)
            (attempt / "hold.json").write_text('{"candidate_sha":"' + OTHER + '"}')
            args = SimpleNamespace(operation="rollback", release_id="release", attempt_id="cutover-123",
                                   candidate_sha="not-a-new-candidate", ref="refs/heads/old", repository=REPO)
            calls = []
            with patch.object(Path, "home", return_value=home), \
                 patch.object(dispatch, "assert_push_quality", side_effect=AssertionError("recovery must not depend on CI")), \
                 patch.object(dispatch, "assert_master", side_effect=AssertionError("recovery must not depend on master")), \
                 patch.object(dispatch, "helper", side_effect=lambda name, command: calls.append((name, command))):
                dispatch.execute(args)
            self.assertEqual(calls, [("operate.py", ["rollback", "--attempt-dir", attempt, "--manual-rollback-approved"])])

    def test_missing_attempt_never_guesses_latest_cutover(self):
        args = SimpleNamespace(operation="promote", release_id="release", attempt_id="", candidate_sha=SHA)
        with self.assertRaises(dispatch.DispatchError):
            dispatch.execute(args)


if __name__ == "__main__":
    unittest.main()
