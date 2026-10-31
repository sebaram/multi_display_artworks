"""Manual Actions entry point; backups and private evidence never leave this host."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
OPERATIONS = ("inventory", "prepare", "accept-staging", "hold", "accept-private", "promote", "rollback")


class DispatchError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise DispatchError(message)


def validate_sha(value):
    require(re.fullmatch(r"[0-9a-f]{40}", value or ""), "Candidate SHA must be 40 lowercase hexadecimal characters")
    return value


def release_paths(home, release_id, attempt_id=""):
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", release_id or ""), "Use a lowercase release slug of at most 64 characters")
    require(not attempt_id or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}", attempt_id), "Attempt ID must be one safe basename")
    directory = Path(home) / ".local/state/metamuseum/releases" / release_id
    attempt = directory / attempt_id if attempt_id else None
    for path in (attempt or directory, *(attempt or directory).parents):
        require(not path.is_symlink(), "Private release paths must not traverse symlinks")
    return directory, attempt


def candidate_version(directory):
    version = json.loads((directory / "frontend/package.json").read_text())["version"]
    project = re.search(r"(?ms)^\[project\]\s*\n(.*?)(?=^\[|\Z)", (directory / "backend/pyproject.toml").read_text())
    backend = re.search(r'^version\s*=\s*"([^"]+)"\s*$', project[1], re.MULTILINE) if project else None
    require(isinstance(version, str) and re.fullmatch(r"2\.0\.0(?:-rc\.[1-9][0-9]*)?", version) and backend and backend[1] == version,
            "Candidate backend/frontend versions must agree on 2.0.0 or 2.0.0-rc.N")
    return version


def github_json(path):
    token = os.environ.get("GH_TOKEN", "")
    require(token, "An Actions read token is required to verify release gates")
    request = urllib.request.Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (OSError, ValueError):
        raise DispatchError("GitHub release gate lookup failed; no host mutation was authorized") from None


def assert_push_quality(sha, repository, fetch=github_json):
    query = urllib.parse.urlencode({"head_sha": sha, "event": "push", "per_page": 100})
    runs = fetch("/repos/" + repository + "/actions/workflows/deploy.yml/runs?" + query).get("workflow_runs", [])
    require(runs, "No PUSH validation run exists for this exact candidate SHA")
    run = runs[0]
    require(run.get("head_sha") == sha and run.get("event") == "push" and run.get("status") == "completed" and run.get("conclusion") == "success",
            "The latest exact-candidate PUSH validation run must have completed successfully")
    run_id = run["id"]
    require(isinstance(run_id, int) and run_id > 0, "GitHub validation run identity is invalid")
    jobs = fetch("/repos/" + repository + "/actions/runs/" + str(run_id) + "/jobs?filter=latest&per_page=100").get("jobs", [])
    require(any(job.get("name") == "quality" and job.get("status") == "completed" and job.get("conclusion") == "success" for job in jobs),
            "The candidate PUSH run has no successful quality job")
    return run_id


def assert_master(ref, sha, repository, fetch=github_json):
    require(ref == "refs/heads/master", "Hold and promotion must be dispatched from master")
    current = fetch("/repos/" + repository + "/git/ref/heads/master")
    require(current.get("object", {}).get("sha") == sha, "Candidate SHA must equal current origin/master before hold or promotion")


def assert_record_candidate(record, sha):
    require(record.get("candidate_sha") == sha, "Selected candidate SHA differs from this release or cutover attempt")


def private_command(args, *, cwd=None):
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, capture_output=True, text=True)
    require(result.returncode == 0, "A source/image verification or build failed; inspect the host privately")
    return result.stdout.strip()


def verify_checkout(directory, sha):
    require(private_command(["git", "rev-parse", "HEAD"], cwd=directory) == sha, "Candidate checkout HEAD does not match the selected SHA")
    require(not private_command(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=directory), "Candidate checkout must be clean")


def candidate_image(directory, sha, repository):
    verify_checkout(directory, sha)
    version = candidate_version(directory)
    tag = "metamuseum:" + version + "-" + sha
    labels = {"org.opencontainers.image.revision": sha, "org.opencontainers.image.version": version,
              "org.opencontainers.image.source": "https://github.com/" + repository}
    existing = subprocess.run(["docker", "image", "inspect", tag], capture_output=True, text=True)
    if existing.returncode:
        print("Building the exact clean candidate checkout with source/version labels.", flush=True)
        args = ["docker", "build", "--tag", tag]
        for key, value in labels.items():
            args += ["--label", key + "=" + value]
        private_command(args + ["."], cwd=directory)
        raw = private_command(["docker", "image", "inspect", tag])
    else:
        raw = existing.stdout
    image = json.loads(raw)[0]
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("Id", "")) and
            all(image.get("Config", {}).get("Labels", {}).get(key) == value for key, value in labels.items()),
            "Candidate image ID or immutable tag source/version labels do not match")
    print("Candidate image verified: " + tag, flush=True)
    return image["Id"]


def helper(name, args):
    # The reviewed helpers print fixed summaries; raw Docker/env diagnostics stay private.
    result = subprocess.run([sys.executable, str(ROOT / "scripts/release" / name), *map(str, args)])
    require(result.returncode == 0, "Release helper stopped; inspect private host evidence before continuing")


def execute(args):
    if args.operation == "inventory":
        safe_inventory = private_command([sys.executable, ROOT / "scripts/release/inventory.py", "--code-manifest"])
        if args.inventory_output:
            Path(args.inventory_output).write_text(safe_inventory + "\n", encoding="utf-8")
            print("Sanitized read-only inventory saved.", flush=True)
        else:
            print(safe_inventory)
        return
    directory, attempt = release_paths(Path.home(), args.release_id, args.attempt_id)
    needs_attempt = args.operation in ("accept-private", "promote", "rollback")
    require(bool(attempt) == needs_attempt, "Provide an explicit attempt_id only for accept-private, promote or rollback")
    # Rollback is bound by the captured attempt; new CI or a newer master never blocks recovery.
    sha = validate_sha(args.candidate_sha) if args.operation != "rollback" else None
    if args.operation in ("hold", "promote"):
        assert_master(args.ref, sha, args.repository)
    if args.operation in ("prepare", "hold", "promote"):
        run_id = assert_push_quality(sha, args.repository)
        print("Verified exact-candidate PUSH quality run " + str(run_id) + ".", flush=True)
    if args.operation != "prepare":
        record = json.loads(((attempt / "hold.json") if needs_attempt else (directory / "prepared.json")).read_text())
        if sha:
            assert_record_candidate(record, sha)
    if args.operation == "prepare":
        require(not directory.exists(), "Preparation requires a new release_id")
        evidence = ROOT / "docs/releases/legacy-production-verification.json"
        baseline = json.loads(evidence.read_text())
        verification = baseline.get("verification", {})
        require(baseline.get("preservation_branch") == "legacy-flask" and
                verification.get("expected_files", 0) > 0 and verification.get("expected_files") == verification.get("running_files") == verification.get("matching_files") and
                all(verification.get(key) == [] for key in ("mismatched_files", "missing_files", "extra_files")) and
                re.fullmatch(r"sha256:[0-9a-f]{64}", baseline.get("running_image_id", "")), "Verified legacy production source/image evidence is incomplete")
        old_sha = validate_sha(baseline.get("source_sha"))
        image = candidate_image(args.candidate_dir, sha, args.repository)
        helper("operate.py", ["prepare", "--release-dir", directory, "--expected-production-image", baseline["running_image_id"],
                              "--candidate-image", image, "--candidate-sha", sha, "--production-sha", old_sha,
                              "--production-sha-evidence", evidence, "--confirm-exclusive-app-writer"])
    elif args.operation in ("accept-staging", "accept-private"):
        require(args.operator, "Acceptance requires the initiating operator identity")
        helper("acceptance.py", ["private" if needs_attempt else "staging", "--attempt-dir" if needs_attempt else "--release-dir",
                                 attempt if needs_attempt else directory, "--operator", args.operator])
    elif args.operation == "hold":
        verify_checkout(args.candidate_dir, sha)
        helper("operate.py", ["deploy", "--release-dir", directory, "--candidate-compose", args.candidate_dir / "docker-compose.prod.yml",
                              "--manual-cutover-approved", "--confirm-exclusive-app-writer"])
    else:
        helper("operate.py", [args.operation, "--attempt-dir", attempt,
                              "--manual-promotion-approved" if args.operation == "promote" else "--manual-rollback-approved"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", choices=OPERATIONS, default=os.environ.get("RELEASE_OPERATION"), required=not os.environ.get("RELEASE_OPERATION"))
    parser.add_argument("--release-id", default=os.environ.get("RELEASE_ID", ""))
    parser.add_argument("--candidate-sha", default=os.environ.get("RELEASE_CANDIDATE_SHA") or os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--attempt-id", default=os.environ.get("RELEASE_ATTEMPT_ID", ""))
    parser.add_argument("--candidate-dir", type=Path, default=Path(os.environ.get("GITHUB_WORKSPACE", str(ROOT.parent))) / ".candidate-checkout")
    parser.add_argument("--inventory-output", default=os.environ.get("RELEASE_INVENTORY_OUTPUT", ""))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--ref", default=os.environ.get("GITHUB_REF", ""))
    parser.add_argument("--operator", default=os.environ.get("GITHUB_ACTOR", ""))
    args = parser.parse_args()
    os.umask(0o077)
    try:
        require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Host release entry point requires an explicit workflow_dispatch")
        require(sys.platform == "linux" and os.geteuid() == 1000 and os.getegid() == 1000, "Run as the reviewed Linux host UID/GID1000 with Docker access")
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository), "GitHub repository identity is invalid")
        require(private_command(["git", "rev-parse", "HEAD"], cwd=ROOT) == validate_sha(os.environ.get("GITHUB_SHA")),
                "Operations checkout must match the workflow source SHA")
        state = Path.home() / ".local/state/metamuseum"
        require(not state.is_symlink() and all(not parent.is_symlink() for parent in state.parents), "Host release state must not traverse symlinks")
        state.mkdir(parents=True, mode=0o700, exist_ok=True)
        require(state.stat().st_uid == os.geteuid(), "Host release state belongs to another operator")
        state.chmod(0o700)
        import fcntl
        with (state / "dispatch.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DispatchError("Another manual dispatch operation holds the host lock") from None
            execute(args)
    except (DispatchError, OSError, ValueError, KeyError, TypeError):
        error = sys.exc_info()[1]
        print(str(error) if isinstance(error, DispatchError) else "Release dispatch stopped; inspect private host state. No passing gate was inferred.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
